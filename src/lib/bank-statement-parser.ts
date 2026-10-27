import * as XLSX from "xlsx";
import { createLogger } from "@/lib/logger";

const log = createLogger("bank-statement-parser");

export interface ParsedBankTransaction {
  date: string; // YYYY-MM-DD
  description: string;
  reference: string;
  amount: number;
  type: "CREDIT" | "DEBIT";
  balance: number | null;
}

export interface ParseResult {
  transactions: ParsedBankTransaction[];
  headerRowIndex: number;
  detectedColumns: Record<string, number>;
}

/**
 * Normalizes an Indian/international date string or Excel date serial to YYYY-MM-DD.
 */
export function normalizeBankDate(val: unknown): string | null {
  if (val === undefined || val === null || val === "") return null;

  // Handle Excel numeric date serials (e.g. 45000 to 55000)
  if (typeof val === "number" && !isNaN(val) && val > 20000 && val < 70000) {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      if (d && d.y && d.m && d.d) {
        return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
      }
    } catch {
      // Fall through to string parsing
    }
  }

  let str = String(val).trim();
  // If there's a timestamp ("13/09/2026 14:30:00" or "13/09/2026T14:30:00"), take date part
  str = str.split(/[T\s]+/)[0];

  // DD/MM/YYYY or DD-MM-YYYY
  let match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) {
    const [, d, mo, y] = match;
    const day = parseInt(d, 10);
    const month = parseInt(mo, 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }

  // DD/MM/YY or DD-MM-YY
  match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (match) {
    const [, d, mo, y] = match;
    const day = parseInt(d, 10);
    const month = parseInt(mo, 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const fullYear = parseInt(y, 10) > 50 ? `19${y}` : `20${y}`;
      return `${fullYear}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }

  // YYYY-MM-DD
  match = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (match) {
    const [, y, mo, d] = match;
    const day = parseInt(d, 10);
    const month = parseInt(mo, 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * Strips currency marks (₹, $, €, £), whitespace (including non-breaking \u00a0), and commas,
 * returning a positive float.
 */
export function normalizeBankAmount(val: unknown): number | null {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "number") return isNaN(val) ? null : Math.abs(val);

  const clean = String(val).replace(/[₹$€£\s,\u00a0]/g, "");
  // Keep digits and decimal point, strip extraneous chars
  const numMatch = clean.match(/[-+]?\d+(?:\.\d+)?/);
  if (!numMatch) return null;

  const num = parseFloat(numMatch[0]);
  return isNaN(num) ? null : Math.abs(num);
}

/**
 * Determines whether a transaction is CREDIT or DEBIT.
 */
export function resolveTransactionType(opts: {
  amountVal?: unknown;
  withdrawalVal?: unknown;
  depositVal?: unknown;
  typeColVal?: unknown;
}): "CREDIT" | "DEBIT" {
  const { amountVal, withdrawalVal, depositVal, typeColVal } = opts;

  // 1. Separate withdrawal / deposit columns
  if (withdrawalVal !== undefined && withdrawalVal !== null && withdrawalVal !== "") {
    const w = normalizeBankAmount(withdrawalVal);
    if (w !== null && w > 0) return "DEBIT";
  }
  if (depositVal !== undefined && depositVal !== null && depositVal !== "") {
    const d = normalizeBankAmount(depositVal);
    if (d !== null && d > 0) return "CREDIT";
  }

  // 2. Separate Dr/Cr type column
  if (typeColVal !== undefined && typeColVal !== null) {
    const t = String(typeColVal).toUpperCase().trim();
    if (t.includes("CR") || t === "CREDIT" || t === "C") return "CREDIT";
    if (t.includes("DR") || t === "DEBIT" || t === "D") return "DEBIT";
  }

  // 3. Amount string indicator (e.g. "₹ 4,800.00 Cr", "1200.00 Dr", "-500")
  if (amountVal !== undefined && amountVal !== null) {
    const s = String(amountVal).toUpperCase().trim();
    if (s.includes("CR")) return "CREDIT";
    if (s.includes("DR")) return "DEBIT";
    if (s.startsWith("-")) return "DEBIT";
    if (s.startsWith("+")) return "CREDIT";
  }

  return "DEBIT";
}

interface ColumnMapping {
  dateCol: number;
  descCol: number;
  refCol?: number;
  withdrawalCol?: number;
  depositCol?: number;
  amountCol?: number;
  typeCol?: number;
  balanceCol?: number;
}

/**
 * Scans rows to locate the header row and maps each recognized column.
 */
function findHeaderRow(rows: unknown[][]): { headerIndex: number; mapping: ColumnMapping } | null {
  // Search the first 40 rows for the table header
  const maxSearchRows = Math.min(40, rows.length);

  for (let r = 0; r < maxSearchRows; r++) {
    const row = rows[r];
    if (!Array.isArray(row) || row.length < 3) continue;

    const rowStrings = row.map((cell) => String(cell || "").toLowerCase().trim());
    const rowJoined = rowStrings.join(" | ");

    // Must have date-like column
    const hasDate =
      rowStrings.some((c) => c.includes("txn date") || c.includes("transaction date") || c === "date" || c.includes("value dt") || c.includes("booking date"));

    // Must have narration/description/particulars column
    const hasDesc =
      rowStrings.some((c) => c.includes("narration") || c.includes("description") || c.includes("particulars") || c.includes("remarks") || c.includes("transaction details"));

    // Must have amount or debit/credit column
    const hasAmount =
      rowStrings.some((c) => c.includes("amount") || c.includes("withdrawal") || c.includes("deposit") || c.includes("debit") || c.includes("credit") || c.includes("balance"));

    if (hasDate && hasDesc && hasAmount) {
      const mapping: Partial<ColumnMapping> = {};

      rowStrings.forEach((col, idx) => {
        if (!col) return;

        // Date (prefer "Txn Date" or "Transaction Date" over "Value Date")
        if (col.includes("txn date") || col.includes("transaction date") || col === "date") {
          mapping.dateCol = idx;
        } else if (mapping.dateCol === undefined && (col.includes("value dt") || col.includes("value date") || col.includes("post date"))) {
          mapping.dateCol = idx;
        }

        // Description
        if (col.includes("narration") || col.includes("description") || col.includes("particulars") || col.includes("remarks") || col.includes("transaction details")) {
          mapping.descCol = idx;
        }

        // Reference / Cheque
        if (col.includes("chq") || col.includes("cheque") || col.includes("ref") || col.includes("utr") || col.includes("txn id") || col.includes("transaction id")) {
          mapping.refCol = idx;
        }

        // Withdrawal / Debit
        if (col.includes("withdrawal") || col.includes("dr amt") || col.includes("debit amt") || col === "debit" || col === "dr") {
          mapping.withdrawalCol = idx;
        }

        // Deposit / Credit
        if (col.includes("deposit") || col.includes("cr amt") || col.includes("credit amt") || col === "credit" || col === "cr") {
          mapping.depositCol = idx;
        }

        // Amount (single column)
        if (col.includes("txn amount") || col.includes("transaction amount") || col === "amount" || col.includes("net amount")) {
          mapping.amountCol = idx;
        }

        // Dr / Cr indicator column
        if (col === "type" || col === "cr/dr" || col === "dr/cr" || col === "indicator") {
          mapping.typeCol = idx;
        }

        // Balance
        if (col.includes("closing") || col.includes("balance") || col.includes("bal")) {
          mapping.balanceCol = idx;
        }
      });

      if (mapping.dateCol !== undefined && mapping.descCol !== undefined && (mapping.withdrawalCol !== undefined || mapping.depositCol !== undefined || mapping.amountCol !== undefined)) {
        return {
          headerIndex: r,
          mapping: mapping as ColumnMapping,
        };
      }
    }
  }

  return null;
}

/**
 * Attempts to parse a workbook or sheet rows deterministically.
 * Returns null if the structure cannot be confidently identified,
 * allowing safe fallback to AI parsing.
 */
export function parseTabularBankStatement(workbook: XLSX.WorkBook): ParseResult | null {
  try {
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return null;

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return null;

    // Read sheet as 2D array of formatted strings
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    }) as unknown[][];

    if (!rows || rows.length < 2) return null;

    const detected = findHeaderRow(rows);
    if (!detected) {
      log.debug("no standard bank statement header row detected");
      return null;
    }

    const { headerIndex, mapping } = detected;
    const transactions: ParsedBankTransaction[] = [];

    for (let r = headerIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!Array.isArray(row) || row.length === 0) continue;

      // Extract and validate date
      const dateVal = row[mapping.dateCol];
      const date = normalizeBankDate(dateVal);
      if (!date) {
        // Skip non-transaction rows (e.g. page footers, empty rows, summary lines)
        continue;
      }

      // Extract description
      const descVal = row[mapping.descCol];
      const description = String(descVal || "").trim();
      if (!description || description === "********" || description.startsWith("---")) {
        continue;
      }

      // Extract reference
      let reference = "";
      if (mapping.refCol !== undefined && row[mapping.refCol] !== undefined) {
        reference = String(row[mapping.refCol] || "").trim();
        // Remove trailing or leading repetitive zeros or placeholder text
        if (reference === "000000000000000" || reference === "0") {
          reference = "";
        }
      }

      // Extract amount & type
      let amount = 0;
      let type: "CREDIT" | "DEBIT" = "DEBIT";

      const withdrawalVal = mapping.withdrawalCol !== undefined ? row[mapping.withdrawalCol] : undefined;
      const depositVal = mapping.depositCol !== undefined ? row[mapping.depositCol] : undefined;
      const amountVal = mapping.amountCol !== undefined ? row[mapping.amountCol] : undefined;
      const typeColVal = mapping.typeCol !== undefined ? row[mapping.typeCol] : undefined;

      if (mapping.withdrawalCol !== undefined || mapping.depositCol !== undefined) {
        const w = normalizeBankAmount(withdrawalVal);
        const d = normalizeBankAmount(depositVal);

        if (d !== null && d > 0) {
          amount = d;
          type = "CREDIT";
        } else if (w !== null && w > 0) {
          amount = w;
          type = "DEBIT";
        }
      } else if (mapping.amountCol !== undefined) {
        const a = normalizeBankAmount(amountVal);
        if (a !== null && a > 0) {
          amount = a;
          type = resolveTransactionType({ amountVal, typeColVal });
        }
      }

      // Extract closing balance
      let balance: number | null = null;
      if (mapping.balanceCol !== undefined && row[mapping.balanceCol] !== undefined) {
        balance = normalizeBankAmount(row[mapping.balanceCol]);
      }

      if (amount > 0) {
        transactions.push({
          date,
          description,
          reference,
          amount,
          type,
          balance,
        });
      }
    }

    if (transactions.length === 0) {
      log.debug("header row found but 0 transactions extracted", { headerIndex });
      return null;
    }

    log.info("bank statement parsed deterministically", {
      sheetName,
      headerRow: headerIndex + 1,
      transactions: transactions.length,
    });

    return {
      transactions,
      headerRowIndex: headerIndex,
      detectedColumns: mapping as unknown as Record<string, number>,
    };
  } catch (error) {
    log.error("deterministic bank statement parsing threw error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
