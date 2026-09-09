// ─── One AI pass over one ledger upload ───────────────────────────────────────
// Plan 0909-vendor-ledger-screens-and-ai-import, §3 Part E.3.
//
// The rule that shapes everything here: a run produces PROPOSALS, never rows. What the model
// (or the deterministic sheet reader) returns is validated, classified with the same pure
// functions the manual entry route uses, checked against the statement's own closing balance,
// and stored on `LedgerAiRun.proposals` for a person to look at. `POST /runs/[id]/accept` is
// the only thing that writes a `BrandStatement`, a `BrandLedgerEntry` or a `LedgerGap`.
//
// Three inputs, three paths:
//   STATEMENT_ROWS   PDF / image → runAi with an attachment; XLSX / XLS / CSV → no AI at all,
//                    the workbook is read with `xlsx` and every row classified in code.
//   CLAIMS_FROM_CHAT a WhatsApp export (.txt, or the _chat.txt inside a .zip) split into
//                    chunks of CHAT_CHUNK_MESSAGES, one call per chunk, claims merged.
//   CLAIMS_FROM_IMAGE one image attachment.
import { Prisma, type LedgerAiTask, type LedgerEntryType } from "@prisma/client";
import { unzipSync } from "fflate";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { runAi, AiError } from "@/lib/ai";
import type { AiAttachment, AiResult } from "@/lib/ai";
import {
  CLAIMS_SCHEMA,
  CLAIMS_SYSTEM_PROMPT,
  STATEMENT_SCHEMA,
  STATEMENT_SYSTEM_PROMPT,
  buildChatClaimsPrompt,
  buildImageClaimsPrompt,
  buildStatementPrompt,
  validateClaimsReply,
  validateStatementReply,
  type ClaimProposal,
  type StatementReply,
  type StatementReplyRow,
} from "./ai-prompts";
import { checkBalance, classifyEntry, parseAmount, parseLedgerDate, sideForType } from "./reconcile";
import { readLedgerFile, fileExtension, CONTENT_TYPES } from "./uploads";
import { isoDay } from "./view-types";

const log = createLogger("ledger:ai");

/** Q6 — the owner's choice. A 9,000-message export becomes six calls, not one impossible one. */
export const CHAT_CHUNK_MESSAGES = 1500;
/** Chat chunks in flight at once. Three keeps a seven-chunk export inside one request without tripping rate limits. */
const CHAT_CONCURRENCY = 3;

/**
 * Anthropic refuses a request over 32 MB and a PDF over 100 pages; the other providers are in
 * the same range. Refused here, before the call, with a sentence that says what to do.
 */
const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;

const AI_DOCUMENT_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp"];
const SHEET_EXTENSIONS = ["xlsx", "xls", "csv"];

// ─── Proposal shapes (stored as Json on the run; read back by the review card and accept) ──

export interface StatementRowProposal {
  /** YYYY-MM-DD */
  date: string;
  label: string;
  ref: string;
  note: string;
  amount: number;
  /** +1 a debit on the brand's ledger (BCH owes more), -1 a credit (BCH owes less). */
  direction: 1 | -1;
  type: LedgerEntryType;
  side: "VENDOR" | "BCH";
}

export interface StatementProposals {
  kind: "statement";
  statementDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  /** The opening the statement starts from; the tie-out runs from it. Not a row. */
  opening: number;
  claimedClosing: number | null;
  computedClosing: number;
  difference: number | null;
  tiesOut: boolean;
  rows: StatementRowProposal[];
  /** Lines dropped for having no readable date or amount — shown, so a silent loss is impossible. */
  skipped: number;
  /** "ai" for a PDF / image read, "sheet" for the deterministic workbook read. */
  source: "ai" | "sheet";
}

export interface ClaimsProposals {
  kind: "claims";
  claims: ClaimProposal[];
}

export type LedgerProposals = StatementProposals | ClaimsProposals;

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Run the AI pass for one `LedgerAiRun` (already created at RUNNING by the route). Marks the
 * run DONE with its proposals, or FAILED with the reason, and rethrows so the route can map an
 * AiError to the right HTTP answer. Never writes a ledger row.
 */
