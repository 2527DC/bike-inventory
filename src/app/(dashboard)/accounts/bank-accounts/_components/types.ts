// Shapes and labels for a bank account, shared by /accounts/bank-accounts and
// /accounts/bank-upload (plan 1210-bank-accounts-and-suspense, §3 B3, B6). Pure — no hooks,
// no "use client", so either screen (or the hub's tile) can import it.

export type BankCode = "ICICI" | "HDFC" | "DHANLAXMI" | "OTHER";

export const BANK_CODES: BankCode[] = ["ICICI", "HDFC", "DHANLAXMI", "OTHER"];

/** How a bank reads on a chip or a card. */
export const BANK_LABELS: Record<BankCode, string> = {
  ICICI: "ICICI",
  HDFC: "HDFC",
  DHANLAXMI: "Dhanlaxmi",
  OTHER: "Other bank",
};

/** One row of GET /api/bank-accounts. `reconcileFrom` is a calendar day, "YYYY-MM-DD". */
export interface BankAccountRow {
  id: string;
  name: string;
  bank: BankCode;
  accountLast4: string | null;
  storeId: string | null;
  store: { id: string; code: string; name: string } | null;
  zohoAccountId: string | null;
  reconcileFrom: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** One row of GET /api/stores — only what a store picker needs. */
export interface StoreOption {
  id: string;
  code: string;
  name: string;
}

/**
 * "HDFC · Hub ••••1234" — the bank, then the owner's name for the account without repeating the
 * bank, then the last four digits when known. "ICICI" stays "ICICI"; a name that does not start
 * with its bank keeps the bank in front ("HDFC · Current a/c").
 */
export function accountChipLabel(a: { name: string; bank: BankCode | string; accountLast4: string | null }): string {
  const bankWord = a.bank === "OTHER" ? null : BANK_LABELS[a.bank as BankCode] ?? null;
  let label = a.name;
  if (bankWord) {
    const name = a.name.trim();
    const lower = name.toLowerCase();
    const bw = bankWord.toLowerCase();
    if (lower === bw) {
      label = name;
    } else if (lower.startsWith(`${bw} `)) {
      const rest = name.slice(bw.length).trim();
      label = rest.toLowerCase() === "bank" ? name : `${bankWord} · ${rest}`;
    } else {
      label = `${bankWord} · ${name}`;
    }
  }
  return a.accountLast4 ? `${label} ••••${a.accountLast4}` : label;
}

/** "2026-10-07" (or an ISO instant) → "7 Oct 2026". Read as a calendar day, never shifted by timezone. */
export function dayLabel(day: string | null | undefined, opts: { weekday?: boolean; year?: boolean } = {}): string {
  if (!day) return "";
  const d = new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(opts.year === false ? {} : { year: "numeric" }),
    ...(opts.weekday ? { weekday: "short" } : {}),
  });
}
