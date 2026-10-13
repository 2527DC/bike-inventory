export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import type { BankTxnMatchStatus, Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { runAi, toAiErrorResponse, aiErrorKind } from "@/lib/ai";
import { bankStatementUploadSchema } from "@/lib/validations";
import { businessDate, fromDateColumn, toDateColumn } from "@/lib/analytics/time";
import { GENERIC_HINTS, parseHintsFor } from "@/lib/bank-recon/parse-hints";
import { fingerprintLines } from "@/lib/bank-recon/fingerprint";
import { BankLineError } from "@/lib/bank-recon/lines";

// Bank statements: the list with live progress, and the upload (plan
// 1210-bank-accounts-and-suspense, §3 A3, B4, B6). Guarded by bank_recon since 13 Oct 2026 —
// it was `bills` until then (D16).
//
// THE UPLOAD, IN ORDER — every refusal is a sentence, and nothing is ever silently cut:
//   1. bank_recon.create; the statement names an ACTIVE bank account and the period the bank
//      printed on it (Q4).
//   2. F1: a file over 50,000 characters is refused — it used to be cut at 50,000 without a word.
//   3. AI call A parses the rows, with hints for the account's bank (parse-hints.ts).
//   4. Every row must be readable, and dated inside the typed period — a wrong period and a
//      day/month mix-up by the parser are both caught here.
//   5. Each row is fingerprinted (fingerprint.ts) and inserted with skipDuplicates in ONE
//      transaction with the statement: a line already on file for this account is skipped and
//      counted; a file that is entirely duplicates is refused (409) and leaves no statement.
//   6. AI call B suggests a vendor, bill and category for the INSERTED lines — suggestions only.
//      It never writes matchStatus (D5): a line is "to review" until a person decides it.

const log = createLogger("bank-statements");

/** F1 (docs/ai-usage-audit.md): the most text the parser is given. Over it, refuse — never cut. */
const MAX_STATEMENT_CHARS = 50_000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-02-30" passes the regex; JavaScript would quietly read it as 2 March. */
function isRealDay(day: string): boolean {
  return ISO_DAY.test(day) && fromDateColumn(toDateColumn(day)) === day;
}

/** "2026-10-09" → "09/10/2026", the way the statement and the person write it. */
function dmy(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

// ─── GET — statements, with LIVE progress per statement (B6) ─────────────────────────────

const listQuerySchema = z.object({
  bankAccountId: z.string().min(1).optional(),
  // Statements uploaded before accounts existed, waiting for "Assign an account" (Q7).
  unassigned: z.literal("1").optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

interface StatementProgress {
  /** Every line on the statement. */
  total: number;
  /** Decided by a person: recorded, matched in settlement, skipped, explained, written off. */
  done: number;
  /** processedAt null — the AI's suggestions included; nobody has decided them yet. */
  toReview: number;
  /** Parked: FLAGGED and processed ⇔ an open suspense case (lines.ts). */
  suspense: number;
}

export async function GET(req: NextRequest) {
  try {
    await requireFeature("bank_recon", "view");
    const sp = req.nextUrl.searchParams;
    const q = listQuerySchema.parse({
      bankAccountId: sp.get("bankAccountId") || undefined,
      unassigned: sp.get("unassigned") || undefined,
      take: sp.get("take") || undefined,
    });
    if (q.bankAccountId && q.unassigned) {
      return errorResponse("Ask for one account's statements or for unassigned ones, not both", 400);
    }

    const where: Prisma.BankStatementWhereInput = q.unassigned
      ? { bankAccountId: null }
      : q.bankAccountId
        ? { bankAccountId: q.bankAccountId }
        : {};

    const statements = await prisma.bankStatement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.take ?? 50,
      select: {
        id: true,
        bank: true,
        fileName: true,
        fromDate: true,
        toDate: true,
        totalCredits: true,
        totalDebits: true,
        txnCount: true,
        // AI suggestion counts at upload — NOT progress. Kept for the record; progress is below.
        matchedCount: true,
        flaggedCount: true,
        createdAt: true,
        uploadedBy: { select: { name: true } },
        bankAccount: { select: { id: true, name: true, bank: true, accountLast4: true, isActive: true } },
      },
    });

    const ids = statements.map((s) => s.id);
    if (ids.length === 0) {
      log.debug("statements listed", { count: 0, bankAccountId: q.bankAccountId, unassigned: !!q.unassigned });
      return successResponse([]);
    }

    // Two groupBys over the whole page, not one query per statement. The second counts only
    // DECIDED lines, so a line is never in two buckets.
    const [open, decided] = await Promise.all([
      prisma.bankTransaction.groupBy({
        by: ["statementId"],
        where: { statementId: { in: ids }, processedAt: null },
        _count: { _all: true },
      }),
      prisma.bankTransaction.groupBy({
        by: ["statementId", "matchStatus"],
        where: { statementId: { in: ids }, processedAt: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const toReviewBy = new Map(open.map((g) => [g.statementId, g._count._all]));
    const decidedBy = new Map<string, Partial<Record<BankTxnMatchStatus, number>>>();
    for (const g of decided) {
      const row = decidedBy.get(g.statementId) ?? {};
      row[g.matchStatus] = g._count._all;
      decidedBy.set(g.statementId, row);
    }

    const rows = statements.map((s) => {
      const byStatus = decidedBy.get(s.id) ?? {};
      const decidedTotal = sum(Object.values(byStatus));
      const suspense = byStatus.FLAGGED ?? 0;
      const toReview = toReviewBy.get(s.id) ?? 0;
      const progress: StatementProgress = {
        total: toReview + decidedTotal,
        done: decidedTotal - suspense,
        toReview,
        suspense,
      };
      return { ...s, progress };
    });

    log.debug("statements listed", { count: rows.length, bankAccountId: q.bankAccountId, unassigned: !!q.unassigned });
    return successResponse(rows);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid statement list query";
      log.warn("statement list refused: invalid query", { reason: message });
      return errorResponse(message, 400);
    }
    return failure(error, { scope: "bank-statements", step: "list" });
  }
}

// ─── POST — upload one statement (B4) ────────────────────────────────────────────────────

/** A number the parser may have written as 1234.5, "1,234.50", "₹ 1,234.50" or "1,234.50 Cr". */
function readNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = /^(-?\d+(?:\.\d+)?)(CR|DR)?$/i.exec(v.replace(/[,\s₹]/g, ""));
  if (!m) return null;
  const n = Number(m[1]);
  // A balance suffixed "Dr" is overdrawn — negative. Amounts never carry it (type says which way).
  return m[2]?.toUpperCase() === "DR" ? -n : n;
}

/**
 * One row of AI call A's reply. The AI is an outside source, so its reply is validated like any
 * request body: a row without a real date, a positive amount and a direction is refused with
 * the file — never guessed at, never dropped.
 */
const parsedLineSchema = z.object({
  // "2026-10-09", or the same day with a time the parser added ("2026-10-09T00:00:00").
  date: z
    .string()
    .trim()
    .transform((d) => (/^\d{4}-\d{2}-\d{2}[T ]/.test(d) ? d.slice(0, 10) : d))
    .refine(isRealDay),
  description: z.unknown().transform((v) => (typeof v === "string" ? v.trim() : "")),
  reference: z.unknown().transform((v) =>
    typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""
  ),
  amount: z.unknown().transform(readNumber).pipe(z.number().positive()),
  type: z
    .string()
    .trim()
    .transform((t) => t.toUpperCase())
    .transform((t) => (t === "CR" ? "CREDIT" : t === "DR" ? "DEBIT" : t))
    .pipe(z.enum(["CREDIT", "DEBIT"])),
  balance: z.unknown().transform((v) => (v === null || v === undefined || v === "" ? null : readNumber(v))),
});
type ParsedLine = z.output<typeof parsedLineSchema>;

/** One row of AI call B's reply. Every id is checked against what the AI was actually shown. */
const suggestionSchema = z.object({
  txnId: z.string(),
  vendorId: z.string().nullish(),
  billId: z.string().nullish(),
  category: z.string().nullish(),
  confidence: z.unknown().optional(),
  flagReason: z.string().nullish(),
});

const SUGGESTED_CATEGORIES = new Set([
  "VENDOR_PAYMENT", "EXPENSE_SALARY", "EXPENSE_RENT", "EXPENSE_UTILITY",
  "EXPENSE_DELIVERY", "EXPENSE_OTHER", "TRANSFER", "UNKNOWN",
]);

interface FileStats { name: string; size: string; lines: number; chars: number }

function formString(form: FormData, key: string): string {
  const v = form.get(key);
  // "" rather than undefined, so the schema's own sentence ("Pick the bank account …") is
  // what the person reads, not zod's "expected string, received undefined".
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: NextRequest) {
  // Declared outside the try so the refusals raised from inside the transaction can still
  // carry the diagnostics the upload screen shows.
  let bankAccountId: string | undefined;
  let fileStats: FileStats | undefined;
  let parsedCount = 0;
  try {
    const user = await requireFeature("bank_recon", "create");

    const formData = await req.formData();
    const fields = bankStatementUploadSchema.parse({
      bankAccountId: formString(formData, "bankAccountId"),
      periodFrom: formString(formData, "periodFrom"),
      periodTo: formString(formData, "periodTo"),
    });
    bankAccountId = fields.bankAccountId;
    const { periodFrom, periodTo } = fields;

    if (!isRealDay(periodFrom)) return errorResponse(`Statement from is not a real date (${periodFrom}).`, 400);
    if (!isRealDay(periodTo)) return errorResponse(`Statement to is not a real date (${periodTo}).`, 400);
    // A statement covers days that have happened. A future "to" would let the weekly tile call
    // the account reconciled into next week, and hide the gap before the next real statement.
    const today = businessDate();
    if (periodTo > today) {
      log.warn("statement refused: period ends in the future", { bankAccountId, periodTo, today });
      return errorResponse(
        `Statement to is in the future (${dmy(periodTo)}). A statement can only cover days that have happened.`,
        400
      );
    }

    const file = formData.get("file");
    if (!(file instanceof File)) return errorResponse("No file uploaded", 400);

    const account = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      select: { id: true, name: true, bank: true, isActive: true },
    });
    if (!account || !account.isActive) {
      log.warn("statement refused: account missing or retired", { bankAccountId });
      return errorResponse("Pick an active bank account", 400);
    }

    // Read file content — CSV/TXT as text; XLS/XLSX converted to CSV.
    let text: string;
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx")) {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      // blankrows:false and strip:true drop empty rows and trailing empty cells — formatting
      // padding that carries no transaction and would otherwise count against the F1 limit.
      text = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]], { blankrows: false, strip: true });
    } else {
      text = await file.text();
    }

    fileStats = {
      name: file.name,
      size: `${Math.round(file.size / 1024)}KB`,
      lines: text ? text.split("\n").length : 0,
      chars: text?.length ?? 0,
    };
    // File size, bank and account only. Never the content, and never the file name — bank
    // exports are often named after the account number (D16, plan §3 Logging).
    log.debug("statement received", { bytes: file.size, chars: fileStats.chars, bank: account.bank, bankAccountId });

    if (!text || text.trim().length < 20) {
      return errorResponse(
        `File appears empty or unreadable (${text?.length || 0} chars). Ensure it's a valid CSV/XLS bank statement. File: ${file.name} (${fileStats.size})`,
        400,
        { diagnostics: { step: "empty_file", fileStats } }
      );
    }

    // F1 — refuse, never cut. A cut file loses its last lines, and the tile would then call
    // the statement reconciled with lines nobody ever saw.
    if (text.length > MAX_STATEMENT_CHARS) {
      log.warn("statement refused: too long", { bankAccountId, chars: text.length, limit: MAX_STATEMENT_CHARS });
      return errorResponse(
        `This file is too long to read in one go (${text.length.toLocaleString("en-IN")} characters). Download a shorter period — a week is ideal — and upload each part.`,
        400,
        { diagnostics: { step: "too_long", fileStats } }
      );
    }

    const parsePrompt = `You are an expert bank statement parser. Parse the following ${account.name} bank statement data and extract ALL transactions.

${parseHintsFor(account.bank)}

IMPORTANT: The data may have header rows, summary sections, or irregular formatting. Skip non-transaction rows (headers, totals, blank rows, account info). Focus ONLY on actual transaction rows with dates and amounts.

Return a JSON array of transactions with this exact structure:
[
  {
    "date": "YYYY-MM-DD",
    "description": "transaction description/narration",
    "reference": "cheque/utr/ref number if available, else empty string",
    "amount": 1234.56,
    "type": "CREDIT" or "DEBIT",
    "balance": 5678.90
  }
]

Rules:
- Extract ALL transaction rows — do not skip any
- Convert dates to YYYY-MM-DD format (input might be DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY etc.)
- Amount MUST be a positive number (never negative)
- If there are separate Withdrawal/Deposit columns, use Withdrawal for DEBIT and Deposit for CREDIT
- If there's a single amount column, determine type from context or separate Dr/Cr indicator
- Balance is the closing balance after that transaction (null if not available)
- Reference: extract cheque number, UTR, NEFT ref, or transaction ID
- Return ONLY the JSON array, no markdown, no explanation
- If you cannot find any transactions, return an empty array []

Bank statement data (${account.name}):
${text}`;

    // Shown on the upload screen's diagnostics panel, to the person who uploaded the file.
    const filePreview = text.split("\n").slice(0, 10).join("\n");

    // Call A — extract the transaction rows. runAi retries transient failures, refuses a
    // truncated reply (AiError "max_tokens") and parses the JSON (AiError "parse").
    let rawRows: unknown[];
    let responseText = "";
    try {
      log.debug("-> runAi bank.statement_parse", { bankAccountId, bank: account.bank, promptChars: parsePrompt.length });
      const parseResult = await runAi({
        purpose: "bank.statement_parse",
        prompt: parsePrompt,
        maxTokens: 16384,
        json: true,
      });
      responseText = parseResult.text;

      const parsed: unknown = parseResult.json;
      if (!Array.isArray(parsed)) {
        log.error("statement parse returned JSON that is not an array", {
          bankAccountId,
          model: parseResult.model,
          type: parsed === null ? "null" : typeof parsed,
        });
        return errorResponse("AI returned invalid JSON. Try re-uploading or use a different file format.", 500, {
          diagnostics: { step: "json_parse", fileStats, filePreview, aiResponse: responseText.slice(0, 500) },
        });
      }
      rawRows = parsed;
      log.info("statement parsed", { bankAccountId, bank: account.bank, rows: rawRows.length, model: parseResult.model });
    } catch (error) {
      const aiRes = toAiErrorResponse(error);
      if (!aiRes) {
        log.error("statement parse threw a non-AI error", { bankAccountId, kind: aiErrorKind(error) });
        throw error;
      }
      // The status and sentence toAiErrorResponse chose for this kind of failure, with the
      // diagnostics carried in `data` so apiTry's errorData reaches the upload screen.
      log.error("statement parse failed at the AI step", { bankAccountId, status: aiRes.status, kind: aiErrorKind(error) });
      let message = "AI processing failed. Please try again.";
      try {
        const body = (await aiRes.json()) as { error?: unknown };
        if (typeof body.error === "string" && body.error) message = body.error;
      } catch (readError) {
        log.warn("could not read the AI error body; falling back to the message", { kind: aiErrorKind(readError) });
        if (error instanceof Error && error.message) message = error.message;
      }
      return errorResponse(message, aiRes.status, { diagnostics: { step: "ai_call", fileStats, filePreview } });
    }

    parsedCount = rawRows.length;
    if (rawRows.length === 0) {
      const generic = GENERIC_HINTS.has(account.bank);
      return errorResponse("No transactions found in the uploaded file.", 400, {
        diagnostics: {
          step: "no_transactions",
          fileStats,
          filePreview,
          aiResponse: responseText.slice(0, 500),
          hint: generic
            ? "This bank has generic parser hints only — no sample statement has been seen yet. Send one real statement so the hints can be written from it."
            : responseText.includes("[]")
              ? "AI returned empty array — file format may not be a standard bank statement"
              : "AI could not identify transaction rows in the data",
        },
      });
    }

    // Every row readable — or the file is refused. Dropping an unreadable row would lose a
    // bank line without a word, which is exactly what F1 was about.
    const lines: ParsedLine[] = [];
    let unreadable = 0;
    for (const raw of rawRows) {
      const r = parsedLineSchema.safeParse(raw);
      if (r.success) lines.push(r.data);
      else unreadable++;
    }
    if (unreadable > 0) {
      log.warn("statement refused: unreadable rows", { bankAccountId, rows: rawRows.length, unreadable });
      return errorResponse(
        `The AI could not read ${unreadable} of ${rawRows.length} lines cleanly (a date, an amount or debit/credit was missing). Nothing was imported — try again, or upload the file as CSV.`,
        400,
        { diagnostics: { step: "row_shape", fileStats, filePreview, aiResponse: responseText.slice(0, 500) } }
      );
    }

    // Every line inside the typed period (Q4). Catches a wrong period AND a day/month mix-up by
    // the parser — 09/10 read as 10 September lands outside a 1–7 October period.
    const outside = lines.filter((l) => l.date < periodFrom || l.date > periodTo);
    if (outside.length > 0) {
      const dates = lines.map((l) => l.date).sort();
      const first = outside[0].date;
      const period = `${dmy(periodFrom)} – ${dmy(periodTo)}`;
      log.warn("statement refused: line outside period", { bankAccountId, outside: outside.length, periodFrom, periodTo });
      return errorResponse(
        outside.length === 1
          ? `The file has a line dated ${dmy(first)}, outside the period you entered (${period}). Check the period, or the date format.`
          : `The file has ${outside.length} lines outside the period you entered (${period}) — the first is dated ${dmy(first)}. Check the period, or the date format.`,
        400,
        {
          diagnostics: {
            step: "outside_period",
            fileStats,
            hint: `The parsed lines run from ${dmy(dates[0])} to ${dmy(dates[dates.length - 1])}.`,
          },
        }
      );
    }

    const fingerprints = fingerprintLines(lines);

    // ONE transaction: the statement and its lines land together or not at all. skipDuplicates
    // turns a line already on file for this account into a skipped insert (unique index
    // [bankAccountId, fingerprint]); if every line was skipped the throw rolls the statement back.
    const saved = await prisma.$transaction(
      async (tx) => {
        const statement = await tx.bankStatement.create({
          data: {
            bank: account.bank,
            bankAccountId: account.id,
            fileName: file.name,
            fromDate: toDateColumn(periodFrom),
            toDate: toDateColumn(periodTo),
            uploadedById: user.id,
          },
          select: { id: true },
        });

        const inserted = await tx.bankTransaction.createManyAndReturn({
          data: lines.map((l, i) => ({
            statementId: statement.id,
            bankAccountId: account.id,
            fingerprint: fingerprints[i],
            date: toDateColumn(l.date),
            description: l.description,
            reference: l.reference || null,
            amount: l.amount,
            type: l.type,
            balance: l.balance,
          })),
          skipDuplicates: true,
          select: { id: true, date: true, description: true, amount: true, type: true, reference: true },
        });

        if (inserted.length === 0) {
          throw new BankLineError(`Every line in this file is already uploaded for ${account.name}. Nothing was imported.`, 409);
        }

        const totalCredits = sum(inserted.filter((t) => t.type === "CREDIT").map((t) => t.amount));
        const totalDebits = sum(inserted.filter((t) => t.type === "DEBIT").map((t) => t.amount));
        await tx.bankStatement.update({
          where: { id: statement.id },
          data: { txnCount: inserted.length, totalCredits, totalDebits },
        });

        return { statementId: statement.id, inserted, totalCredits, totalDebits };
      },
      { timeout: 20_000 }
    );

    const { statementId, inserted, totalCredits, totalDebits } = saved;
    const duplicatesSkipped = lines.length - inserted.length;

    // ── AI call B — suggestions for the INSERTED lines only. Non-fatal: the statement is saved,
    // and a failure here leaves every line "to review" without a suggestion.
    const vendors = await prisma.vendor.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
    });
    const pendingBills = await prisma.vendorBill.findMany({
      where: { status: { in: ["PENDING", "PARTIALLY_PAID"] } },
      select: {
        id: true, billNo: true, amount: true, paidAmount: true,
        vendor: { select: { id: true, name: true } },
      },
    });

    const matchPrompt = `You are a bank reconciliation AI. Match bank transactions to vendors and bills.

VENDORS (id, name):
${vendors.map((v) => `${v.id}|${v.name}|${v.code}`).join("\n")}

PENDING BILLS (id, billNo, amount, balance, vendorId, vendorName):
${pendingBills.map((b) => `${b.id}|${b.billNo}|${b.amount}|${b.amount - b.paidAmount}|${b.vendor.id}|${b.vendor.name}`).join("\n")}

BANK TRANSACTIONS TO MATCH:
${inserted.map((t) => `${t.id}|${t.date.toISOString().slice(0, 10)}|${t.description}|${t.amount}|${t.type}|${t.reference || ""}`).join("\n")}

For each DEBIT transaction, try to match it to a vendor payment:
- Match by vendor name in description
- Match by amount to pending bill balance
- Match by reference/cheque number

Return a JSON array:
[
  {
    "txnId": "transaction id",
    "vendorId": "matched vendor id or null",
    "billId": "matched bill id or null",
    "category": "VENDOR_PAYMENT" | "EXPENSE_SALARY" | "EXPENSE_RENT" | "EXPENSE_UTILITY" | "EXPENSE_DELIVERY" | "EXPENSE_OTHER" | "TRANSFER" | "UNKNOWN",
    "confidence": 0.0 to 1.0,
    "flagReason": "reason if suspicious, else null"
  }
]

Flag suspicious transactions if:
- Large round amounts with no matching vendor (>50000)
- Duplicate amounts on same day
- Description contains unusual keywords
- Unknown payee for large debits

Return ONLY the JSON array.`;

    let suggested = 0;
    let aiFlagged = 0;
    try {
      log.debug("-> runAi bank.vendor_resolve", {
        statementId,
        transactions: inserted.length,
        vendors: vendors.length,
        pendingBills: pendingBills.length,
        promptChars: matchPrompt.length,
      });
      const matchResult = await runAi({
        purpose: "bank.vendor_resolve",
        prompt: matchPrompt,
        maxTokens: 16384,
        json: true,
      });

      const reply: unknown = matchResult.json;
      if (!Array.isArray(reply)) {
        log.warn("vendor resolve skipped", { statementId, kind: "not_an_array", model: matchResult.model });
      } else {
        // The model can invent ids. Only ids it was shown are written: a txnId outside this
        // upload would otherwise put a suggestion on another statement's line.
        const lineIds = new Set(inserted.map((t) => t.id));
        const vendorIds = new Set(vendors.map((v) => v.id));
        const billVendor = new Map(pendingBills.map((b) => [b.id, b.vendor.id]));

        const updates: Prisma.PrismaPromise<unknown>[] = [];
        let ignored = 0;
        const seenLine = new Set<string>();
        for (const raw of reply) {
          const r = suggestionSchema.safeParse(raw);
          if (!r.success || !lineIds.has(r.data.txnId) || seenLine.has(r.data.txnId)) {
            ignored++;
            continue;
          }
          const m = r.data;
          seenLine.add(m.txnId);
          const vendorId = m.vendorId && vendorIds.has(m.vendorId) ? m.vendorId : null;
          // A bill is suggested only with ITS vendor — "Confirm" would otherwise pay vendor A's bill to vendor B.
          const billOwner = m.billId ? billVendor.get(m.billId) : undefined;
          const billId = billOwner && (!vendorId || billOwner === vendorId) ? m.billId! : null;
          const category = m.category && SUGGESTED_CATEGORIES.has(m.category) ? m.category : null;
          const confidenceRaw = readNumber(m.confidence);
          const confidence = confidenceRaw === null ? 0 : Math.min(1, Math.max(0, confidenceRaw));
          const flagReason = m.flagReason?.trim().slice(0, 500) || null;

          if (flagReason) aiFlagged++;
          if (vendorId || billId || category?.startsWith("EXPENSE")) suggested++;

          // Suggestions only — matchStatus is NEVER written here (D5). The AI's flag is a note
          // for the person reviewing the line, not a park in suspense.
          updates.push(
            prisma.bankTransaction.update({
              where: { id: m.txnId },
              data: {
                confidence,
                suggestedCategory: category,
                suggestedVendorId: vendorId ?? (billId ? billOwner! : null),
                suggestedBillId: billId,
                flagReason,
              },
            })
          );
        }
        if (updates.length > 0) await prisma.$transaction(updates);
        log.info("vendor resolve finished", {
          statementId,
          replies: reply.length,
          written: updates.length,
          ignored,
          suggested,
          aiFlagged,
          model: matchResult.model,
        });
      }
    } catch (error) {
      // Non-fatal, by design: the lines are saved and stay "to review" with no suggestion.
      suggested = 0;
      aiFlagged = 0;
      log.warn("vendor resolve skipped", { statementId, kind: aiErrorKind(error) });
    }

    // matchedCount / flaggedCount are the AI's suggestion counts at upload (schema comment) —
    // never reconciliation progress, which GET computes live.
    await prisma.bankStatement.update({
      where: { id: statementId },
      data: { matchedCount: suggested, flaggedCount: aiFlagged },
    });

    log.info("statement uploaded", {
      statementId,
      bankAccountId: account.id,
      inserted: inserted.length,
      duplicatesSkipped,
      suggested,
    });

    return successResponse({
      id: statementId,
      bankAccountId: account.id,
      accountName: account.name,
      txnCount: inserted.length,
      duplicatesSkipped,
      suggested,
      aiFlagged,
      totalCredits,
      totalDebits,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Check the account and the statement period";
      log.warn("statement refused: invalid fields", { bankAccountId, reason: message });
      return errorResponse(message, 400);
    }
    // Every line already on file for this account — the transaction rolled the statement back.
    if (error instanceof BankLineError) {
      log.warn("statement refused: every line already uploaded", { bankAccountId, lines: parsedCount, status: error.status });
      return errorResponse(error.message, error.status, { diagnostics: { step: "all_duplicates", fileStats } });
    }
    return failure(error, { scope: "bank-statements", step: "upload", bankAccountId });
  }
}
