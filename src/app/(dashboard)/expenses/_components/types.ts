// Shapes, labels and small formatters for the expense list
// (plan 1210-expense-store-department-and-payer, Part D).
import type { ExpenseCategory } from "@/types";

/** One row as GET /api/expenses returns it — `EXPENSE_INCLUDE` in src/lib/expenses/filters.ts. */
export interface ExpenseRow {
  id: string;
  date: string;
  amount: number;
  category: ExpenseCategory;
  description: string;
  /** The payer as saved: the staff member's name at entry, or a typed outsider's name. */
  paidBy: string;
  /** Set when the payer is a staff user; null for a typed outsider. */
  paidById: string | null;
  storeId: string | null;
  paymentMode: string;
  referenceNo: string | null;
  /** The receipt photo, when one was attached at entry. */
  receiptUrl: string | null;
  notes: string | null;
  recordedBy: { name: string };
  paidByUser: { id: string; name: string } | null;
  /** Null only on rows saved before expenses carried a store. */
  store: { id: string; code: string; name: string } | null;
}

/** An active store, as GET /api/stores lists it (only the fields this screen reads). */
export interface StoreOption {
  id: string;
  code: string;
  name: string;
}

// A Record so that a new ExpenseCategory fails compilation here until it has a label. Same
// words as the entry form's cards (expenses/new/_components/types.ts), kept local so this
// screen does not depend on the form's internals.
export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  DELIVERY: "Delivery",
  TRANSPORT: "Transport",
  SHOP_MAINTENANCE: "Shop maintenance",
  UTILITIES: "Utilities",
  SALARY_ADVANCE: "Salary advance",
  FOOD_TEA: "Food & tea",
  STATIONERY: "Stationery",
  MISCELLANEOUS: "Miscellaneous",
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as ExpenseCategory[];

export const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  DELIVERY: "bg-blue-100 text-blue-700",
  TRANSPORT: "bg-purple-100 text-purple-700",
  SHOP_MAINTENANCE: "bg-orange-100 text-orange-700",
  UTILITIES: "bg-cyan-100 text-cyan-700",
  SALARY_ADVANCE: "bg-pink-100 text-pink-700",
  FOOD_TEA: "bg-amber-100 text-amber-700",
  STATIONERY: "bg-indigo-100 text-indigo-700",
  MISCELLANEOUS: "bg-slate-100 text-slate-700",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as ExpenseCategory] ?? category.replace(/_/g, " ");
}

/** Whole rupees for the list and the total; `digits = 2` where paise must not be rounded away. */
export function formatCurrency(amount: number, digits = 0): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** "12 Oct", with the year only when it is not this year. IST, as the activity log writes it. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "Asia/Kolkata",
  });
}

/** "1 Oct 2026" from a "YYYY-MM-DD" day name. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Created from a bank statement line by /api/bank-statements/[id]/review. That route writes
 * `paidBy: "Bank Transfer"` with no linked user and a "Auto-recorded from bank statement" note;
 * there is no column that says so, hence "looks". Used only to word the delete confirmation —
 * the DELETE route itself finds the line by `confirmedExpenseId`.
 */
export function looksBankCreated(row: ExpenseRow): boolean {
  return (
    !row.paidById &&
    (row.paidBy === "Bank Transfer" || Boolean(row.notes?.startsWith("Auto-recorded from bank statement")))
  );
}

/** The payer as it should read: the staff member's current name when linked, else the saved text. */
export function payerName(row: ExpenseRow): string {
  return row.paidByUser?.name ?? row.paidBy;
}

/** A typed outsider (a Porter driver, say) — shown with a "not staff" marker. A bank transfer is not a person, so it gets none. */
export function isTypedPayer(row: ExpenseRow): boolean {
  return !row.paidByUser && !looksBankCreated(row);
}
