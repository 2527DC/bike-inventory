export const dynamic = "force-dynamic";

// GET /api/expenses/options — everything the entry form needs in one call
// (plan 1210-expense-store-department-and-payer, B3):
//
//   me             the signed-in person, with their assigned store (not carried in the session)
//   stores         active stores — the form auto-selects when there is exactly one (E5)
//   users          active staff, for "Paid by: staff member"
//   recentPayers   typed outsider names used in the last 180 days, most used first, so the
//                  same driver is typed the same way next time
//
// Guarded by expenses.create: anyone allowed to record an expense may name any payer (E3).
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { listStores } from "@/lib/stores";

const log = createLogger("expenses:options");

const RECENT_DAYS = 180;
const RECENT_LIMIT = 50;

export async function GET() {
  try {
    const user = await requireFeature("expenses", "create");
    const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);

    const [me, stores, users, recent] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id }, select: { id: true, name: true, storeId: true } }),
      listStores(),
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.expense.groupBy({
        by: ["paidBy"],
        where: { paidById: null, date: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { paidBy: "desc" } },
        take: RECENT_LIMIT,
      }),
    ]);

    const result = {
      me: { id: user.id, name: me?.name ?? user.name, storeId: me?.storeId ?? null },
      stores: stores.map((s) => ({ id: s.id, code: s.code, name: s.name })),
      users,
      recentPayers: recent.map((r) => ({ name: r.paidBy, count: r._count._all })),
    };

    log.debug("options", { stores: result.stores.length, users: users.length, recentPayers: recent.length });
    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("options failed", { reason: error instanceof Error ? error.message : String(error) });
    return errorResponse("Failed to load expense options", 500);
  }
}
