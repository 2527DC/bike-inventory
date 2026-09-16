import type { Prisma } from "@prisma/client";
import { createLogger } from "@/lib/logger";

const log = createLogger("warehouses:api");

/**
 * The FLOOR-warehouse rules of plan 1609-deliveries §1.7 (R30, R32, R33), shared by
 * POST /api/warehouses and PUT /api/warehouses/[id].
 *
 * - A FLOOR warehouse carries an invoice prefix. Mandatory in the application, nullable in the
 *   database, so a floor saved before 16 Sep stays valid until somebody edits it.
 * - A GODOWN never carries a prefix or the primary flag.
 * - Prefixes are unique across warehouses, compared trimmed and case-insensitively — the
 *   resolver matches case-insensitively, so "inv/" and "INV/" would claim the same invoices.
 * - A store with two or more ACTIVE floors has exactly one primary.
 *
 * Every check runs inside the caller's `$transaction` and refuses by throwing
 * `WarehouseRuleError`, so the write it guards is rolled back with it.
 */

type Tx = Prisma.TransactionClient;

export class WarehouseRuleError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WarehouseRuleError";
  }
}

export const FLOOR_NEEDS_PREFIX = "A floor warehouse needs an invoice prefix.";

/** Trimmed, and "" → null. A stored "" would prefix-match every invoice number. */
export function normalisePrefix(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return v.length > 0 ? v : null;
}

/** 409 naming the other warehouse when `prefix` is already taken (case-insensitive). */
export async function assertPrefixFree(tx: Tx, prefix: string, excludeId?: string): Promise<void> {
  const clash = await tx.warehouse.findFirst({
    where: {
      invoicePrefix: { equals: prefix, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true, store: { select: { name: true } } },
  });
  if (clash) {
    log.info("invoice prefix clash refused", { clashWarehouseId: clash.id, excludeId });
    throw new WarehouseRuleError(
      `Invoice prefix "${prefix}" is already used by ${clash.name} at ${clash.store.name}. Each floor warehouse needs its own.`,
      409
    );
  }
}

/**
 * Clear the primary flag on the store's other FLOOR warehouses. Runs BEFORE the write that sets
 * it, because the partial unique index `Warehouse_one_primary_floor_per_store` would otherwise
 * refuse the second primary.
 */
export async function clearOtherPrimaries(tx: Tx, storeId: string, exceptId?: string): Promise<void> {
  const { count } = await tx.warehouse.updateMany({
    where: { storeId, kind: "FLOOR", isPrimary: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isPrimary: false },
  });
  if (count > 0) log.info("primary floor moved", { storeId, cleared: count, primaryWarehouseId: exceptId });
}

/** After the write: a store with 2+ active floors and no primary → 400. */
export async function assertStoreHasPrimary(tx: Tx, storeId: string): Promise<void> {
  const floors = await tx.warehouse.findMany({
    where: { storeId, kind: "FLOOR", isActive: true },
    select: { isPrimary: true },
  });
  if (floors.length < 2 || floors.some((f) => f.isPrimary)) return;

  const store = await tx.store.findUnique({ where: { id: storeId }, select: { name: true } });
  log.info("store without primary floor refused", { storeId, floors: floors.length });
  throw new WarehouseRuleError(
    `Mark one floor warehouse of ${store?.name ?? "this store"} as primary.`,
    400
  );
}

/**
 * Map a Prisma unique violation that slipped past the checks above (two concurrent saves) to a
 * sentence. Returns null when the error is not a P2002.
 */
export function uniqueViolationMessage(error: unknown): string | null {
  const e = error as { code?: string; meta?: { target?: unknown } } | null;
  if (e?.code !== "P2002") return null;
  const target = String(e.meta?.target ?? "");
  if (target.includes("invoicePrefix")) return "That invoice prefix is already used by another warehouse.";
  // `code` before `storeId`: the composite (storeId, code) key names both columns, while the
  // partial primary index names only storeId (or itself).
  if (target.includes("code")) return "That code is already used by another warehouse.";
  if (target.includes("one_primary_floor") || target.includes("storeId")) {
    return "Another floor warehouse of this store was marked primary at the same time. Reload and try again.";
  }
  return "That value is already used by another warehouse.";
}
