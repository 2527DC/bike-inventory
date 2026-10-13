// One expense filter, shared by the list (GET /api/expenses), its totals
// (GET /api/expenses/totals) and the report (GET /api/reports/expense-summary).
//
// Plan 1210-expense-store-department-and-payer, B4. Because all three build their `where` here,
// a report total and the list it opens always show the same number — the property the old code
// broke twice: the list summed only the 50 rows it fetched (L9), and both ended their date
// window at 00:00 UTC of the last day, so an expense later that day fell out (L4).
//
// Query parameters understood (all optional):
//   dateFrom, dateTo   "YYYY-MM-DD", read as IST calendar days (inclusive on both ends)
//   storeId            a store id, or "none" for expenses saved before stores existed
//   payer              "user:<userId>" for a staff member, "name:<key>" for a typed outsider
//   category           an ExpenseCategory value
import type { ExpenseCategory, Prisma, PrismaClient } from "@prisma/client";
import { istDayBounds, getTodayIST } from "@/lib/services/timezone";
import { EXPENSE_CATEGORIES } from "@/lib/validations";
import { normalisePayerName } from "@/lib/expenses/assignment";

type Db = PrismaClient | Prisma.TransactionClient;

/** What every expense row carries to a screen: who recorded it, who paid, which store. */
export const EXPENSE_INCLUDE = {
  recordedBy: { select: { name: true } },
  paidByUser: { select: { id: true, name: true } },
  store: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ExpenseInclude;

export type PayerFilter = { kind: "user"; userId: string } | { kind: "name"; key: string };

export interface ExpenseFilter {
  /** Inclusive IST day names, echoed back so a screen can show the window it got. */
  dateFrom: string | null;
  dateTo: string | null;
  /** UTC instants bounding the window; null = unbounded on that side. */
  from: Date | null;
  to: Date | null;
  storeId: string | "none" | null;
  payer: PayerFilter | null;
  category: ExpenseCategory | null;
}

/**
 * The grouping key for a typed payer name: trimmed, inner whitespace collapsed, lower-cased.
 * "Iqbal bhai " and "Iqbal Bhai" are one person. Must match the SQL in `typedPayerSpellings`.
 */
export function payerKey(name: string): string {
  return normalisePayerName(name).toLowerCase();
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read the filter from a URL's search params.
 *
 * `defaultToThisMonth`: the report wants "this month" when no dates are given; the list wants
 * no date limit at all (it shows the latest expenses, as it always has).
 */
export function parseExpenseFilter(
  searchParams: URLSearchParams,
  opts: { defaultToThisMonth?: boolean } = {}
): ExpenseFilter {
  let dateFrom = searchParams.get("dateFrom");
  let dateTo = searchParams.get("dateTo");
  if (dateFrom && !DAY.test(dateFrom)) dateFrom = null;
  if (dateTo && !DAY.test(dateTo)) dateTo = null;

  if (opts.defaultToThisMonth && !dateFrom && !dateTo) {
    const today = getTodayIST();
    dateFrom = `${today.slice(0, 8)}01`;
    dateTo = today;
  }

  const storeParam = searchParams.get("storeId");
  const storeId = storeParam ? (storeParam === "none" ? "none" : storeParam) : null;

  let payer: PayerFilter | null = null;
  const payerParam = searchParams.get("payer");
  if (payerParam?.startsWith("user:") && payerParam.length > 5) {
    payer = { kind: "user", userId: payerParam.slice(5) };
  } else if (payerParam?.startsWith("name:") && payerParam.length > 5) {
    payer = { kind: "name", key: payerKey(payerParam.slice(5)) };
  }

  const categoryParam = searchParams.get("category");
  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(categoryParam ?? "")
    ? (categoryParam as ExpenseCategory)
    : null;

  return {
    dateFrom,
    dateTo,
    from: dateFrom ? istDayBounds(dateFrom).start : null,
    to: dateTo ? istDayBounds(dateTo).end : null,
    storeId,
    payer,
    category,
  };
}

/**
 * The exact spellings stored for one typed-payer key. Prisma cannot compare a normalised form
 * in a `where`, so the key is resolved to the strings that exist and those are matched with
 * `in`. Parameterised — the key never becomes SQL text.
 */
async function typedPayerSpellings(db: Db, key: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ paidBy: string }[]>`
    SELECT DISTINCT "paidBy" FROM "Expense"
    WHERE "paidById" IS NULL
      AND lower(btrim(regexp_replace("paidBy", '\\s+', ' ', 'g'))) = ${key}`;
  return rows.map((r) => r.paidBy);
}

export async function buildExpenseWhere(db: Db, filter: ExpenseFilter): Promise<Prisma.ExpenseWhereInput> {
  const where: Prisma.ExpenseWhereInput = {};

  if (filter.from || filter.to) {
    where.date = {
      ...(filter.from && { gte: filter.from }),
      ...(filter.to && { lte: filter.to }),
    };
  }
  if (filter.storeId) where.storeId = filter.storeId === "none" ? null : filter.storeId;
  if (filter.category) where.category = filter.category;

  if (filter.payer?.kind === "user") {
    where.paidById = filter.payer.userId;
  } else if (filter.payer?.kind === "name") {
    where.paidById = null;
    where.paidBy = { in: await typedPayerSpellings(db, filter.payer.key) };
  }

  return where;
}

/** Which filters are set, by name only — for logs, which never carry a payer's name. */
export function filterKeys(filter: ExpenseFilter): string[] {
  return [
    filter.dateFrom && "dateFrom",
    filter.dateTo && "dateTo",
    filter.storeId && "storeId",
    filter.payer && `payer:${filter.payer.kind}`,
    filter.category && "category",
  ].filter((k): k is string => Boolean(k));
}
