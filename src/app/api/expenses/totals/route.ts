export const dynamic = "force-dynamic";

// GET /api/expenses/totals — the count and amount of EVERY expense matching the list's filters,
// not just the page on screen (plan 1210-expense-store, L9). Same filter as the list and the
// report (src/lib/expenses/filters.ts), so the three always agree.
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { buildExpenseWhere, filterKeys, parseExpenseFilter } from "@/lib/expenses/filters";

const log = createLogger("expenses:totals");

export async function GET(req: NextRequest) {
  try {
    await requireFeature("expenses", "view");
    const filter = parseExpenseFilter(new URL(req.url).searchParams);
    const where = await buildExpenseWhere(prisma, filter);

    const agg = await prisma.expense.aggregate({ where, _sum: { amount: true }, _count: { _all: true } });
    const result = { count: agg._count._all, amount: agg._sum.amount ?? 0 };

    log.debug("totals", { count: result.count, filters: filterKeys(filter) });
    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("totals failed", { reason: error instanceof Error ? error.message : String(error) });
    return errorResponse("Failed to total expenses", 500);
  }
}
