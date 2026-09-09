export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError, getServerSession } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { runAi, toAiErrorResponse, aiErrorKind } from "@/lib/ai";

const log = createLogger("bank-statements");

// GET — List uploaded statements
export async function GET() {
  try {
    await requireFeature("bills", "view");

    const statements = await prisma.bankStatement.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { uploadedBy: { select: { name: true } } },
    });

    return successResponse(statements);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch statements", 500);
  }
}

// POST — Upload and parse a bank statement with the configured AI provider (src/lib/ai)
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    await requireFeature("bills", "create");
    const userId = (session?.user as { userId?: string })?.userId || "";

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const bank = formData.get("bank") as string || "HDFC";

    if (!file) return errorResponse("No file uploaded", 400);

    // Read file content — handle both CSV/TXT and XLS/XLSX
    let text: string;
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".xls") || fileName.endsWith(".xlsx")) {
      // Binary Excel file — convert to CSV using xlsx package
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      text = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
    } else {
      // CSV or TXT — read as text directly
      text = await file.text();
    }

    if (!text || text.trim().length < 20) {
      return errorResponse(`File appears empty or unreadable (${text?.length || 0} chars). Ensure it's a valid CSV/XLS bank statement. File: ${file.name} (${Math.round(file.size / 1024)}KB)`, 400);
    }

    // Log first few lines for debugging
    const firstLines = text.split("\n").slice(0, 5).join(" | ");
    log.debug("statement received", {
      file: file.name,
      bytes: file.size,
      bank,
      sample: firstLines.slice(0, 200),
    });

    // Parse the CSV/XLS content with the AI provider — bank-specific hints
    const bankHints = bank === "ICICI"
      ? `ICICI bank statements typically have columns: S No., Value Date, Transaction Date, Cheque Number, Transaction Remarks, Withdrawal Amount (Dr), Deposit Amount (Cr), Balance. The date format is usually DD/MM/YYYY or DD-MM-YYYY. Some ICICI statements have headers spread across multiple rows or have a summary section at top — skip those and find the actual transaction rows.`
      : bank === "HDFC"
      ? `HDFC bank statements typically have columns: Date, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt., Closing Balance. The date format is usually DD/MM/YY or DD/MM/YYYY.`
      : `Parse the bank statement based on common column patterns.`;

    const parsePrompt = `You are an expert bank statement parser. Parse the following ${bank} bank statement data and extract ALL transactions.

${bankHints}

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

Bank statement data (${bank}):
${text.slice(0, 50000)}`;

    // Diagnostic info for error reporting
    const filePreview = text.split("\n").slice(0, 10).join("\n");
    const fileStats = { name: file.name, size: `${Math.round(file.size / 1024)}KB`, lines: text.split("\n").length, chars: text.length };

    // Call A — extract the transaction rows. runAi retries transient failures, refuses a
    // truncated reply (AiError "max_tokens") and parses the JSON (AiError "parse"), so the
    // only shape left to check here is "is it an array".
    let transactions: Array<{
      date: string; description: string; reference: string;
      amount: number; type: "CREDIT" | "DEBIT"; balance: number | null;
    }> = [];
    let responseText = "";

    try {
      log.debug("-> runAi bank.statement_parse", { file: file.name, bank, promptChars: parsePrompt.length });
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
          file: file.name,
          model: parseResult.model,
          type: parsed === null ? "null" : typeof parsed,
        });
        return Response.json({
          success: false,
          error: "AI returned invalid JSON. Try re-uploading or use a different file format.",
          diagnostics: { step: "json_parse", fileStats, filePreview, aiResponse: responseText.slice(0, 500) },
        }, { status: 500 });
      }
      transactions = parsed;
      log.info("statement parsed", { file: file.name, bank, transactions: transactions.length, model: parseResult.model });
    } catch (error) {
      const aiRes = toAiErrorResponse(error);
      if (!aiRes) {
        log.error("statement parse threw a non-AI error", { file: file.name, kind: aiErrorKind(error) });
        throw error;
      }
      // Same contract as before: { success: false, error, diagnostics: { step: "ai_call", ... } }
      // with the status and message toAiErrorResponse chose for this kind of failure.
      log.error("statement parse failed at the AI step", { file: file.name, status: aiRes.status, kind: aiErrorKind(error) });
      let body: Record<string, unknown>;
      try {
        body = (await aiRes.json()) as Record<string, unknown>;
      } catch (readError) {
        log.warn("could not read the AI error body; falling back to the message", { kind: aiErrorKind(readError) });
        body = { success: false, error: error instanceof Error ? error.message : "AI processing failed. Please try again." };
      }
      return Response.json(
        { ...body, diagnostics: { step: "ai_call", fileStats, filePreview } },
        { status: aiRes.status },
      );
    }

    if (transactions.length === 0) {
      return Response.json({
        success: false,
        error: "No transactions found in the uploaded file.",
        diagnostics: {
          step: "no_transactions",
          fileStats,
          filePreview,
          aiResponse: responseText.slice(0, 500),
          hint: responseText.includes("[]") ? "AI returned empty array — file format may not be a standard bank statement" : "AI could not identify transaction rows in the data",
        },
      }, { status: 400 });
    }

    // Calculate totals
    const totalCredits = transactions.filter(t => t.type === "CREDIT").reduce((s, t) => s + t.amount, 0);
    const totalDebits = transactions.filter(t => t.type === "DEBIT").reduce((s, t) => s + t.amount, 0);
    const dates = transactions.map(t => new Date(t.date)).filter(d => !isNaN(d.getTime()));
    const fromDate = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : undefined;
    const toDate = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : undefined;

    // Create statement with transactions
    const statement = await prisma.bankStatement.create({
      data: {
        bank,
        fileName: file.name,
        fromDate,
        toDate,
        totalCredits,
        totalDebits,
        txnCount: transactions.length,
        uploadedById: userId,
        transactions: {
          create: transactions.map(t => ({
            date: new Date(t.date),
            description: t.description,
            reference: t.reference || null,
            amount: t.amount,
            type: t.type as "CREDIT" | "DEBIT",
            balance: t.balance,
          })),
        },
      },
      include: { transactions: true },
    });

    // Now use the AI provider to match transactions against vendors and bills
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
${vendors.map(v => `${v.id}|${v.name}|${v.code}`).join("\n")}

