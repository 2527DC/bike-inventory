import { Prisma } from "@prisma/client";

/**
 * The seed query for the `IB-YYYYMM` shipment-number series.
 *
 * Lives here rather than at either call site because `IB-` has TWO allocators — the manual
 * create in `api/inbound/route.ts` and the import loop in `api/zoho/pull-review/approve` —
 * and two allocators disagreeing about how to read the current maximum is the exact hazard
 * `nextSequence` exists to remove. One definition, both callers.
 *
 * NUMERIC, not a string sort. `split_part(shipmentNo, '-', 3)` takes the tail of
 * "IB-202609-0007" (the "0007"), strips anything that is not a digit, and casts to int —
 * so "IB-202609-00010" correctly outranks "IB-202609-0002". A `MAX()` on the raw string
 * would not, which is the bug that made the old allocator hand out duplicates.
 *
 * Scoped to the month by the LIKE, because the series restarts each month.
 *
 * Runs ONCE per key, on the first allocation after the counter row is missing — see
 * `nextSequence`.
 */
export function ibSeedSql(prefix: string): Prisma.Sql {
  return Prisma.sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(split_part("shipmentNo", '-', 3), '\D', '', 'g'), '')::int),
      0
    )
    FROM "InboundShipment"
    WHERE "shipmentNo" LIKE ${prefix + "-%"}
  `;
}