export async function runLedgerAi(runId: string): Promise<void> {
  const run = await prisma.ledgerAiRun.findUnique({
    where: { id: runId },
    include: { upload: { select: { id: true, kind: true, fileName: true, fileUrl: true, deletedAt: true, sizeBytes: true } } },
  });
  if (!run) throw new Error("Run not found");
  const { upload } = run;
  const ctx = { runId, task: run.task, uploadId: upload.id };

  try {
    if (!upload.fileUrl || upload.deletedAt) throw new Error("The file has been deleted; upload it again to run AI over it.");
    const bytes = await readLedgerFile(upload.fileUrl);
    if (!bytes) throw new Error("The stored file could not be read back. Upload it again.");
    log.debug("run started", { ...ctx, bytes: bytes.byteLength, ext: fileExtension(upload.fileName) });

    const outcome = await execute(run.task, upload.fileName, bytes, run.userPrompt, ctx);

    await prisma.ledgerAiRun.update({
      where: { id: runId },
      data: {
        status: "DONE",
        proposals: outcome.proposals as unknown as Prisma.InputJsonValue,
        reply: outcome.reply == null ? Prisma.DbNull : (outcome.reply as Prisma.InputJsonValue),
        provider: outcome.provider,
        model: outcome.model,
        usageIn: outcome.usageIn,
        usageOut: outcome.usageOut,
        latencyMs: outcome.latencyMs,
        chunks: outcome.chunks,
        error: null,
      },
    });
    log.info("run finished", {
      ...ctx,
      usageIn: outcome.usageIn,
      usageOut: outcome.usageOut,
      latencyMs: outcome.latencyMs,
      chunks: outcome.chunks,
      proposals: outcome.proposals.kind === "statement" ? outcome.proposals.rows.length : outcome.proposals.claims.length,
      tiesOut: outcome.proposals.kind === "statement" ? outcome.proposals.tiesOut : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("run failed", { ...ctx, kind: error instanceof AiError ? error.kind : error instanceof Error ? error.name : "unknown", error: message });
    await prisma.ledgerAiRun.update({ where: { id: runId }, data: { status: "FAILED", error: message } });
    throw error;
  }
}

interface Outcome {
  proposals: LedgerProposals;
  reply: unknown;
  provider: string | null;
  model: string | null;
  usageIn: number;
  usageOut: number;
  latencyMs: number;
  chunks: number;
}

async function execute(
  task: LedgerAiTask,
  fileName: string,
  bytes: ArrayBuffer,
  userPrompt: string | null,
  ctx: Record<string, unknown>
): Promise<Outcome> {
  const ext = fileExtension(fileName);
  switch (task) {
    case "STATEMENT_ROWS": {
      if (SHEET_EXTENSIONS.includes(ext)) return statementFromSheet(fileName, bytes, ctx);
      if (AI_DOCUMENT_EXTENSIONS.includes(ext)) return statementFromDocument(fileName, bytes, userPrompt, ctx);
      throw new Error(`A statement must be a PDF, an image or a sheet — not .${ext}`);
    }
    case "CLAIMS_FROM_CHAT": {
      if (ext !== "txt" && ext !== "zip") throw new Error(`A chat export must be .txt or .zip — not .${ext}`);
      return claimsFromChat(fileName, bytes, userPrompt, ctx);
    }
    case "CLAIMS_FROM_IMAGE": {
      if (!AI_DOCUMENT_EXTENSIONS.includes(ext)) throw new Error(`Claims can be read from a PDF or an image — not .${ext}`);
      return claimsFromDocument(fileName, bytes, userPrompt, ctx);
    }
    default:
      throw new Error(`Unknown task ${String(task)}`);
  }
}

// ─── Attachments ──────────────────────────────────────────────────────────────

function attachmentFor(fileName: string, bytes: ArrayBuffer): AiAttachment {
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error("This file is over 30 MB, which is more than the AI provider accepts. Split it or upload a smaller export.");
  }
  const ext = fileExtension(fileName);
  return {
    kind: ext === "pdf" ? "pdf" : "image",
    mediaType: CONTENT_TYPES[ext] ?? "application/octet-stream",
    base64: Buffer.from(bytes).toString("base64"),
    fileName,
  };
}

// ─── STATEMENT_ROWS ───────────────────────────────────────────────────────────

/** A raw debit/credit line → a classified proposal row, or null when it cannot be placed. */
function classifyRow(row: StatementReplyRow, carriedDate: string | null): StatementRowProposal | null {
  const date = (row.date && isoDay(parseLedgerDate(row.date))) || carriedDate;
  const debit = row.debit ?? null;
  const credit = row.credit ?? null;
  const amount = debit && debit > 0 ? debit : credit && credit > 0 ? credit : null;
  if (!date || !amount) return null;
  // The column decides the sign — a credit posted on a sales voucher is still a credit — and
  // the label decides the type. When the label says nothing usable the sign picks the type.
  const direction: 1 | -1 = debit && debit > 0 ? 1 : -1;
  let type = classifyEntry(row.label, direction);
  if (type === "OPENING") type = direction > 0 ? "INVOICE" : "ADJUSTMENT";
  return {
    date,
    label: row.label,
    ref: row.ref,
    note: row.note,
    amount: Math.round(amount * 100) / 100,
    direction,
    type,
    side: sideForType(type),
  };
}

function statementProposals(reply: StatementReply, source: "ai" | "sheet"): StatementProposals {
  const rows: StatementRowProposal[] = [];
  let skipped = 0;
  let carried: string | null = null;
  for (const raw of reply.rows) {
    const row = classifyRow(raw, carried);
    if (!row) {
      skipped++;
      continue;
    }
    carried = row.date;
    rows.push(row);
  }
  const opening = reply.openingBalance ?? 0;
  const check = checkBalance(rows, opening, reply.claimedClosing);
  return {
    kind: "statement",
    statementDate: reply.statementDate,
    periodFrom: reply.periodFrom,
    periodTo: reply.periodTo,
    opening,
    claimedClosing: reply.claimedClosing,
    computedClosing: check.computedClosing,
    difference: check.difference,
    tiesOut: check.tiesOut,
    rows,
    skipped,
    source,
  };
}

/** Re-run the tie-out over rows a person may have edited. Used by the accept route. */
export function recheckStatement(
  rows: StatementRowProposal[],
  opening: number,
  claimedClosing: number | null
): { computedClosing: number; difference: number | null; tiesOut: boolean } {
  const check = checkBalance(rows, opening, claimedClosing);
  return { computedClosing: check.computedClosing, difference: check.difference, tiesOut: check.tiesOut };
}

async function statementFromDocument(
  fileName: string,
  bytes: ArrayBuffer,
  userPrompt: string | null,
  ctx: Record<string, unknown>
): Promise<Outcome> {
  const attachment = attachmentFor(fileName, bytes);
  log.debug("-> ai", { ...ctx, bytes: bytes.byteLength, chunk: 0 });
  const result = await runAi({
    purpose: "ledger.statement_rows",
    system: STATEMENT_SYSTEM_PROMPT,
    prompt: buildStatementPrompt(userPrompt),
    attachments: [attachment],
    maxTokens: 16000,
    json: true,
    jsonSchema: STATEMENT_SCHEMA,
    effort: "high",
  });
  const reply = validateStatementReply(result.json);
  return outcomeOf([result], statementProposals(reply, "ai"), result.json);
}

// ─── The deterministic sheet read ─────────────────────────────────────────────

const HEADER_WORDS = /date|particular|description|narration|debit|credit|amount|balance|vch|voucher|ref|invoice|type/i;

interface SheetColumns {
  date: number | null;
  label: number | null;
  ref: number | null;
  debit: number | null;
  credit: number | null;
  amount: number | null;
  balance: number | null;
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(6)));
  // xlsx builds a Date in LOCAL time (cellDates below). Read it back with the local getters:
  // toISOString() on an IST midnight is the previous day at 18:30Z, which shifts every date.
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const dd = String(v.getDate()).padStart(2, "0");
    return `${v.getFullYear()}-${mm}-${dd}`;
  }
  return String(v).trim();
}

