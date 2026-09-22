import type { Prisma } from "@prisma/client";

/**
 * An approved bin audit gives its counted products that bin as their home bin
 * (plan 2209-audit-assigns-product-bin, Part A, R1).
 *
 *   - only lines counted above 0 (Q4a) — a 0 means "not on this shelf";
 *   - only products with no home bin yet (Q1a) — a product already homed elsewhere keeps it,
 *     and the /stock bin filter finds it in this bin through its units anyway.
 *
 * Runs inside the approval transaction, after the lines are applied, so a home bin can never
 * point at a count that was rejected or approved record-only (Q3a). Returns how many products
 * were given the bin.
 */
export async function assignBinToCountedProducts(
  tx: Prisma.TransactionClient,
  binId: string,
  lines: ReadonlyArray<{ productId: string; countedQty: number | null }>,
): Promise<number> {
  const ids = [
    ...new Set(lines.filter((l) => l.countedQty !== null && l.countedQty > 0).map((l) => l.productId)),
  ];
  if (ids.length === 0) return 0;
  const { count } = await tx.product.updateMany({
    where: { id: { in: ids }, binId: null },
    data: { binId },
  });
  return count;
}
