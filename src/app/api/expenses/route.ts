export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { expenseSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { resolvePayer, resolveStore, ExpenseAssignmentError } from "@/lib/expenses/assignment";
import { buildExpenseWhere, EXPENSE_INCLUDE, filterKeys, parseExpenseFilter } from "@/lib/expenses/filters";

const log = createLogger("expenses:api");

// GET /api/expenses — newest first. Filters: see src/lib/expenses/filters.ts. No date given
// means no date limit, as before; the report is the one that defaults to this month.
export async function GET(req: NextRequest) {
  try {
    await requireFeature("expenses", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    const filter = parseExpenseFilter(searchParams);
    const where = await buildExpenseWhere(prisma, filter);

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: EXPENSE_INCLUDE,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
      }),
      prisma.expense.count({ where }),
    ]);

    log.debug("list", { count: expenses.length, total, filters: filterKeys(filter) });
    return paginatedResponse(expenses, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("list failed", { reason: error instanceof Error ? error.message : String(error) });
    return errorResponse("Failed to fetch expenses", 500);
  }
}

// POST /api/expenses — one expense. The store and the payer are resolved server-side
// (src/lib/expenses/assignment.ts); `recordedById` is always the person signed in.
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("expenses", "create");
    const body = await req.json();
    const data = expenseSchema.parse(body);

    const date = new Date(data.date);
    if (Number.isNaN(date.getTime())) return errorResponse("Date is not valid", 400);

    const store = await resolveStore(data.storeId, user.id);
    const payer = await resolvePayer(prisma, user, data.payer);

    const expense = await prisma.expense.create({
      data: {
        date,
        amount: data.amount,
        category: data.category,
        description: data.description?.trim() || data.category.replace(/_/g, " "),
        paidBy: payer.paidBy,
        paidById: payer.paidById,
        storeId: store.id,
        paymentMode: data.paymentMode,
        referenceNo: data.referenceNo,
        receiptUrl: data.receiptUrl ?? null,
        notes: data.notes,
        recordedById: user.id,
      },
      include: EXPENSE_INCLUDE,
    });

    log.info("expense recorded", {
      expenseId: expense.id,
      storeId: store.id,
      payerKind: data.payer.kind,
      paidById: payer.paidById,
      recordedById: user.id,
    });
    return successResponse(expense, 201);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("record refused", { status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid expense details";
      log.warn("record failed validation", { message });
      return errorResponse(message, 400);
    }
    if (error instanceof ExpenseAssignmentError) return errorResponse(error.message, error.status);
    log.error("record failed", { reason: error instanceof Error ? error.message : String(error) });
    return errorResponse("Failed to record expense", 500);
  }
}