function detectColumns(header: string[]): SheetColumns {
  const find = (re: RegExp) => {
    const i = header.findIndex((h) => re.test(h));
    return i === -1 ? null : i;
  };
  return {
    date: find(/^\s*date|\bdate\b/i),
    label: find(/particular|description|narration|type|account|details/i),
    ref: find(/vch\s*no|voucher\s*no|ref|invoice\s*no|bill\s*no|txn|number/i),
    debit: find(/debit|\bdr\b/i),
    credit: find(/credit|\bcr\b/i),
    amount: find(/^amount|\bamount\b/i),
    balance: find(/balance|closing/i),
  };
}

/**
 * The workbook, read in code. A brand's statement has a header row somewhere in the first
 * twenty rows naming date / particulars / debit / credit (/ balance); every row after it with a
 * readable amount is a transaction. An "opening" line seeds the tie-out, a "closing" line (or
 * the last balance cell) is what the brand claims, and totals are skipped.
 */
async function statementFromSheet(fileName: string, bytes: ArrayBuffer, ctx: Record<string, unknown>): Promise<Outcome> {
  const started = Date.now();
  const isCsv = fileExtension(fileName) === "csv";
  // cellDates + raw: a date cell arrives as a Date and a number as a number. With raw:false
  // xlsx would hand back its own US-formatted text ("4/5/26" for 5 April), which the
  // day-first parser then reads as 4 May — every statement date silently wrong.
  const wb = isCsv
    ? XLSX.read(new TextDecoder("utf-8").decode(bytes), { type: "string", cellDates: true })
    : XLSX.read(bytes, { type: "array", cellDates: true });
  if (wb.SheetNames.length === 0) throw new Error("No sheets found in the file");

  const rows: StatementReplyRow[] = [];
  let openingBalance: number | null = null;
  let claimedClosing: number | null = null;
  let lastBalance: number | null = null;
  let sheetsRead = 0;

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
    const text = grid.map((r) => (Array.isArray(r) ? r.map(cellText) : []));
    const headerRow = text.slice(0, 20).findIndex((r) => r.filter((c) => HEADER_WORDS.test(c)).length >= 2);
    if (headerRow === -1) continue;
    sheetsRead++;
    const cols = detectColumns(text[headerRow]);
    if (cols.debit === null && cols.credit === null && cols.amount === null) continue;

    for (const r of text.slice(headerRow + 1)) {
      if (r.every((c) => !c)) continue;
      const joined = r.join(" ");
      const label = cols.label !== null ? r[cols.label] ?? "" : "";
      const balanceCell = cols.balance !== null ? parseAmount(r[cols.balance]) : null;

      // An opening or closing line carries a MAGNITUDE, whichever column it sits in: the figure
      // the brand says BCH owes. The side (Dr/Cr) is theirs to print, not a sign to apply — a
      // closing of 65,000 in the credit column is still "you owe 65,000". The review card lets a
      // person correct either figure before anything is accepted.
      if (/opening/i.test(joined)) {
        const v = balanceCell ?? signedAmount(r, cols);
        openingBalance = v === null ? null : Math.abs(v);
        continue;
      }
      if (/closing/i.test(joined)) {
        const v = balanceCell ?? signedAmount(r, cols);
        claimedClosing = v === null ? null : Math.abs(v);
        continue;
      }
      if (/^\s*(grand\s+)?total/i.test(label) || /\btotal\b/i.test(label)) continue;

      let debit = cols.debit !== null ? parseAmount(r[cols.debit]) : null;
      let credit = cols.credit !== null ? parseAmount(r[cols.credit]) : null;
      if (debit === null && credit === null && cols.amount !== null) {
        const a = parseAmount(r[cols.amount]);
        if (a !== null) {
          if (a >= 0) debit = a;
          else credit = -a;
        }
      }
      if (!debit && !credit) continue;
      if (balanceCell !== null) lastBalance = balanceCell;
      rows.push({
        date: cols.date !== null ? r[cols.date] || null : null,
        label,
        ref: cols.ref !== null ? r[cols.ref] ?? "" : "",
        debit: debit && debit !== 0 ? Math.abs(debit) : null,
        credit: credit && credit !== 0 ? Math.abs(credit) : null,
        note: "",
      });
    }
  }

  if (sheetsRead === 0) throw new Error("No header row naming date / particulars / debit / credit was found in the sheet");
  if (claimedClosing === null) claimedClosing = lastBalance;

  const reply: StatementReply = {
    statementDate: null,
    periodFrom: null,
    periodTo: null,
    openingBalance,
    claimedClosing,
    rows,
  };
  const proposals = statementProposals(reply, "sheet");
  log.debug("sheet read", { ...ctx, sheets: sheetsRead, rows: proposals.rows.length, skipped: proposals.skipped, tiesOut: proposals.tiesOut });
  return {
    proposals,
    reply: null,
    provider: null,
    model: null,
    usageIn: 0,
    usageOut: 0,
    latencyMs: Date.now() - started,
    chunks: 0,
  };
}

