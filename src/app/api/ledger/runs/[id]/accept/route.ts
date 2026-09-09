export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import type { GapType, LedgerEntrySource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireAuth, requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { recheckStatement, type LedgerProposals, type StatementRowProposal } from "@/lib/brand-ledger/ai-run";
import type { ClaimProposal } from "@/lib/brand-ledger/ai-prompts";
import { parseLedgerDate } from "@/lib/brand-ledger/reconcile";
import { fileExtension } from "@/lib/brand-ledger/uploads";
import { GAP_TYPE_FROM_VIEW, LEDGER_VIEW_GAP_TYPES, type LedgerViewGapType } from "@/lib/brand-ledger/view-types";

const log = createLogger("ledger:ai");

// Thrown inside the transaction when another request accepted the same run first. The
// status check outside a transaction is a race: two accepts of one statement would each
// create a BrandStatement and its rows, and no unique key stops the second. So the run is
// CLAIMED inside the transaction with an updateMany conditioned on status = DONE; a count of
// zero means somebody else got there, and nothing is written.
class RunAlreadyClaimedError extends Error {
  constructor() {
    super("This run was accepted a moment ago by another request");
  }
}

async function claimRun(tx: { ledgerAiRun: { updateMany: (a: { where: { id: string; status: "DONE" }; data: { status: "ACCEPTED"; acceptedAt: Date } }) => Promise<{ count: number }> } }, id: string) {
  const claimed = await tx.ledgerAiRun.updateMany({
    where: { id, status: "DONE" },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
  });
  if (claimed.count === 0) throw new RunAlreadyClaimedError();
}

const rowSchema = z.object({
  date: z.string().min(1),
  label: z.string(),
  ref: z.string(),
  note: z.string(),
  amount: z.number().positive(),
  direction: z.union([z.literal(1), z.literal(-1)]),
  type: z.enum(["OPENING", "INVOICE", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE", "DISCOUNT", "ADJUSTMENT", "NOTE"]),
  side: z.enum(["VENDOR", "BCH"]),
});

const claimSchema = z.object({
  title: z.string().min(1).max(300),
  type: z.enum([...LEDGER_VIEW_GAP_TYPES] as [LedgerViewGapType, ...LedgerViewGapType[]]),
  amount: z.number().nullable(),
  amountNote: z.string().max(200),
  promisedBy: z.string().max(120),
  promisedOn: z.string().nullable(),
  quote: z.string().max(2000),
  line: z.number().int().nullable(),
});

// The body may carry what the person edited in the review: a corrected claimed closing, a
// corrected opening, edited rows, or a pruned/edited claim list. Absent → the run's proposals.
const bodySchema = z.object({
  claimedClosing: z.number().nullable().optional(),
  opening: z.number().optional(),
  statementDate: z.string().nullable().optional(),
  rows: z.array(rowSchema).optional(),
  claims: z.array(claimSchema).optional(),
});

function sourceKindFor(fileName: string): LedgerEntrySource {
  const ext = fileExtension(fileName);
  if (ext === "xlsx" || ext === "xls") return "STATEMENT_XLSX";
  if (ext === "csv") return "STATEMENT_CSV";
  return "STATEMENT_PDF";
}

// POST — a person accepts a run. This is the ONLY writer of ledger rows on the AI path.
//
// A statement is refused (409) unless its rows tie to the closing it claims, recomputed over
// exactly what is being accepted — an AI mis-read must be detected here, not discovered in a
// negotiation. Claims land as VERIFY gaps: a promise the model found still needs a person to
// confirm it before it is pressed.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let step = "load";
  try {
    // Authenticate before touching the database: an anonymous caller must get 401, not a
    // 404-or-409 that tells them whether a run id exists. The permission check needs the
    // run's task to pick the module, so it follows the read.
    await requireAuth();
    const { id } = await params;
    const run = await prisma.ledgerAiRun.findUnique({
      where: { id },
      include: { upload: { select: { id: true, fileName: true, fileUrl: true } } },
    });
    if (!run) return errorResponse("Run not found", 404);

    const user = await requireFeature(
      run.task === "STATEMENT_ROWS" ? "brand_ledger" : "brand_ledger_gaps",
      "create"
    );

    if (run.status === "ACCEPTED") return errorResponse("This run has already been accepted", 409);
    if (run.status === "DISCARDED") return errorResponse("This run was discarded", 409);
    if (run.status !== "DONE" || !run.proposals) return errorResponse("This run produced nothing to accept", 409);

    step = "parse";
    const parsed = bodySchema.safeParse(
      await req.json().catch((e: unknown) => {
        // An absent or non-JSON body means "accept the proposals the run produced" (every
        // field of bodySchema is optional), so this is expected and only worth a debug line.
        log.debug("accept body is not JSON; using the run proposals", { runId: id, reason: e instanceof Error ? e.message : String(e) });
        return {};
      })
    );
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Invalid body", 400);
    const body = parsed.data;
    const proposals = run.proposals as unknown as LedgerProposals;

    if (run.task === "STATEMENT_ROWS") {
      if (proposals.kind !== "statement") return errorResponse("The run's proposals are not statement rows", 409);
      const rows: StatementRowProposal[] = (body.rows ?? proposals.rows) as StatementRowProposal[];
      const opening = body.opening ?? proposals.opening;
      const claimedClosing = body.claimedClosing !== undefined ? body.claimedClosing : proposals.claimedClosing;
      if (rows.length === 0) return errorResponse("There are no rows to accept", 400);

      step = "tie-out";
      const check = recheckStatement(rows, opening, claimedClosing);
      if (!check.tiesOut) {
        log.warn("accept refused: statement does not tie", { runId: id, difference: check.difference, rows: rows.length });
        return errorResponse(
          claimedClosing === null
            ? "The statement's closing balance is not known. Enter the closing balance it states before accepting."
            : `The rows add up to ${check.computedClosing.toLocaleString("en-IN")} but the statement claims ${claimedClosing.toLocaleString("en-IN")} — a difference of ${Math.abs(check.difference ?? 0).toLocaleString("en-IN")}. Fix the rows or the closing before accepting.`,
          409,
          check
        );
      }

      // What was edited in the review is recorded on the statement, so a closing typed to force
      // a tie is visible later beside the figure the AI (or the sheet) actually read.
      const closingEdited =
        body.claimedClosing !== undefined && body.claimedClosing !== proposals.claimedClosing;
      const openingEdited = body.opening !== undefined && body.opening !== proposals.opening;
      const edits = [
        closingEdited ? `closing edited in review: read ${proposals.claimedClosing ?? "none"}, accepted ${claimedClosing}` : null,
        openingEdited ? `opening edited in review: read ${proposals.opening}, accepted ${opening}` : null,
        body.rows ? "rows edited in review" : null,
      ].filter(Boolean);

      const statementDateRaw = body.statementDate !== undefined ? body.statementDate : proposals.statementDate;
      const statementDate = (statementDateRaw && parseLedgerDate(statementDateRaw)) || new Date();
      const badDate = rows.find((r) => !parseLedgerDate(r.date));
      if (badDate) return errorResponse(`Could not read the date "${badDate.date}" on a row`, 400);

      step = "write";
      const result = await prisma.$transaction(async (tx) => {
        await claimRun(tx, id);
        const statement = await tx.brandStatement.create({
          data: {
            vendorId: run.vendorId,
            statementDate,
            periodFrom: (proposals.periodFrom && parseLedgerDate(proposals.periodFrom)) || null,
            periodTo: (proposals.periodTo && parseLedgerDate(proposals.periodTo)) || null,
            claimedClosing,
            computedClosing: check.computedClosing,
            tiesOut: check.tiesOut,
            fileUrl: run.upload.fileUrl,
            fileName: run.upload.fileName,
            sourceKind: sourceKindFor(run.upload.fileName),
            extractionModel: run.model,
            extractionNote: [
              proposals.source === "sheet" ? `Deterministic sheet read, AI run ${run.id}` : `AI run ${run.id}`,
              ...edits,
            ].join("; "),
            importedById: user.id,
          },
          select: { id: true },
        });
        await tx.brandLedgerEntry.createMany({
          data: rows.map((r) => ({
            vendorId: run.vendorId,
            statementId: statement.id,
            entryDate: parseLedgerDate(r.date) as Date,
            type: r.type,
            ref: r.ref || null,
            amount: r.amount,
            direction: r.direction,
            side: r.side,
            note: [r.label, r.note].filter(Boolean).join(" · ").slice(0, 500) || null,
            source: sourceKindFor(run.upload.fileName),
            matchStatus: "UNMATCHED",
          })),
        });
        await tx.ledgerAiRun.update({ where: { id }, data: { statementId: statement.id } });
        return { statementId: statement.id, entries: rows.length };
      });
      log.info("statement accepted", { runId: id, vendorId: run.vendorId, ...result, userId: user.id });
      return successResponse({ accepted: true, ...result });
    }

    // Claims
    if (proposals.kind !== "claims") return errorResponse("The run's proposals are not claims", 409);
    const claims = (body.claims ?? proposals.claims) as ClaimProposal[];
    if (claims.length === 0) return errorResponse("There are no claims to accept", 400);

    step = "write";
    const result = await prisma.$transaction(async (tx) => {
      await claimRun(tx, id);
      const last = await tx.ledgerGap.findFirst({
        where: { vendorId: run.vendorId },
        orderBy: { number: "desc" },
        select: { number: true },
      });
      let number = last?.number ?? 0;
      const ids: string[] = [];
      for (const c of claims) {
        number += 1;
        const gap = await tx.ledgerGap.create({
          data: {
            vendorId: run.vendorId,
            number,
            title: c.title,
            gapType: GAP_TYPE_FROM_VIEW[c.type as keyof typeof GAP_TYPE_FROM_VIEW] as GapType,
            status: "VERIFY",
            amount: c.amount,
            amountNote: c.amountNote || null,
            promisedBy: c.promisedBy || null,
            promisedOn: (c.promisedOn && parseLedgerDate(c.promisedOn)) || null,
            evidenceText: c.quote ? `CHAT: ${c.line ? `L${c.line} ` : ""}"${c.quote}"`.slice(0, 2000) : null,
            createdById: user.id,
            notes: { create: { body: `From AI run ${run.id}`, authorId: user.id } },
          },
          select: { id: true },
        });
        ids.push(gap.id);
      }
      return { gaps: ids.length, firstNumber: number - ids.length + 1, lastNumber: number };
    });
    log.info("claims accepted", { runId: id, vendorId: run.vendorId, ...result, userId: user.id });
    return successResponse({ accepted: true, ...result });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof RunAlreadyClaimedError) {
      log.warn("accept lost the race", { step });
      return errorResponse(error.message, 409);
    }
    return failure(error, { scope: "ledger:ai", step });
  }
}
