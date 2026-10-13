// Who paid an expense, and from which store's money — the two rules every route that writes an
// expense must apply the same way (plan 1210-expense-store-department-and-payer, B1).
//
// They live here rather than inside each route because two routes write expenses (the entry
// form's POST /api/expenses and the bank-reconcile "Expense" action), and two copies of a rule
// are how they drift apart.
//
// No permission is checked here. Anyone holding expenses.create may name any payer (decision
// E3, 12 Oct 2026); the route's requireFeature is the whole gate.
import type { Prisma, PrismaClient } from "@prisma/client";
import { storeById, type StoreRef } from "@/lib/stores";
import { createLogger } from "@/lib/logger";
import type { CurrentUser } from "@/lib/auth-helpers";
import type { ExpensePayerInput } from "@/lib/validations";

const log = createLogger("expenses:assignment");

type Db = PrismaClient | Prisma.TransactionClient;

/** A rule refused the input. The route turns it into a 400 carrying `message` as written. */
export class ExpenseAssignmentError extends Error {
  readonly status = 400;
}

/**
 * The store an expense is charged to. Active stores only — a deactivated store is hidden from
 * every picker, so a request naming one is stale or hand-made.
 */
export async function resolveStore(storeId: string | undefined, actorId: string): Promise<StoreRef> {
  const store = storeId ? await storeById(storeId) : null;
  if (!store) {
    log.warn("store refused", { actorId, reason: storeId ? "unknown or inactive store" : "no store" });
    throw new ExpenseAssignmentError("Pick the store this expense belongs to.");
  }
  return store;
}

/**
 * Collapse a typed outsider's name the way the report groups it: trimmed, inner runs of
 * whitespace made one space. Case is kept for display; grouping lower-cases separately
 * (src/lib/expenses/filters.ts → payerKey).
 */
export function normalisePayerName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Who paid. `paidBy` is always filled so every reader of the old text column keeps working;
 * `paidById` is set only when the payer is a staff user.
 */
export async function resolvePayer(
  db: Db,
  actor: CurrentUser,
  payer: ExpensePayerInput
): Promise<{ paidById: string | null; paidBy: string }> {
  if (payer.kind === "self" || (payer.kind === "user" && payer.userId === actor.id)) {
    return { paidById: actor.id, paidBy: actor.name };
  }

  if (payer.kind === "user") {
    const user = await db.user.findUnique({
      where: { id: payer.userId },
      select: { id: true, name: true, isActive: true },
    });
    if (!user || !user.isActive) {
      log.warn("payer refused", { actorId: actor.id, reason: user ? "inactive user" : "unknown user" });
      throw new ExpenseAssignmentError("That staff member is not active. Pick someone else.");
    }
    return { paidById: user.id, paidBy: user.name };
  }

  const name = normalisePayerName(payer.name);
  if (name.length < 2 || name.length > 80) {
    // The typed name itself is never logged — it is a person's name.
    log.warn("payer refused", { actorId: actor.id, reason: "typed name length", length: name.length });
    throw new ExpenseAssignmentError("Type the payer's name (2 to 80 characters).");
  }
  return { paidById: null, paidBy: name };
}