/** An opening/closing line's figure when it sits in a debit or credit column instead of balance. */
function signedAmount(r: string[], cols: SheetColumns): number | null {
  const debit = cols.debit !== null ? parseAmount(r[cols.debit]) : null;
  const credit = cols.credit !== null ? parseAmount(r[cols.credit]) : null;
  const amount = cols.amount !== null ? parseAmount(r[cols.amount]) : null;
  if (debit) return debit;
  if (credit) return -credit;
  return amount;
}

// ─── CLAIMS_FROM_CHAT ─────────────────────────────────────────────────────────

/** A WhatsApp export line that starts a message: `[12/05/24, 10:31:02 AM]` or `12/05/24, 10:31 - `. */
const MESSAGE_START = /^‎?\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/;

interface ChatMessage {
  line: number;
  text: string;
}

/** The chat text out of a .txt, or out of the `_chat.txt` (else the largest .txt) inside a .zip. */
function chatText(fileName: string, bytes: ArrayBuffer): string {
  if (fileExtension(fileName) !== "zip") return new TextDecoder("utf-8").decode(bytes);
  const entries = unzipSync(new Uint8Array(bytes));
  const names = Object.keys(entries).filter((n) => n.toLowerCase().endsWith(".txt") && !n.startsWith("__MACOSX"));
  if (names.length === 0) throw new Error("The zip holds no .txt chat export");
  const chosen =
    names.find((n) => n.toLowerCase().endsWith("_chat.txt")) ??
    names.sort((a, b) => entries[b].length - entries[a].length)[0];
  return new TextDecoder("utf-8").decode(entries[chosen]);
}

