export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";
import { logActivity } from "@/lib/activity-log";
import { bankSuspenseUpdateSchema } from "@/lib/validations";
import { assignCase, resolveCase, reopenCase, BankLineError } from "@/lib/bank-recon/lines";
import { CASE_SELECT, NOTE_SELECT, lineRef, toCaseDto, toNoteDto } from "../_lib/case-shape";

const log = createLogger("bank-suspense");

// The ledger-claims wording (ledger/gaps/[id]/route.ts), owner's Q5 decision, 13 Oct 2026.
const WRITE_OFF_REFUSED =
  "Writing a bank line off needs approve permission on Bank Reconciliation — it is a financial decision, not a note";

/** The case, its line and its whole notes trail, oldest note first. */
async function loadCase(id: string) {
  const c = await prisma.bankSuspense.findUnique({
    where: { id },
    // Same-instant notes (parkLine writes two in one statement) keep their written order via the cuid.
    select: { ...CASE_SELECT, notes: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: NOTE_SELECT } },
  });
  if (!c) return null;
  return { ...toCaseDto(c), notes: c.notes.map(toNoteDto) };
}

// GET /api/bank-suspense/[id] — one case for the sheet (plan 1210-bank-accounts-and-suspense, D2).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let id: string | undefined;
  try {
    await requireFeature("bank_recon", "view");
    ({ id } = await params);
    const found = await loadCase(id);
    if (!found) return errorResponse("This suspense case no longer exists.", 404);
    log.debug("suspense case read", { suspenseId: id, bankTxnId: found.line.id, notes: found.notes.length });
    return successResponse(found);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("suspense case read refused", { suspenseId: id, status: error.status });
      return errorResponse(error.message, error.status);
    }
    return failure(error, { scope: "bank-suspense", step: "read", suspenseId: id });
  }
}

// PATCH /api/bank-suspense/[id] — exactly one of (D1, Q5):
//   { assign: { assigneeId?, assigneeName? } }        bank_recon.edit   — who chases it
//   { resolve: "EXPLAINED", note }                     bank_recon.edit   — a person says what it was
//   { resolve: "WRITTEN_OFF", note }                   bank_recon.approve — nobody can explain it
//   { reopen: true, note }                             bank_recon.edit   — an explained / written-off case
// Each is one transaction: the case, the line's matchStatus and the system note move together
// (src/lib/bank-recon/lines.ts is the only writer of a line's state). Answers the case as GET does.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let id: string | undefined;
  try {
    const user = await requireFeature("bank_recon", "edit");
    ({ id } = await params);
    const suspenseId = id;
    // Unreadable JSON parses as null, so it is refused by zod as a 400, not thrown as a 500.
    const data = bankSuspenseUpdateSchema.parse(await req.json().catch(() => null));

    const existing = await prisma.bankSuspense.findUnique({ where: { id: suspenseId }, select: CASE_SELECT });
    if (!existing) return errorResponse("This suspense case no longer exists.", 404);
    const line = toCaseDto(existing).line;

    if ("resolve" in data && data.resolve === "WRITTEN_OFF" && !(await userCan(user.id, "bank_recon", "approve"))) {
      log.warn("write-off refused without approve", { suspenseId, bankTxnId: line.id });
      return errorResponse(WRITE_OFF_REFUSED, 403);
    }

    const action =
      "assign" in data ? "assigned" : "resolve" in data ? (data.resolve === "EXPLAINED" ? "explained" : "written_off") : "reopened";
    await prisma.$transaction(async (tx) => {
      if ("assign" in data) {
        await assignCase(tx, suspenseId, {
          assigneeId: data.assign.assigneeId ?? null,
          assigneeName: data.assign.assigneeName ?? null,
          userId: user.id,
        });
        return;
      }
      if ("resolve" in data) {
        await resolveCase(tx, suspenseId, { resolution: data.resolve, note: data.note, userId: user.id });
        // The activity log is the app's audit trail; a write-off is a financial decision, so it
        // is recorded there as well as in the case's own notes.
        await logActivity(tx, {
          module: "bank_recon",
          action,
          entityType: "BankTransaction",
          entityId: line.id,
          entityRef: lineRef(line),
          fromValue: "SUSPENSE",
          toValue: data.resolve,
          details: data.note,
          userId: user.id,
          userName: user.name,
        });
        return;
      }
      await reopenCase(tx, suspenseId, { note: data.note, userId: user.id });
      await logActivity(tx, {
        module: "bank_recon",
        action,
        entityType: "BankTransaction",
        entityId: line.id,
        entityRef: lineRef(line),
        fromValue: existing.resolution,
        toValue: "SUSPENSE",
        details: data.note,
        userId: user.id,
        userName: user.name,
      });
    });

    log.info(`suspense ${action.replace("_", " ")}`, {
      suspenseId,
      bankTxnId: line.id,
      resolution: "resolve" in data ? data.resolve : null,
    });
    const updated = await loadCase(suspenseId);
    if (!updated) return errorResponse("This suspense case no longer exists.", 404);
    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("suspense change refused", { suspenseId: id, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof BankLineError) {
      log.warn("suspense change refused", { suspenseId: id, status: error.status, message: error.message });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid change";
      log.warn("suspense change rejected", { suspenseId: id, message });
      return errorResponse(message, 400);
    }
    return failure(error, { scope: "bank-suspense", step: "update", suspenseId: id });
  }
}
