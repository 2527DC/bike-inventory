export const dynamic = "force-dynamic";

// GET /api/reports/expense-summary — "how much did <person> spend at <store> in <period>"
// (plan 1210-expense-store-department-and-payer, R4, Part E1).
//
// Query (all optional):
//   dateFrom, dateTo   IST days, inclusive. Neither given → this month, unless range=all.
//   range=all          no date limit at all (the page's "All" preset).
//   storeId            <id> | none
//   payer              user:<id> | name:<key>
//   category           an ExpenseCategory
//   groupBy            payer (default) | store | category
//
// The `where` is built by src/lib/expenses/filters.ts — the same function the /expenses list
// and its totals use — so the total here and the list "View these expenses" opens always show
// the same number. Do not match dates or payers here by hand.
//
// Guarded by reports.view only. `options` carries the stores and payers for the filters, so
// someone who may read reports but holds no expenses grant still gets working pickers.
import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { listStores } from "@/lib/stores";
import { getTodayIST } from "@/lib/services/timezone";
import { buildExpenseWhere, filterKeys, parseExpenseFilter, payerKey } from "@/lib/expenses/filters";
import { CATEGORY_LABELS } from "@/app/(dashboard)/expenses/new/_components/types";
import type { ExpenseSummary, SummaryGroup } from "@/app/(dashboard)/reports/expense-summary/_components/types";

const log = createLogger("reports:expense-summary");

const groupBySchema = z.enum(["payer", "store", "category"]).catch("payer");

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Whole days since the epoch for a "YYYY-MM-DD" name — for counting days, nothing else. */
function dayIndex(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS;
}

/** The IST calendar day an instant falls on. */
function istDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

type PayerRow = {
  paidById: string | null;
  paidBy: string;
  _sum: { amount: number | null };
  _count: { _all: number };
};

interface PayerBucket {
  key: string;
  userId: string | null;
  amount: number;
  count: number;
  /** Each stored spelling and how many expenses carry it — the commonest becomes the label. */
  spellings: Map<string, number>;
}

/**
 * Fold `groupBy(["paidById", "paidBy"])` rows into one bucket per person: a staff payer by user
 * id (a renamed user is still one person), a typed outsider by `payerKey` ("Iqbal bhai " and
 * "Iqbal Bhai" are one person) — the same key the list's `?payer=name:<key>` filter matches.
 */
function foldPayers(rows: PayerRow[]): PayerBucket[] {
  const buckets = new Map<string, PayerBucket>();
  for (const r of rows) {
    const key = r.paidById ? `user:${r.paidById}` : `name:${payerKey(r.paidBy)}`;
    let b = buckets.get(key);
    if (!b) {
      b = { key, userId: r.paidById, amount: 0, count: 0, spellings: new Map() };
      buckets.set(key, b);
    }
    b.amount += r._sum.amount ?? 0;
    b.count += r._count._all;
    b.spellings.set(r.paidBy, (b.spellings.get(r.paidBy) ?? 0) + r._count._all);
  }
  return [...buckets.values()];
}

/** A staff payer reads as the user's CURRENT name; a typed one as its commonest spelling. */
function payerLabel(b: PayerBucket, userNames: Map<string, string>): string {
  if (b.userId && userNames.has(b.userId)) return userNames.get(b.userId)!;
  const [best] = [...b.spellings.entries()].sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0]));
  return best?.[0]?.trim() || "Unnamed";
}

type RawGroup = { key: string; label: string; amount: number; count: number };

