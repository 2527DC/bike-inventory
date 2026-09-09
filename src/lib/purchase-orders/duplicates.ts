import type { Db } from "@/lib/activity-log";
import { OPEN_PO_STATUSES } from "./status";

export interface PoConflict {
  poId: string;
  poNumber: string;
  status: string;
  /** The requested products (linked lines) that are already on this PO. */
  productIds: string[];
  /** Their names, in the same order, so the screen can say what rather than which id. */
  productNames: string[];
  /**
   * The requested item NAMES already on this PO — the key for a line that has no product
   * (plan 0909, D2). Compared case-insensitively after trimming. A linked line that also
   * matches by name appears here too; the 409 sentence lists each name once.
   */
  names: string[];
}

/** What a create wants checked: the linked lines' product ids and every line's name. */
export interface PoConflictKeys {
  productIds: string[];
  names: string[];
}

/** `lower(trim(name))` — the equality the name key uses on both sides. */
export function normalizeLineName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Which of these lines are already on an OPEN purchase order for this vendor?
 *
 * This is the "do not order the same thing twice" rule. It is deliberately scoped by VENDOR:
 * ordering the same product from two different suppliers is a normal thing to do (a second
 * source, a better price), while ordering it twice from the same one is almost always someone
 * re-doing work that is already in flight.
 *
 * Two keys, because a line may or may not carry a product (plan 0909, D2):
 *   - `productId`, for a line linked to the catalogue — as before;
 *   - the normalised `name`, for every line. A sheet-built line is only its name, so the
 *     name is the only thing two orders of it can share.
 *
 * "Open" excludes RECEIVED and CANCELLED — see OPEN_PO_STATUSES. The goods arrived or the
 * order was called off, and re-ordering after either is legitimate.
 *
 * WHAT THIS DOES NOT CATCH, stated so nobody assumes otherwise: it answers "is this line on an
 * open PO", not "has this sheet already been ordered". Re-uploading the same file after its
 * first PO is received or cancelled produces a second PO and this rule will not object. A
 * real answer to that question needs a link between the upload and the PO, and there is none
 * by design — the review rows and the uploaded file are deleted the moment the PO is created
 * (0909 plan, Q6), so nothing survives to point back at.
 *
 * @param db must be the SAME transaction client that holds the advisory lock. Called on the
 *           root client it would read outside the lock's protection and two concurrent
 *           creates could both find nothing.
 */
export async function findOpenPoConflicts(
  db: Db,
  vendorId: string,
  keys: PoConflictKeys
): Promise<PoConflict[]> {
  const productIds = [...new Set(keys.productIds)];
  const wanted = new Set(keys.names.map(normalizeLineName).filter(Boolean));
  // Prisma's `in` + insensitive mode does the case; the trim is applied on read below. The
  // list sent is the trimmed form, which is also how create.ts stores a name.
  const names = [...new Set(keys.names.map((n) => n.trim()).filter(Boolean))];
  if (productIds.length === 0 && names.length === 0) return [];

  const lineMatch = {
    OR: [
      ...(productIds.length > 0 ? [{ productId: { in: productIds } }] : []),
      ...(names.length > 0 ? [{ name: { in: names, mode: "insensitive" as const } }] : []),
    ],
  };

  const rows = await db.purchaseOrder.findMany({
    where: {
      vendorId,
      status: { in: OPEN_PO_STATUSES },
      items: { some: lineMatch },
    },
    select: {
      id: true,
      poNumber: true,
      status: true,
      items: {
        // Only the overlapping lines. Without this `where` the response would carry every line
        // of a fifty-line PO to report the one that clashed.
        where: lineMatch,
        select: { productId: true, name: true, product: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const requested = new Set(productIds);
  return rows.flatMap((po) => {
    const byProduct = po.items.filter((i) => i.productId !== null && requested.has(i.productId));
    const byName = po.items.filter((i) => wanted.has(normalizeLineName(i.name)));
    if (byProduct.length === 0 && byName.length === 0) return [];
    return [
      {
        poId: po.id,
        poNumber: po.poNumber,
        status: po.status,
        productIds: byProduct.map((i) => i.productId as string),
        productNames: byProduct.map((i) => i.product?.name ?? i.name),
        names: [...new Set(byName.map((i) => i.name.trim()))],
      },
    ];
  });
}

/** Every clashing description on one PO, each once — product names first, then bare names. */
function conflictNames(c: PoConflict): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of [...c.productNames, ...c.names]) {
    const key = normalizeLineName(n);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/** The sentence for the 409. The structured conflicts ride alongside it in the response body. */
export function conflictMessage(conflicts: PoConflict[]): string {
  if (conflicts.length === 1) {
    const c = conflicts[0];
    return `Already on ${c.poNumber}: ${conflictNames(c).join(", ")}`;
  }
  return `Already on ${conflicts.length} open purchase orders: ${conflicts
    .map((c) => `${c.poNumber} (${conflictNames(c).length})`)
    .join(", ")}`;
}