/** Lines folded into messages; a continuation line joins the message above it. */
function splitMessages(text: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    if (MESSAGE_START.test(raw) || messages.length === 0) messages.push({ line: i + 1, text: raw });
    else messages[messages.length - 1].text += "\n" + raw;
  }
  return messages;
}

function chunkOf(messages: ChatMessage[]): string {
  return messages.map((m) => `L${m.line} ${m.text}`).join("\n");
}

async function claimsFromChat(
  fileName: string,
  bytes: ArrayBuffer,
  userPrompt: string | null,
  ctx: Record<string, unknown>
): Promise<Outcome> {
  const messages = splitMessages(chatText(fileName, bytes));
  if (messages.length === 0) throw new Error("The chat export holds no messages");
  const chunkCount = Math.ceil(messages.length / CHAT_CHUNK_MESSAGES);
  log.debug("chat split", { ...ctx, messages: messages.length, chunks: chunkCount });

  // The chunks are independent — each names its own line numbers and the merge below dedupes
  // — so they run CHAT_CONCURRENCY at a time rather than one after another. A 9,000-message
  // export is seven chunks; sequential high-effort calls would not fit the route's
  // maxDuration, and the run would die RUNNING with nothing to reap it (there is no cron).
  // Results are merged in chunk order so the proposal list is stable across runs.
  const chunks = Array.from({ length: chunkCount }, (_, i) =>
    chunkOf(messages.slice(i * CHAT_CHUNK_MESSAGES, (i + 1) * CHAT_CHUNK_MESSAGES))
  );
  const results: AiResult[] = new Array(chunkCount);
  let next = 0;
  const worker = async () => {
    while (next < chunkCount) {
      const i = next++;
      const text = chunks[i];
      log.debug("-> ai", { ...ctx, bytes: text.length, chunk: i + 1, of: chunkCount });
      results[i] = await runAi({
        purpose: "ledger.claims_from_chat",
        system: CLAIMS_SYSTEM_PROMPT,
        prompt: buildChatClaimsPrompt(text, i, chunkCount, userPrompt),
        maxTokens: 16000,
        json: true,
        jsonSchema: CLAIMS_SCHEMA,
        effort: "high",
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHAT_CONCURRENCY, chunkCount) }, worker));

  const replies: unknown[] = [];
  const merged: ClaimProposal[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    replies.push(result.json);
    for (const claim of validateClaimsReply(result.json)) {
      const key = `${claim.title.toLowerCase()}|${claim.amount ?? claim.amountNote.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(claim);
    }
  }

  return outcomeOf(results, { kind: "claims", claims: merged }, replies, chunkCount);
}

// ─── CLAIMS_FROM_IMAGE ────────────────────────────────────────────────────────

async function claimsFromDocument(
  fileName: string,
  bytes: ArrayBuffer,
  userPrompt: string | null,
  ctx: Record<string, unknown>
): Promise<Outcome> {
  const attachment = attachmentFor(fileName, bytes);
  log.debug("-> ai", { ...ctx, bytes: bytes.byteLength, chunk: 0 });
  const result = await runAi({
    purpose: "ledger.claims_from_image",
    system: CLAIMS_SYSTEM_PROMPT,
    prompt: buildImageClaimsPrompt(userPrompt),
    attachments: [attachment],
    maxTokens: 8000,
    json: true,
    jsonSchema: CLAIMS_SCHEMA,
    effort: "high",
  });
  return outcomeOf([result], { kind: "claims", claims: validateClaimsReply(result.json) }, result.json);
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function outcomeOf(results: AiResult[], proposals: LedgerProposals, reply: unknown, chunks = 1): Outcome {
  return {
    proposals,
    reply,
    provider: results[0]?.provider ?? null,
    model: results[0]?.model ?? null,
    usageIn: results.reduce((n, r) => n + r.usage.input, 0),
    usageOut: results.reduce((n, r) => n + r.usage.output, 0),
    latencyMs: results.reduce((n, r) => n + r.latencyMs, 0),
    chunks,
  };
}
