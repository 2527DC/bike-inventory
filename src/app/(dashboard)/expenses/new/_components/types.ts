// Shared shapes for the stepped expense entry flow (0909-expense-multi-entry-flow-plan, Part C).
//
// Everything here is client state. Nothing is written until the review screen's Submit sends
// the whole batch to POST /api/expenses/batch in one call.
import type { ExpenseCategory, PaymentMode } from "@/types";

export type { ExpenseCategory, PaymentMode };

/** One completed expense in the batch. `key` is client-only; the server mints the real id. */
export interface ExpenseRow {
  key: string;
  amount: number;
  category: ExpenseCategory;
  description: string;
  paymentMode: PaymentMode;
  /** The uploaded receipt photo, or null when none was attached. */
  receiptUrl: string | null;
}

/** The expense being typed right now. `amount` stays text until the step validates it. */
export interface Draft {
  amount: string;
  category: ExpenseCategory | null;
  description: string;
  paymentMode: PaymentMode;
  receiptUrl: string | null;
}

export const EMPTY_DRAFT: Draft = {
  amount: "",
  category: null,
  description: "",
  paymentMode: "CASH",
  receiptUrl: null,
};

export type Step = "amount" | "category" | "description" | "paymentMode" | "photo" | "next" | "review";

/** The per-expense steps, in the order the owner asked for (R3). "next" and "review" follow. */
export const ENTRY_STEPS: readonly Step[] = ["amount", "category", "description", "paymentMode", "photo"];

// A Record rather than an array so that adding a value to the Prisma enum (and to the type
// in src/types) fails compilation here until it gets a label — a category with no card would
// otherwise be silently unreachable, which is exactly what happened to CREDIT_ADJUSTMENT.
export const CATEGORY_LABELS: Record<ExpenseCategory, { label: string; hint: string }> = {
  DELIVERY: { label: "Delivery", hint: "Sending cycles out" },
  TRANSPORT: { label: "Transport", hint: "Auto, tempo, fuel" },
  SHOP_MAINTENANCE: { label: "Shop maintenance", hint: "Repairs, cleaning" },
  UTILITIES: { label: "Utilities", hint: "Power, water, internet" },
  SALARY_ADVANCE: { label: "Salary advance", hint: "Paid to staff" },
  FOOD_TEA: { label: "Food & tea", hint: "Counter refreshments" },
  STATIONERY: { label: "Stationery", hint: "Paper, printing" },
  MISCELLANEOUS: { label: "Miscellaneous", hint: "Anything else" },
};

export const CATEGORY_ORDER: ExpenseCategory[] = [
  "DELIVERY", "TRANSPORT", "SHOP_MAINTENANCE", "UTILITIES",
  "SALARY_ADVANCE", "FOOD_TEA", "STATIONERY", "MISCELLANEOUS",
];

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CHEQUE: "Cheque",
  NEFT: "NEFT",
  RTGS: "RTGS",
  CREDIT_ADJUSTMENT: "Credit adjustment",
};

export const PAYMENT_MODE_ORDER: PaymentMode[] = ["CASH", "UPI", "CHEQUE", "NEFT", "RTGS", "CREDIT_ADJUSTMENT"];

/** Today as YYYY-MM-DD in the device's own time zone (R2). */
export function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Digits and at most one dot with two decimals; everything else is dropped as it is typed. */
export function sanitizeAmount(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  if (rest.length === 0) return whole;
  return `${whole}.${rest.join("").slice(0, 2)}`;
}

/** The amount as a number, or null when the text is not a positive amount yet. */
export function parseAmount(raw: string): number | null {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount);
}

export function draftFromRow(row: ExpenseRow): Draft {
  return {
    amount: String(row.amount),
    category: row.category,
    description: row.description,
    paymentMode: row.paymentMode,
    receiptUrl: row.receiptUrl,
  };
}

/** A completed row from the draft, or null when a required step is still invalid. */
export function rowFromDraft(draft: Draft, key: string): ExpenseRow | null {
  const amount = parseAmount(draft.amount);
  const description = draft.description.trim();
  if (amount === null || !draft.category || !description) return null;
  return {
    key,
    amount,
    category: draft.category,
    description,
    paymentMode: draft.paymentMode,
    receiptUrl: draft.receiptUrl,
  };
}

export function newRowKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function batchTotal(rows: ExpenseRow[]): number {
  return Math.round(rows.reduce((sum, r) => sum + r.amount, 0) * 100) / 100;
}
