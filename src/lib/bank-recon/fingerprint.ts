// A bank line's fingerprint — the duplicate guard for overlapping uploads (plan
// 1210-bank-accounts-and-suspense, Q6 / §3 B4 step 7). Pure: no I/O, no clock.
//
// Weekly downloads overlap at the edges. Without a fingerprint every shared line was stored
// twice and could be confirmed twice — two vendor payments for one bank debit (§2.7 D9). The
// upload writes `BankTransaction.fingerprint` on every line, and the unique index
// `@@unique([bankAccountId, fingerprint])` turns a line already on file for that account into
// a skipped insert (`createManyAndReturn({ skipDuplicates: true })`).
//
// THE RULE
//   With a running balance:  sha1("bal" | date | CREDIT/DEBIT | amount.toFixed(2) | balance.toFixed(2))
//   Without one:             sha1("ref" | date | CREDIT/DEBIT | amount.toFixed(2) | normalised reference)
//   A repeat of the same input inside ONE file gets "#n" (n = 2, 3, …) before hashing.
//
// Why the balance: a running balance makes a line unique on its own — two debits of ₹500 on one
// day leave different balances. Without one, the reference (UTR / cheque no.) is the best
// remaining discriminator, and the narration is deliberately left out: the parser words it
// differently from one upload to the next, which would make the same line look new.
//
// Why "#n" in BOTH modes (the plan names it for the no-balance case): a failed debit that the
// bank reverses and the customer retries the same day leaves DEBIT ₹100 → balance 900 twice —
// identical inputs, two real lines. Without "#n" the second would be skipped as a "duplicate"
// and silently lost. "#n" is stable across overlapping files because both lines carry the same
// date, and a statement period is whole days: both are in a file or neither is, in file order.
//
// The "bal" / "ref" prefix keeps the two modes from ever producing the same input string.
//
// Known limit: the same line parsed WITH a balance in one upload and WITHOUT in another gets two
// fingerprints and lands twice. The parser reads the balance column consistently for a given
// bank's export; the plan's running-balance check (§5) is the follow-up that would catch it.
import { createHash } from "node:crypto";

export interface FingerprintLine {
  /** Calendar day, "YYYY-MM-DD" — as printed on the statement. */
  date: string;
  type: "CREDIT" | "DEBIT";
  /** Positive. */
  amount: number;
  /** Running balance after the line, or null when the statement has none / the parser missed it. */
  balance: number | null;
  /** Cheque no. / UTR / reference, as parsed. */
  reference: string | null;
}

/** Upper-case letters and digits only: "utr: 4123-998 " and "UTR4123998" are the same reference. */
export function normaliseReference(reference: string | null | undefined): string {
  return (reference ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The un-hashed input for one line, before any in-file repeat suffix. Exported for tests. */
export function fingerprintInput(line: FingerprintLine): string {
  const amount = line.amount.toFixed(2);
  if (line.balance !== null && Number.isFinite(line.balance)) {
    return ["bal", line.date, line.type, amount, line.balance.toFixed(2)].join("|");
  }
  return ["ref", line.date, line.type, amount, normaliseReference(line.reference)].join("|");
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/**
 * Fingerprint every line of ONE file, in file order. The n-th repeat of an identical input
 * (n ≥ 2) is hashed with "#n" so genuinely identical lines in one file all land.
 */
export function fingerprintLines(lines: readonly FingerprintLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const input = fingerprintInput(line);
    const n = (seen.get(input) ?? 0) + 1;
    seen.set(input, n);
    return sha1(n === 1 ? input : `${input}#${n}`);
  });
}
