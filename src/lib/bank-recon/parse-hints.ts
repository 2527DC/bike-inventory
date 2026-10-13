// Per-bank hints for the statement parser's prompt (plan 1210-bank-accounts-and-suspense,
// §3 B4 step 4). Chosen by `BankAccount.bank`; a new bank is one `BankCode` value in
// prisma/schema.prisma and one entry here.
//
// ICICI and HDFC are the texts that lived inline in src/app/api/bank-statements/route.ts,
// moved here UNCHANGED — the parser's behaviour for those two banks must not move with them.
import type { BankCode } from "@prisma/client";

const ICICI = `ICICI bank statements typically have columns: S No., Value Date, Transaction Date, Cheque Number, Transaction Remarks, Withdrawal Amount (Dr), Deposit Amount (Cr), Balance. The date format is usually DD/MM/YYYY or DD-MM-YYYY. Some ICICI statements have headers spread across multiple rows or have a summary section at top — skip those and find the actual transaction rows.`;

const HDFC = `HDFC bank statements typically have columns: Date, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt., Closing Balance. The date format is usually DD/MM/YY or DD/MM/YYYY.`;

// ⚠ WRITTEN WITHOUT A SAMPLE (13 Oct 2026). No Dhanlaxmi Bank statement has been seen yet —
// these are the columns Indian bank exports usually carry, not Dhanlaxmi's own. Replace this
// text from the owner's first real statement (plan §1.1 "Account details", data item 2), and
// move DHANLAXMI out of GENERIC_HINTS below when you do.
const DHANLAXMI = `Dhanlaxmi Bank statements usually carry Date / Value Date, Particulars, Cheque or Reference No., Withdrawal (Dr), Deposit (Cr) and Balance, the balance sometimes suffixed Cr or Dr; dates DD-MM-YYYY or DD/MM/YYYY.`;

const OTHER = `Parse the bank statement based on common column patterns.`;

export const PARSE_HINTS: Readonly<Record<BankCode, string>> = { ICICI, HDFC, DHANLAXMI, OTHER };

/**
 * Banks whose hints were NOT written from a real statement. The upload says so in its
 * diagnostics when such a file parses to nothing, so the fix ("send us a sample") is obvious.
 */
export const GENERIC_HINTS: ReadonlySet<BankCode> = new Set<BankCode>(["DHANLAXMI", "OTHER"]);

export function parseHintsFor(bank: BankCode): string {
  return PARSE_HINTS[bank] ?? OTHER;
}
