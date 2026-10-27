// Shared shapes for the stepped expense entry flow (plan 1210-expense-store-department-and-payer,
// Part C).
//
// Everything here is client state. Nothing is written until the photo step's Submit sends this
// ONE expense to POST /api/expenses, with the store picked in the top bar and who paid.
import type { ExpenseCategory, PaymentMode } from "@/types";
import type { ExpensePayerInput } from "@/lib/validations";

export type { ExpenseCategory, PaymentMode };

/** Who paid, as the steps collect it. `userId` and `name` survive a switch between kinds. */
export interface PayerDraft {
  kind: ExpensePayerInput["kind"];
  /** The staff member picked under "Staff member". */
  userId: string | null;
  /** The name typed under "Someone not on staff". */
  name: string;
}

/** The expense being typed right now. `amount` stays text until the step validates it. */
export interface Draft {
  amount: string;
  category: ExpenseCategory | null;
  description: string;
  payer: PayerDraft;
  paymentMode: PaymentMode;
  receiptUrl: string | null;
}

export const EMPTY_DRAFT: Draft = {
  amount: "",
  category: null,
  description: "",
  // "Me" is pre-selected (E3): most expenses are paid by the person recording them.
  payer: { kind: "self", userId: null, name: "" },
  paymentMode: "UPI",
  receiptUrl: null,
};

export type Step = "amount" | "category" | "payer" | "paymentMode" | "photo";

/** The per-expense steps: amount → category → who paid → payment mode → photo. */
export const ENTRY_STEPS: readonly Step[] = ["amount", "category", "payer", "paymentMode", "photo"];

// ---- GET /api/expenses/options (src/app/api/expenses/options/route.ts) ----

export interface StoreOption {
  id: string;
  code: string;
  name: string;
}

export interface StaffOption {
  id: string;
  name: string;
}

export interface RecentPayer {
  name: string;
  count: number;
}

export interface ExpenseOptions {
  /** The signed-in person; `storeId` is their assigned store, which the session does not carry. */
  me: { id: string; name: string; storeId: string | null };
  /** Active stores only. */
  stores: StoreOption[];
  /** Active staff. */
  users: StaffOption[];
  /** Typed outsider names from the last 180 days, most used first. */
  recentPayers: RecentPayer[];
}

/**
 * The store selected before anyone taps (E5): the only active store when there is one, else the
 * person's own store when it is among the active ones, else none — the top bar then asks.
 */
export function defaultStoreId(options: ExpenseOptions): string | null {
  if (options.stores.length === 1) return options.stores[0].id;
  const own = options.me.storeId;
  return own && options.stores.some((s) => s.id === own) ? own : null;
}

/**
 * A typed name as the server stores it: trimmed, inner runs of whitespace made one space.
 * Mirrors `normalisePayerName` in src/lib/expenses/assignment.ts, which cannot be imported here —
 * it is server code.
 */
export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** The comparison key for two spellings of one name: "Iqbal bhai " and "Iqbal Bhai" match. */
export function nameKey(name: string): string {
  return normaliseName(name).toLowerCase();
}

/** The `payer` body POST /api/expenses expects, or null while the choice is incomplete. */
export function payerBody(payer: PayerDraft): ExpensePayerInput | null {
  if (payer.kind === "self") return { kind: "self" };
  if (payer.kind === "user") return payer.userId ? { kind: "user", userId: payer.userId } : null;
  const name = normaliseName(payer.name);
  return name.length >= 2 ? { kind: "name", name } : null;
}

/** The sentence under a disabled Submit, naming what is still missing; null when nothing is. */
export function missingBeforeSubmit(opts: {
  storeCount: number;
  storeId: string | null;
  payerReady: boolean;
}): string | null {
  const payerStep = ENTRY_STEPS.indexOf("payer") + 1;
  if (opts.storeCount === 0) {
    return "There is no active store to charge this to. Add one under Settings › Store management.";
  }
  if (!opts.storeId && !opts.payerReady) {
    return `Pick the store at the top and who paid (step ${payerStep}) to submit.`;
  }
  if (!opts.storeId) return "Pick the store at the top to submit.";
  if (!opts.payerReady) return `Choose who paid (step ${payerStep}) to submit.`;
  return null;
}

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
  UPI: "UPI",
  CASH: "Cash",
  CHEQUE: "Cheque",
  NEFT: "NEFT",
  RTGS: "RTGS",
  CREDIT_ADJUSTMENT: "Credit adjustment",
};

export const PAYMENT_MODE_ORDER: PaymentMode[] = ["UPI", "CASH"];

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
