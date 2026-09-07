import { Prisma } from "@prisma/client";

/** The counter key for the purchase-order series. One series, never reset. */
export const PO_SEQUENCE_KEY = "PO";

/** Digits in a PO number: `PO-00042`. */
export const PO_SEQUENCE_PAD = 5;

/**
 * The seed query for the `PO-00042` series.
 *
 * Lives here rather than at the call site because `PO-` had TWO allocators that disagreed —
 * `api/purchase-orders/route.ts` padded to 5 and ordered by `createdAt`, while
 * `brand-stock/uploads/[id]/generate-po` padded to 4 and ordered by `poNumber` as a STRING.
 * That second one is not merely racy: once `PO-00010` exists it sorts below `PO-0002`, so the
 * route reads the wrong "last" PO and emits a number already taken. `poNumber` is `@unique`,
 * so the loser got a raw P2002. Both are replaced by `nextSequence` and this one definition.
 *
 * WHOLE-STRING strip, not `split_part`, unlike the IB- and ISS- seeds. A PO number is
 * `PO-<digits>` with exactly one digit run, so stripping every non-digit gives the number
 * directly — and it makes the legacy padding irrelevant: `PO-0042` and `PO-00042` both read
 * as 42. That is what lets the 4-digit rows this codebase used to write collapse into the
 * same series without a special case.
 *
 * ⚠ It is whole-string, so it would misread a format with more than one digit run:
 * `PO-2026-0042` would come back as 20260042 and push the counter far past reality. Neither
 * allocator on disk has ever produced such a number, and MIG-1a normalised the legacy
 * `^PO-\d{4}$` rows to five digits. If an imported PO number in another shape ever lands in
 * this table, this query is the thing to revisit.
 *
 * Runs ONCE per key, on the first allocation after the counter row is missing.
 */
export function poSeedSql(): Prisma.Sql {
  return Prisma.sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace("poNumber", '\\D', '', 'g'), '')::int),
      0
    )
    FROM "PurchaseOrder"
  `;
}
