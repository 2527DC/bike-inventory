import { Prisma } from "@prisma/client";

/** Digits in a transfer number: `TRF-202609-0007`. The series restarts each month. */
export const TRF_SEQUENCE_PAD = 4;

/** The counter key for a month's transfer series. `TRF-202609`. */
export function trfSequenceKey(ym: string): string {
  return `TRF-${ym}`;
}

/**
 * The seed query for the `TRF-YYYYMM` series.
 *
 * ─── split_part, NOT a whole-string strip. THIS IS A TRAP ─────────────────────────────────
 *
 * `nextSequence`'s own docstring uses TRF as its worked example and shows a WHOLE-STRING
 * strip:
 *
 *     regexp_replace("orderNo", '\D', '', 'g')::int      -- WRONG for this format
 *
 * On `TRF-202609-0007` that removes every non-digit and yields **2026090007**, not 7. The
 * counter would start twenty billion numbers into the series, every transfer number would be
 * eleven digits, and the `LIKE` scoping would never let it recover.
 *
 * It is a fine query for `PO-00042`, which has exactly one digit run. It is wrong for any
 * format carrying the month, which is why `ibSeedSql` uses `split_part("shipmentNo", '-', 3)`
 * — the third dash-separated field, i.e. the sequence tail alone. This copies that, because
 * `TRF-202609-0007` has the same three-part shape as `IB-202609-0007`.
 *
 * Still numeric, never a string sort: `MAX()` over text would rank "0002" above "00010" and
 * hand out a number that already exists — the original allocator's bug.
 *
 * Runs ONCE per key, on the first allocation after the counter row is missing.
 */
export function trfSeedSql(prefix: string): Prisma.Sql {
  return Prisma.sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(split_part("orderNo", '-', 3), '\\D', '', 'g'), '')::int),
      0
    )
    FROM "TransferOrder"
    WHERE "orderNo" LIKE ${prefix + "-%"}
  `;
}

/**
 * The current month as `YYYYMM`, in IST.
 *
 * The month in a transfer number is the month the person raising it is living in. A transfer
 * created at 03:00 IST on 1 October is an October transfer; `getUTCMonth()` would file it under
 * September, because 03:00 IST is 21:30 the previous day in UTC. That is a five-and-a-half hour
 * window at the start of every month in which the numbering silently disagrees with the date
 * printed beside it.
 */
export function currentTransferYm(now: Date = new Date()): string {
  const ist = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).format(now);
  // en-CA gives "2026-09"; the series key wants "202609".
  return ist.replace("-", "");
}
