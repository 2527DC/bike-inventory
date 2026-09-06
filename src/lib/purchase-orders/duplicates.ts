import type { Db } from "@/lib/activity-log";
import { OPEN_PO_STATUSES } from "./status";

export interface PoConflict {
  poId: string;
  poNumber: string;
  status: string;
  /** The requested products that are already on this PO. */
  productIds: string[];
  /** Their names, in the same order, so the screen can say what rather than which id. */
  productNames: string[];
}

/**
 * Which of these products are already on an OPEN purchase order for this vendor?
 *
 * This is the "do not order the same thing twice" rule. It is deliberately scoped by VENDOR:
 * ordering the same product from two different suppliers is a normal thing to do (a second
 * source, a better price), while ordering it twice from the same one is almost always someone
 * re-doing work that is already in flight.
 *
 * "Open" excludes RECEIVED and CANCELLED — see OPEN_PO_STATUSES. The goods arrived or the
 * order was called off, and re-ordering after either is legitimate.
 *
 * WHAT THIS DOES NOT CATCH, stated so nobody assumes otherwise: it answers "is this product
 * on an open PO", not "has this brand-stock upload already been ordered". Re-running the same
 * sheet after its first PO is received or cancelled produces a second PO and this rule will
 * not object. A real answer to that question needs a link between the upload and the PO, and
 * there is none in the schema — not a foreign key in either direction, and no
 * BrandStockUploadStatus value meaning "ordered".
 *
 * @param db must be the SAME transaction client that holds the advisory lock. Called on the
 *           root client it would read outside the lock's protection and two concurrent
 *           creates could both find nothing.
 */
export async function findOpenPoConflicts(
  db: Db,
  vendorId: string,
  productIds: string[]
): Promise<PoConflict[]> {
  if (productIds.length === 0) return [];

  const rows = await db.purchaseOrder.findMany({
    where: {
      vendorId,
      status: { in: OPEN_PO_STATUSES },
      items: { some: { productId: { in: productIds } } },
    },
    select: {
      id: true,
      poNumber: true,
      status: true,
      items: {
        // Only the overlapping lines. Without this `where` the response would carry every line
        // of a fifty-line PO to report the one that clashed.
        where: { productId: { in: productIds } },
        select: { productId: true, product: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((po) => ({
    poId: po.id,
    poNumber: po.poNumber,
    status: po.status,
    productIds: po.items.map((i) => i.productId),
    productNames: po.items.map((i) => i.product.name),
  }));
}

/** The sentence for the 409. The structured conflicts ride alongside it in the response body. */
export function conflictMessage(conflicts: PoConflict[]): string {
  if (conflicts.length === 1) {
    const c = conflicts[0];
    return `Already on ${c.poNumber}: ${c.productNames.join(", ")}`;
  }
  return `Already on ${conflicts.length} open purchase orders: ${conflicts
    .map((c) => `${c.poNumber} (${c.productNames.length})`)
    .join(", ")}`;
}
