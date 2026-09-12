import { Prisma, type PrismaClient } from "@prisma/client";
import { createLogger } from "@/lib/logger";

const log = createLogger("sequence");

/**
 * Document number allocation: PO-00042, SC-202609-0003, TRF-202609-0007, IB-202609-0001.
 *
 * ─── THE BUG THIS REPLACES ────────────────────────────────────────────────────────────────
 *
 * Every existing allocator does the same two things wrong:
 *
 *     const last = await prisma.purchaseOrder.findFirst({ orderBy: { poNumber: "desc" } });
 *     const next = (parseInt(last.poNumber.split("-")[1]) || 0) + 1;
 *
 *   1. READ-THEN-WRITE. Two people clicking at once both read 41 and both write PO-00042.
 *      One of them gets a unique-constraint error and loses their work.
 *   2. STRING ordering. "PO-0002" sorts ABOVE "PO-00010", so once the numbers reach four
 *      digits the "highest" number found is wrong and the allocator hands out a duplicate
 *      that already exists.
 *
 * ─── HOW THIS FIXES IT ────────────────────────────────────────────────────────────────────
 *
 * ONE statement, and the row lock taken by `DO UPDATE` serialises every concurrent caller:
 *
 *     INSERT INTO counter(key, current) VALUES ($1, $2 + 1)
 *     ON CONFLICT (key) DO UPDATE SET current = counter.current + 1
 *     RETURNING current
 *
 * Two callers racing on a MISSING key both succeed and neither collides: the first inserts
 * seed+1, the second conflicts and updates to seed+2. There is no window between the read
 * and the write because there is no read.
 *
 * ─── WHY IT SEEDS ITSELF INSTEAD OF BEING SEEDED BY THE MIGRATION ─────────────────────────
 *
 * The `counter` table lands in MIG-1a, weeks before P7/P9/P14 switch their allocators onto
 * it. An `INSERT … SELECT MAX(...)` written into that migration would be stale by the time
 * the first caller arrives — every PO raised in between would be invisible to it, and the
 * counter would start handing out numbers that already exist.
 *
 * ─── WRITE `\\D`, NOT `\D`, IN THE SEED QUERY ────────────────────────────────────────────
 *
 * `Prisma.sql` is a TAGGED template and it reads the COOKED strings. `\D` is not a recognised
 * JavaScript escape, so it cooks to a bare `D` — and what Postgres actually receives is
 * `regexp_replace(x, 'D', '', 'g')`, which strips the LETTER D and nothing else.
 *
 * Every seed in this codebase was originally written with one backslash, and four of the five
 * got away with it: they `split_part` the tail off first, so the value being stripped is
 * already all digits and removing no characters is harmless. `poSeedSql` strips the whole
 * string, so it received "PO-00042" with nothing removed and threw 22P02, `invalid input
 * syntax for type integer`. And because this function runs the seed on EVERY call — not only
 * the first — that was a 500 on every purchase order raised once a single PO row existed.
 *
 * It went unnoticed because the local database had no PurchaseOrder rows, so `MAX()` over an
 * empty table returned NULL and the cast never happened. Found on 7 Sep 2026 by a P14 proof
 * that planted a row:
 *
 *     regexp_replace('PO-00042', '\D',  '', 'g')  ->  "PO-00042"   (nothing stripped)
 *     regexp_replace('PO-00042', '\\D', '', 'g')  ->  "00042"      (correct)
 *
 * So the CALLER passes `seedSql`: a query returning this series' current numeric maximum.
 * It runs only on the first call for a key, and it must parse the tail NUMERICALLY —
 * `regexp_replace(…, '\D', '', 'g')::int`, never a string sort, or it reintroduces bug 2.
 */

export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Allocate the next number in a series.
 *
 * @param db      A transaction client, normally. Allocation belongs in the same transaction
 *                as the row it numbers — otherwise a rolled-back create burns a number.
 * @param key     The series: "PO", or "SC-202609" for a series that restarts each month.
 * @param pad     Digits to pad to. PO is 5 (PO-00042); the monthly series are 4.
 * @param seedSql A query returning ONE integer column: the highest number already used in
 *                this series, parsed numerically. Used only when the key does not exist yet.
 *                Example for PO:
 *
 *                  Prisma.sql`SELECT COALESCE(MAX(NULLIF(regexp_replace("poNumber", '\D', '', 'g'), '')::int), 0) FROM "PurchaseOrder"`
 *
 *                and for a monthly series, with the month in the WHERE clause:
 *
 *                  Prisma.sql`SELECT COALESCE(MAX(NULLIF(regexp_replace("orderNo", '\D', '', 'g'), '')::int), 0)
 *                             FROM "TransferOrder" WHERE "orderNo" LIKE ${`TRF-${ym}-%`}`
 *
 * @returns The zero-padded number WITHOUT a prefix — "00042". The caller composes
 *          `PO-${n}` or `SC-${ym}-${n}`, because only the caller knows its format.
 */
export async function nextSequence(
  db: Db,
  key: string,
  pad: number,
  seedSql: Prisma.Sql
): Promise<string> {
  // The seed is read first because the INSERT needs a value for the not-yet-existing row.
  // On every call after the first the ON CONFLICT branch wins and this value is discarded —
  // it is never allowed to lower an existing counter.
  // Typed as an unnamed row on purpose: the caller writes the SELECT, so the column could be
  // called anything ("max", "coalesce", …). Reading the first VALUE rather than a named
  // property is what makes any correctly-shaped seed query work. Postgres returns ::int as a
  // JS number and ::bigint as a BigInt, hence Number() rather than a cast.
  const seedRows = await db.$queryRaw<Array<Record<string, unknown>>>(seedSql);
  const rawSeed = seedRows.length ? Object.values(seedRows[0])[0] : 0;
  const seed = Number(rawSeed ?? 0);

  if (!Number.isFinite(seed) || seed < 0) {
    // A seed query that returns something unusable would silently start the series at NaN.
    log.error("sequence seed query returned a non-number", { key, rawSeed: String(rawSeed) });
    throw new Error(`Sequence seed for "${key}" was not a number`);
  }

  const rows = await db.$queryRaw<Array<{ current: number | bigint }>>`
    INSERT INTO counter (key, current)
    VALUES (${key}, ${seed + 1})
    ON CONFLICT (key) DO UPDATE SET current = counter.current + 1
    RETURNING current
  `;

  const current = Number(rows[0].current);
  const padded = String(current).padStart(pad, "0");

  log.debug("sequence allocated", { key, current, seedUsed: current === seed + 1 });
  return padded;
}

/**
 * Allocate sequential company-wide unit code for physical bicycles (U-000481).
 */
export async function nextUnitCode(db: Db): Promise<string> {
  const seedSql = Prisma.sql`SELECT COALESCE(MAX(NULLIF(regexp_replace("unit_code", '\\D', '', 'g'), '')::int), 0) FROM "inventory_units"`;
  const num = await nextSequence(db, "INVENTORY_UNIT", 6, seedSql);
  return `U-${num}`;
}

/**
 * Allocate sequential ticket number for customer complaints (CMP-YYYYMM-0001).
 */
export async function nextComplaintTicket(db: Db, date = new Date()): Promise<string> {
  const ym = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `CMP-${ym}-`;
  const seedSql = Prisma.sql`SELECT COALESCE(MAX(NULLIF(regexp_replace("ticket_no", '\\D', '', 'g'), '')::int), 0) FROM "complaints" WHERE "ticket_no" LIKE ${`${prefix}%`}`;
  const num = await nextSequence(db, `CMP-${ym}`, 4, seedSql);
  return `${prefix}${num}`;
}