function toGroups(rows: RawGroup[], total: number): SummaryGroup[] {
  return rows
    .map((g) => ({
      key: g.key,
      label: g.label,
      amount: round2(g.amount),
      count: g.count,
      percentage: total > 0 ? Math.round((g.amount / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

const payerRows = (where: Prisma.ExpenseWhereInput) =>
  prisma.expense.groupBy({ by: ["paidById", "paidBy"], where, _sum: { amount: true }, _count: { _all: true } });

/** Store groups; a null store is "No store" under the key the list reads as `?storeId=none`. */
async function storeGroups(where: Prisma.ExpenseWhereInput): Promise<RawGroup[]> {
  const rows = await prisma.expense.groupBy({ by: ["storeId"], where, _sum: { amount: true }, _count: { _all: true } });
  // Every store that appears, active or not — a deactivated store's history still has a name.
  const ids = rows.flatMap((r) => (r.storeId ? [r.storeId] : []));
  const stores = ids.length
    ? await prisma.store.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const names = new Map(stores.map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    key: r.storeId ?? "none",
    label: r.storeId ? names.get(r.storeId) ?? "Unknown store" : "No store",
    amount: r._sum.amount ?? 0,
    count: r._count._all,
  }));
}

async function categoryGroups(where: Prisma.ExpenseWhereInput): Promise<RawGroup[]> {
  const rows = await prisma.expense.groupBy({ by: ["category"], where, _sum: { amount: true }, _count: { _all: true } });
  return rows.map((r) => ({
    key: r.category,
    label: CATEGORY_LABELS[r.category]?.label ?? r.category.replace(/_/g, " "),
    amount: r._sum.amount ?? 0,
    count: r._count._all,
  }));
}

/** Current names for every staff payer in the buckets — one query. */
async function userNamesFor(buckets: PayerBucket[]): Promise<Map<string, string>> {
  const ids = [...new Set(buckets.flatMap((b) => (b.userId ? [b.userId] : [])))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  try {
    await requireFeature("reports", "view");
    const { searchParams } = new URL(req.url);

    const filter = parseExpenseFilter(searchParams, { defaultToThisMonth: searchParams.get("range") !== "all" });
    if (filter.dateFrom && filter.dateTo && filter.dateFrom > filter.dateTo) {
      return errorResponse("The start date is after the end date.", 400);
    }
    const groupBy = groupBySchema.parse(searchParams.get("groupBy") ?? undefined);

    // The payer picker lists everyone who paid in the date window, ignoring the other filters —
    // otherwise choosing one person would leave the picker holding only that person.
    const [where, windowWhere] = await Promise.all([
      buildExpenseWhere(prisma, filter),
      buildExpenseWhere(prisma, { ...filter, storeId: null, payer: null, category: null }),
    ]);

    const [windowPayers, groupPayers, activeStores, earliest] = await Promise.all([
      payerRows(windowWhere).then(foldPayers),
      groupBy === "payer" ? payerRows(where).then(foldPayers) : Promise.resolve([] as PayerBucket[]),
      listStores(),
      // Only "All dates" needs it: the daily average then starts at the first expense, not 1970.
      filter.dateFrom ? null : prisma.expense.aggregate({ where, _min: { date: true } }),
    ]);
    const userNames = await userNamesFor([...groupPayers, ...windowPayers]);

    const raw: RawGroup[] =
      groupBy === "payer"
        ? groupPayers.map((b) => ({ key: b.key, label: payerLabel(b, userNames), amount: b.amount, count: b.count }))
        : groupBy === "store"
          ? await storeGroups(where)
          : await categoryGroups(where);

    const totalRaw = raw.reduce((s, g) => s + g.amount, 0);
    const total = round2(totalRaw);
    const totalCount = raw.reduce((s, g) => s + g.count, 0);

    // Days in the window, counted up to today: "this month" on the 12th is 12 days, not 31.
    const today = getTodayIST();
    const firstDay = filter.dateFrom ?? (earliest?._min.date ? istDay(earliest._min.date) : today);
    const lastDay = filter.dateTo && filter.dateTo < today ? filter.dateTo : today;
    const days = Math.max(1, dayIndex(lastDay) - dayIndex(firstDay) + 1);

    const result: ExpenseSummary = {
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      total,
      totalCount,
      dailyAvg: Math.round(totalRaw / days),
      groupBy,
      groups: toGroups(raw, totalRaw),
      options: {
        stores: activeStores.map((s) => ({ id: s.id, name: s.name })),
        payers: windowPayers
          .map((b) => ({ key: b.key, label: payerLabel(b, userNames) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      },
    };

    // Counts and filter NAMES only — never a payer's name.
    log.debug("summary", { groupBy, groups: result.groups.length, ms: Date.now() - started, filters: filterKeys(filter) });
    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("summary failed", {
      reason: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    });
    return errorResponse("Failed to load the expense summary", 500);
  }
}
