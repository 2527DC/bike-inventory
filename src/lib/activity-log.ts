import type { Prisma, PrismaClient } from "@prisma/client";
import { createLogger } from "@/lib/logger";

const log = createLogger("activity-log");

/**
 * The activity log writer (R11).
 *
 * ─── THE ONE THING THAT MATTERS HERE ──────────────────────────────────────────────────────
 *
 * How this behaves on failure depends on WHICH client you hand it, and that is the whole
 * design:
 *
 *   logActivity(tx, …)      inside a transaction — the log row is PART of the change.
 *                           A failed insert fails the business action. Use this whenever the
 *                           log is evidence: an approval, a dispatch, a stock movement.
 *
 *   logActivity(prisma, …)  on the root client — best effort. It NEVER throws, because a
 *                           full log table must not stop a person receiving a shipment.
 *                           A failure is recorded with log.error and the identifiers needed
 *                           to reconstruct the entry by hand.
 *
 * Detected by `"$transaction" in db`: the root `PrismaClient` has that method, a
 * `Prisma.TransactionClient` does not. That is a structural check rather than a flag the
 * caller can get wrong, which matters — passing `prisma` where you meant `tx` would silently
 * downgrade an audit trail to best-effort, and no type error would tell you.
 *
 * ─── WHY THE USER IS DENORMALISED ─────────────────────────────────────────────────────────
 *
 * `userId`/`userName` are plain columns with no foreign key (see the model comment). Pass the
 * name you already have from the session; do not look it up. A log entry outlives the user it
 * names, and "by Ravi" must still read correctly after Ravi is deleted.
 */

/** Anything that can run a query: the root client, or a transaction client inside `$transaction`. */
export type Db = PrismaClient | Prisma.TransactionClient;

export interface ActivityEntry {
  /** RBAC module key: stock_audit | inbound | vendor_issues | zoho | categories | customers | purchase_orders | transfers */
  module: string;
  /** created | updated | status_changed | approved | rejected | received | delivered | issue_reported | pulled | imported | sent | dispatched | cancelled */
  action: string;
  /** StockCount | InboundShipment | VendorIssue | Category | Customer | ZohoPull | PurchaseOrder | TransferOrder */
  entityType: string;
  entityId: string;
  /** The human-readable reference: SC-202609-0003, PO-00042. Shown in the feed instead of a cuid. */
  entityRef?: string | null;
  /** Named fromValue/toValue, not from/to: both are SQL keywords. */
  fromValue?: string | null;
  toValue?: string | null;
  details?: string | null;
  userId: string;
  /** Snapshot taken at write time — see the note above. */
  userName: string;
}

/**
 * True when `db` is a transaction client rather than the root client.
 *
 * Deliberately a plain boolean and NOT a `db is Prisma.TransactionClient` type predicate.
 * `Prisma.TransactionClient` is `Omit<PrismaClient, ITXClientDenyList>`, so `PrismaClient`
 * is assignable TO it — which means a predicate narrows the false branch to `never` and
 * `db.activityLog` stops existing. The union is more useful than the narrowing here: both
 * members carry `.activityLog`, so leaving `db` as `Db` type-checks in both branches.
 */
function isTransactionClient(db: Db): boolean {
  return !("$transaction" in db);
}

/**
 * Write one activity entry.
 *
 * Inside a transaction this throws on failure (deliberately — the log is part of the change).
 * On the root client it swallows and logs.
 */
export async function logActivity(db: Db, entry: ActivityEntry): Promise<void> {
  const data = {
    module: entry.module,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityRef: entry.entityRef ?? null,
    fromValue: entry.fromValue ?? null,
    toValue: entry.toValue ?? null,
    details: entry.details ?? null,
    userId: entry.userId,
    userName: entry.userName,
  };

  // Inside a transaction: let it throw. The caller's action fails with it, which is the point.
  if (isTransactionClient(db)) {
    await db.activityLog.create({ data });
    log.debug("activity logged (in transaction)", {
      module: entry.module,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
    });
    return;
  }

  // On the root client: best effort. A logging failure must not become a business failure.
  try {
    await db.activityLog.create({ data });
    log.debug("activity logged", {
      module: entry.module,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
    });
  } catch (error) {
    // Every identifier needed to reconstruct the row by hand, and nothing else — `details`
    // is free text a caller may have filled from a payload, so it stays out of the log line.
    log.error("activity log write failed", {
      module: entry.module,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityRef: entry.entityRef ?? null,
      userId: entry.userId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
