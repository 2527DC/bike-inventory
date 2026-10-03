import type { Prisma, PrismaClient } from "@prisma/client";
import { LIVE_UNIT_STATUSES } from "@/lib/units";
import { getBinQtyMap } from "@/lib/units/bin-qty";
import { createLogger } from "@/lib/logger";

const log = createLogger("bins:delete-check");

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * What still stops a bin being deleted — plan 0310-bin-delete-multi-category-rules-and-transfer-
 * directions, R2, Q9, Q10.
 *
 * ONE answer for every path that retires a bin: `DELETE /api/bins/[id]`, the refusal of
 * `isActive: false` on PATCH, and `POST /api/bins` bringing a deleted code back. The old DELETE
 * summed `_count` of units, BinStock rows and products, which was wrong both ways: a sold unit
 * keeps its old `binId` and a recount leaves 0-quantity rows, so an EMPTY bin was refused; and a
 * second-hand cycle or an unfinished audit of the bin was never looked at.
 *
 * - `items` is `getBinQtyMap`, the figure the bin audit already trusts: live units, plus the
 *   typed-in quantity of products that have never had a unit. Sold / lost / in-transit units and
 *   0-quantity rows count as nothing.
 * - `secondHand` — second-hand cycles still IN_STOCK on this shelf.
 * - `openAudits` — a count of this bin that is not approved or rejected yet. Approving it writes
 *   units and product bins INTO the bin, so it must finish first (Q10).
 *
 * `Product.binId` and the bin's home-bin rules are NOT blockers: the owner chose to clear and
 * delete those with the bin (Q1).
 */

export const OPEN_AUDIT_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"];

export interface BinDeleteBlockers {
  /** Live units + uncoded loose quantity in the bin. */
  items: number;
  liveUnits: number;
  looseQty: number;
  secondHand: number;
  openAudits: { id: string; countNo: string | null; status: string }[];
  empty: boolean;
}

export async function binDeleteBlockers(db: Db, binId: string): Promise<BinDeleteBlockers> {
  // `getBinQtyMap` merges both sources per product; the live-unit count is read beside it so the
  // refusal can say "3 coded, 1 loose" instead of a bare number nobody can act on.
  const [qty, liveUnits, secondHand, openAudits] = await Promise.all([
    getBinQtyMap(binId, undefined, db),
    db.inventoryUnit.count({ where: { binId, status: { in: LIVE_UNIT_STATUSES } } }),
    db.secondHandCycle.count({ where: { binId, status: "IN_STOCK" } }),
    db.stockCount.findMany({
      where: { binId, status: { in: OPEN_AUDIT_STATUSES } },
      select: { id: true, countNo: true, status: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  let items = 0;
  for (const n of qty.values()) items += n;
  const looseQty = Math.max(0, items - liveUnits);

  const result: BinDeleteBlockers = {
    items,
    liveUnits,
    looseQty,
    secondHand,
    openAudits,
    empty: items === 0 && secondHand === 0 && openAudits.length === 0,
  };
  log.debug("bin delete check", {
    binId,
    items,
    liveUnits,
    looseQty,
    secondHand,
    openAudits: openAudits.length,
  });
  return result;
}

/**
 * The sentence a refusal shows — names what is in the bin and what to do about it, so the person
 * is never left with "cannot delete" and no next step.
 */
export function binDeleteRefusal(code: string, b: BinDeleteBlockers): string {
  const parts: string[] = [];
  if (b.items > 0) {
    const split: string[] = [];
    if (b.liveUnits > 0) split.push(`${b.liveUnits} coded`);
    if (b.looseQty > 0) split.push(`${b.looseQty} loose`);
    parts.push(
      `still holds ${b.items} item${b.items === 1 ? "" : "s"}${split.length > 1 ? ` (${split.join(", ")})` : ""}`
    );
  }
  if (b.secondHand > 0) {
    parts.push(`has ${b.secondHand} second-hand cycle${b.secondHand === 1 ? "" : "s"} in stock`);
  }
  const sentences: string[] = [];
  if (parts.length > 0) {
    sentences.push(`Bin ${code} ${parts.join(" and ")}. Move them to another bin first.`);
  }
  if (b.openAudits.length > 0) {
    const names = b.openAudits.map((a) => a.countNo ?? "an unnumbered audit").join(", ");
    sentences.push(
      `Bin ${code} has an unfinished stock audit (${names}). Approve or reject it first.`
    );
  }
  return sentences.join(" ");
}
