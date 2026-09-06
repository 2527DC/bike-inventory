import { Prisma } from "@prisma/client";

/**
 * The seed query for the `ISS-YYYYMM` issue-number series.
 *
 * Lives here rather than at either call site because `ISS-` has TWO allocators — the Ops
 * Issues create in `api/vendor-issues/route.ts` and Report Issue on the goods desk in
 * `api/inbound/[id]/issues/route.ts` — and two allocators disagreeing about how to read the
 * current maximum is the exact hazard `nextSequence` exists to remove. `VendorIssue.issueNo`
 * is `@unique`, so a disagreement is not a cosmetic gap: it is a failed write for whoever
 * loses. One definition, both callers.
 *
 * NUMERIC, not a string sort. `split_part(issueNo, '-', 3)` takes the tail of
 * "ISS-202609-0007" (the "0007"), strips anything that is not a digit and casts to int — so
 * "ISS-202609-00010" correctly outranks "ISS-202609-0002". The allocator this replaces
 * ordered by `issueNo` descending as a STRING, which gets that pair the wrong way round and
 * hands out a number that already exists.
 *
 * Scoped to the month by the LIKE, because the series restarts each month.
 *
 * Runs ONCE per key, on the first allocation after the counter row is missing — see
 * `nextSequence`.
 */
export function issSeedSql(prefix: string): Prisma.Sql {
  return Prisma.sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(split_part("issueNo", '-', 3), '\D', '', 'g'), '')::int),
      0
    )
    FROM "VendorIssue"
    WHERE "issueNo" LIKE ${prefix + "-%"}
  `;
}
