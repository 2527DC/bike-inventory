"use client";

// Small pieces shared by the /bills screen's components (plan 1210 credit notes and payables).

import { istDayNumber, openAmountOf, todayIstDayNumber } from "@/lib/payables/cash-discount";

/** A row of GET /api/stores — only what /bills reads. */
export interface StoreOption {
  id: string;
  code: string;
  name: string;
}

/** The store a bill row carries (GET /api/bills, GET /api/bills/priority). */
export type BillStore = { id: string; name: string; code: string } | null;

/** The Store filter: "ALL", a store id, or "none" for bills whose store is not set. */
export type StoreFilter = string;

export function storeFilterOptions(stores: StoreOption[]): { key: string; label: string }[] {
  return [
    { key: "ALL", label: "All stores" },
    ...stores.map((s) => ({ key: s.id, label: s.name || s.code })),
    { key: "none", label: "Not set" },
  ];
}

/** The `storeId` query value for a filter, or null for "every store". */
export function storeQueryValue(filter: StoreFilter): string | null {
  return filter === "ALL" ? null : filter;
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

/** A date-only value (stored as UTC midnight) printed as its IST calendar day. */
export function formatDay(iso: string | Date) {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "44 days old" — days since the bill date (D8). */
export function ageText(daysSinceBill: number) {
  return `${plural(Math.max(0, daysSinceBill), "day")} old`;
}

/** "14 days past due" / "due today" / "due in 5 days" — against the stored due date (Q5). */
export function dueText(daysPastDue: number) {
  if (daysPastDue > 0) return `${plural(daysPastDue, "day")} past due`;
  if (daysPastDue === 0) return "due today";
  return `due in ${plural(-daysPastDue, "day")}`;
}

/**
 * Whether a list row is overdue, from its STORED due date in IST days (Q5 = a, X5). The rows
 * used to recompute bill date + the vendor's current terms, so a bill could sit in the "Not due"
 * card while its own row said OVERDUE.
 */
export function overdueInfo(bill: { dueDate: string; amount: number; paidAmount: number; status: string }) {
  const daysPastDue = todayIstDayNumber() - istDayNumber(bill.dueDate);
  const open = openAmountOf(bill);
  const isOverdue = bill.status !== "PAID" && open > 0 && daysPastDue >= 1;
  return { daysPastDue, isOverdue, open };
}

export function StoreChip({ store, className = "" }: { store: BillStore; className?: string }) {
  return store ? (
    <span
      className={`inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ${className}`}
    >
      {store.name || store.code}
    </span>
  ) : (
    <span
      className={`inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200 ${className}`}
    >
      Store not set
    </span>
  );
}
