export const dynamic = "force-dynamic";

// POST /api/expenses/batch — several expenses, one Submit, one transaction.
//
// The stepped entry flow (/expenses/new) builds a batch in the browser and commits it here.
// Two things are decided server-side and never read from the body:
//
//   paidBy       — the signed-in user's name (plan decision D2). A client that could send any
//                  name could record an expense under someone else's.
//   recordedById — the signed-in user's id, same as the single-row POST.
//
// The batch is all-or-nothing (Q1a): every row lands or none does. A person standing at the
// counter with half a batch recorded is worse off than one with none, because they cannot tell
// which half without opening the list.
import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { expenseBatchSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("expenses:batch");

export async function POST(req: NextRequest) {
  let count = 0;
  try {
    const user = await requireFeature("expenses", "create");
    const body = await req.json();
    const data = expenseBatchSchema.parse(body);
    count = data.expenses.length;

    const date = new Date(data.date);
    if (Number.isNaN(date.getTime())) return errorResponse("Date is not valid", 400);

    const rows = data.expenses.map((e) => ({
      date,
      amount: e.amount,
      category: e.category,
      description: e.description,
      paidBy: user.name,
      paymentMode: e.paymentMode,
      referenceNo: e.referenceNo,
      receiptUrl: e.receiptUrl,
      notes: e.notes,
      recordedById: user.id,
    }));
    const total = rows.reduce((sum, r) => sum + r.amount, 0);

    // The array form of $transaction runs every create in ONE database transaction and hands
    // back the created rows, which createMany cannot — the client gets ids, the log gets a
    // count, and a failure on row 7 rolls back rows 1–6.
    const created = await prisma.$transaction(
      rows.map((r) => prisma.expense.create({ data: r, select: { id: true } }))
    );

    log.info("batch recorded", { count: created.length, total, recordedById: user.id });
    return successResponse({ count: created.length, total, ids: created.map((c) => c.id) }, 201);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("batch refused", { count, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid expense details";
      log.warn("batch failed validation", { count, message });
      return errorResponse(message, 400);
    }
    const reason = error instanceof Error ? error.message : String(error);
    log.error("batch failed", { count, reason });
    return errorResponse(error instanceof Error ? error.message : "Failed to record expenses", 400);
  }
}