PENDING BILLS (id, billNo, amount, balance, vendorId, vendorName):
${pendingBills.map(b => `${b.id}|${b.billNo}|${b.amount}|${b.amount - b.paidAmount}|${b.vendor.id}|${b.vendor.name}`).join("\n")}

BANK TRANSACTIONS TO MATCH:
${statement.transactions.map(t => `${t.id}|${t.date.toISOString().slice(0, 10)}|${t.description}|${t.amount}|${t.type}|${t.reference || ""}`).join("\n")}

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

    // Call B — vendor / bill matching. Non-fatal: the statement is already saved, so a
    // failure here leaves every transaction UNMATCHED for manual review.
    let matchedCount = 0;
    let flaggedCount = 0;

    try {
      log.debug("-> runAi bank.vendor_resolve", {
        statementId: statement.id,
        transactions: statement.transactions.length,
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

      const parsedMatches: unknown = matchResult.json;
      if (Array.isArray(parsedMatches)) {
        const matches: Array<{
          txnId: string; vendorId: string | null; billId: string | null;
          category: string; confidence: number; flagReason: string | null;
        }> = parsedMatches;
        log.info("vendor resolve finished", { statementId: statement.id, matches: matches.length, model: matchResult.model });

        for (const match of matches) {
          const updateData: Record<string, unknown> = {
            confidence: match.confidence || 0,
            suggestedCategory: match.category,
          };

          if (match.vendorId) updateData.suggestedVendorId = match.vendorId;
          if (match.billId) updateData.suggestedBillId = match.billId;

          if (match.flagReason) {
            updateData.matchStatus = "FLAGGED";
            updateData.flagReason = match.flagReason;
            flaggedCount++;
          } else if (match.vendorId || match.category?.startsWith("EXPENSE")) {
            updateData.matchStatus = "MATCHED";
            matchedCount++;
          }

          await prisma.bankTransaction.update({
            where: { id: match.txnId },
            data: updateData,
          }).catch((e: unknown) => {
            // The model can invent a txnId. Skip that row — but say so, or a statement
            // that comes back fully UNMATCHED has no trail to explain why.
            log.warn("vendor resolve: transaction update skipped", {
              statementId: statement.id,
              txnId: match.txnId,
              error: e instanceof Error ? e.message : String(e),
            });
          });
        }
      } else {
        log.warn("vendor resolve skipped", {
          statementId: statement.id,
          kind: "not_an_array",
          model: matchResult.model,
        });
      }
    } catch (error) {
      // AI matching failed — transactions stay UNMATCHED, user can review manually
      log.warn("vendor resolve skipped", { statementId: statement.id, kind: aiErrorKind(error) });
    }

    // Update statement counts
    await prisma.bankStatement.update({
      where: { id: statement.id },
      data: { matchedCount, flaggedCount },
    });

    return successResponse({
      id: statement.id,
      txnCount: transactions.length,
      matchedCount,
      flaggedCount,
      totalCredits,
      totalDebits,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to process statement", 500);
  }
}
