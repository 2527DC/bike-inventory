// ─── One prompted import run (plan 1310-ledger-prompted-import-without-file-storage) ────
//
// The input arrives IN MEMORY — from the import route, or from `run.source` on a re-run — and
// is never written to storage (R6). The run produces PROPOSALS only; `runs/[id]/accept` is the
// only thing that writes a ledger row (R5).
//
//   sheet       one planning call over the first rows → the plan is validated against the real
//               sheet → applyPlan() maps EVERY row in code (amounts from cells, not a model).
//               No usable plan → the AI types the rows from the sheet's text (flagged aiTyped).
//   text        ≤ ROUTED_TEXT_MAX_CHARS: one call returning the action and its data.
//               longer: the action from the opening part, then chunked extraction.
//   attachment  an image (downscaled in the browser) or a PDF: one call with the attachment.
//
// What is kept on the run (`source`) is cells or text, never an attachment: an image's or a
// PDF's re-run works on the rows the first read produced (§1.1, "keep the extracted rows").
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { runAi, AiError } from "@/lib/ai";
import type { AiResult } from "@/lib/ai";
import {
  CLAIMS_SCHEMA,
  CLAIMS_SYSTEM_PROMPT,
  STATEMENT_SCHEMA,
  STATEMENT_SYSTEM_PROMPT,
  buildChatClaimsPrompt,
  validateClaimsReply,
  validateStatementReply,
  type ClaimProposal,
  type StatementReply,
} from "./ai-prompts";
import {
  ACTION_ONLY_SCHEMA,
  IMPORT_PLAN_SCHEMA,
  IMPORT_PLAN_SYSTEM_PROMPT,
  ROUTED_SCHEMA,
  ROUTED_SYSTEM_PROMPT,
  buildActionOnlyPrompt,
  buildImportPlanPrompt,
  buildRoutedAttachmentPrompt,
  buildRoutedTextPrompt,
  buildTextStatementPrompt,
  validateActionOnlyReply,
  validateImportPlanReply,
  validateRoutedReply,
} from "./import-prompts";
import {
  applyPlan,
  planProblem,
  sheetAsText,
  sheetPlanSchema,
  sheetPreview,
  tieOut,
  type ImportInput,
  type ImportSource,
  type SheetPlan,
} from "./prompted-import";
import { statementProposals, type LedgerProposals, type StatementProposals } from "./ai-run";

const log = createLogger("ledger:import");

/** Text up to this goes in one call with the action; longer text is chunked. */
const ROUTED_TEXT_MAX_CHARS = 60_000;
/** The size of each chunk of a long text. */
const TEXT_CHUNK_CHARS = 50_000;
/** Chunks in flight at once — the chat reader's figure. */
const CHUNK_CONCURRENCY = 3;

interface ImportOutcome {
  proposals: LedgerProposals;
  source: ImportSource | null;
  replies: unknown[];
  results: AiResult[];
}

/**
 * Run one prompted import for a `LedgerAiRun` already created at RUNNING. Marks it DONE with
 * proposals and source, or FAILED with the reason, and rethrows so the route maps an AiError.
 */
export async function runPromptedImport(runId: string, input: ImportInput): Promise<void> {
  const run = await prisma.ledgerAiRun.findUnique({ where: { id: runId }, select: { id: true, userPrompt: true, vendorId: true } });
  if (!run) throw new Error("Run not found");
  const ctx = { runId, vendorId: run.vendorId, kind: input.kind };
  const started = Date.now();

  try {
    log.debug("import started", { ...ctx, size: inputSize(input) });
    const outcome =
      input.kind === "sheet"
        ? await fromSheet(input, run.userPrompt, ctx)
        : input.kind === "text"
          ? await fromText(input, run.userPrompt, ctx)
          : await fromAttachment(input, run.userPrompt, ctx);

    const { results } = outcome;
    await prisma.ledgerAiRun.update({
      where: { id: runId },
      data: {
        status: "DONE",
        proposals: outcome.proposals as unknown as Prisma.InputJsonValue,
        source: outcome.source == null ? Prisma.DbNull : (outcome.source as unknown as Prisma.InputJsonValue),
        reply: outcome.replies.length ? (outcome.replies as Prisma.InputJsonValue) : Prisma.DbNull,
        provider: results[0]?.provider ?? null,
        model: results[0]?.model ?? null,
        usageIn: results.reduce((n, r) => n + r.usage.input, 0),
        usageOut: results.reduce((n, r) => n + r.usage.output, 0),
        latencyMs: Date.now() - started,
        chunks: results.length,
        error: null,
      },
    });
    const p = outcome.proposals;
    log.info("import finished", {
      ...ctx,
      kindOut: p.kind,
      rows: p.kind === "statement" ? p.rows.length : p.kind === "claims" ? p.claims.length : 0,
      skipped: p.kind === "statement" ? p.skipped : 0,
      tiesOut: p.kind === "statement" ? p.tiesOut : null,
      aiTyped: p.kind === "statement" ? !!p.aiTyped : null,
      calls: results.length,
      ms: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("import failed", { ...ctx, kind: error instanceof AiError ? error.kind : error instanceof Error ? error.name : "unknown", error: message });
    // A failed run keeps the cells or text it was given (never an attachment, R6) so it can be
    // re-run once the cause is fixed — e.g. AI not configured yet — without uploading again.
    await prisma.ledgerAiRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        error: message,
        source: input.kind === "attachment" ? Prisma.DbNull : (input as unknown as Prisma.InputJsonValue),
      },
    });
    throw error;
  }
}

function inputSize(input: ImportInput): number {
  if (input.kind === "sheet") return input.sheets.reduce((n, s) => n + s.rows.length, 0);
  if (input.kind === "text") return input.text.length;
  return input.base64.length;
}

// ─── Sheets ───────────────────────────────────────────────────────────────────

async function fromSheet(input: Extract<ImportInput, { kind: "sheet" }>, userPrompt: string | null, ctx: Record<string, unknown>): Promise<ImportOutcome> {
  log.debug("-> ai ledger.import_plan", { ...ctx, sheets: input.sheets.length });
  const planResult = await runAi({
    purpose: "ledger.import_plan",
    system: IMPORT_PLAN_SYSTEM_PROMPT,
    prompt: buildImportPlanPrompt(sheetPreview(input.sheets), userPrompt),
    maxTokens: 4000,
    json: true,
    jsonSchema: IMPORT_PLAN_SCHEMA,
    effort: "high",
  });
  const reply = validateImportPlanReply(planResult.json);
  const source: ImportSource = input;

  if (reply.action === "NOT_A_LEDGER") {
    return { proposals: { kind: "not_ledger", explanation: reply.explanation }, source, replies: [planResult.json], results: [planResult] };
  }

  if (reply.action === "CLAIMS") {
    const claims = await claimsFromLongText(sheetAsText(input.sheets), userPrompt, ctx);
    return {
      proposals: { kind: "claims", claims: claims.claims, explanation: reply.explanation },
      source,
      replies: [planResult.json, ...claims.replies],
      results: [planResult, ...claims.results],
    };
  }

  // STATEMENT_ROWS: the plan is checked against the real sheet before a single row is read.
  const parsed = sheetPlanSchema.safeParse(reply.plan);
  const problem = parsed.success ? planProblem(parsed.data as SheetPlan, input.sheets) : "The AI did not give a usable column mapping.";
  if (parsed.success && !problem) {
    const plan = parsed.data as SheetPlan;
    const applied = applyPlan(plan, input.sheets);
    const check = tieOut(applied.rows, applied.opening, applied.claimedClosing);
    const proposals: StatementProposals = {
      kind: "statement",
      statementDate: null,
      periodFrom: applied.periodFrom,
      periodTo: applied.periodTo,
      opening: applied.opening,
      claimedClosing: applied.claimedClosing,
      computedClosing: check.computedClosing,
      difference: check.difference,
      tiesOut: check.tiesOut,
      rows: applied.rows,
      skipped: applied.skipped.length,
      skippedRows: applied.skipped,
      source: "plan",
      importPlan: plan,
      explanation: reply.explanation,
      aiTyped: false,
    };
    log.debug("plan applied", { ...ctx, sheet: plan.sheet, headerRow: plan.headerRow, rows: applied.rows.length, skipped: applied.skipped.length });
    return { proposals, source, replies: [planResult.json], results: [planResult] };
  }

  // No usable plan: the AI types the rows from the sheet's text, and the review says so.
  log.warn("plan unusable — falling back to AI-typed rows", { ...ctx, problem });
  const typed = await statementFromLongText(sheetAsText(input.sheets), userPrompt, ctx);
  typed.proposals.explanation = `${reply.explanation} ${problem} The AI typed the rows instead — check each amount.`.trim();
  return { proposals: typed.proposals, source, replies: [planResult.json, ...typed.replies], results: [planResult, ...typed.results] };
}

// ─── Text ─────────────────────────────────────────────────────────────────────

async function fromText(input: Extract<ImportInput, { kind: "text" }>, userPrompt: string | null, ctx: Record<string, unknown>): Promise<ImportOutcome> {
  const source: ImportSource = input;
  if (input.text.length <= ROUTED_TEXT_MAX_CHARS) {
    log.debug("-> ai ledger.import_text", { ...ctx, chars: input.text.length });
    const result = await runAi({
      purpose: "ledger.import_text",
      system: ROUTED_SYSTEM_PROMPT,
      prompt: buildRoutedTextPrompt(input.text, userPrompt),
      maxTokens: 16000,
      json: true,
      jsonSchema: ROUTED_SCHEMA,
      effort: "high",
    });
    const reply = validateRoutedReply(result.json);
    return { proposals: routedProposals(reply.action, reply.explanation, reply.statement, reply.claims), source, replies: [result.json], results: [result] };
  }

  // Too long for one call: decide the action from the opening, then read it in chunks.
  log.debug("-> ai ledger.import_action", { ...ctx, chars: input.text.length });
  const head = await runAi({
    purpose: "ledger.import_action",
    system: ROUTED_SYSTEM_PROMPT,
    prompt: buildActionOnlyPrompt(input.text.slice(0, 8000), input.text.length, userPrompt),
    maxTokens: 1000,
    json: true,
    jsonSchema: ACTION_ONLY_SCHEMA,
    effort: "low",
  });
  const action = validateActionOnlyReply(head.json);
  if (action.action === "NOT_A_LEDGER") {
    return { proposals: { kind: "not_ledger", explanation: action.explanation }, source, replies: [head.json], results: [head] };
  }
  if (action.action === "CLAIMS") {
    const claims = await claimsFromLongText(input.text, userPrompt, ctx);
    return {
      proposals: { kind: "claims", claims: claims.claims, explanation: action.explanation },
      source,
      replies: [head.json, ...claims.replies],
      results: [head, ...claims.results],
    };
  }
  const typed = await statementFromLongText(input.text, userPrompt, ctx);
  typed.proposals.explanation = action.explanation;
  return { proposals: typed.proposals, source, replies: [head.json, ...typed.replies], results: [head, ...typed.results] };
}

// ─── Image / PDF ──────────────────────────────────────────────────────────────

async function fromAttachment(input: Extract<ImportInput, { kind: "attachment" }>, userPrompt: string | null, ctx: Record<string, unknown>): Promise<ImportOutcome> {
  log.debug("-> ai ledger.import_attachment", { ...ctx, mediaType: input.mediaType, base64Chars: input.base64.length });
  const result = await runAi({
    purpose: "ledger.import_attachment",
    system: ROUTED_SYSTEM_PROMPT,
    prompt: buildRoutedAttachmentPrompt(userPrompt),
    attachments: [{ kind: input.mediaType === "application/pdf" ? "pdf" : "image", mediaType: input.mediaType, base64: input.base64, fileName: input.fileName }],
    maxTokens: 16000,
    json: true,
    jsonSchema: ROUTED_SCHEMA,
    effort: "high",
  });
  const reply = validateRoutedReply(result.json);
  const proposals = routedProposals(reply.action, reply.explanation, reply.statement, reply.claims);
  // The attachment is NOT kept (R6). A re-run works on what this read produced.
  return { proposals, source: sourceFromProposals(input.fileName, proposals), replies: [result.json], results: [result] };
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function routedProposals(
  action: "STATEMENT_ROWS" | "CLAIMS" | "NOT_A_LEDGER",
  explanation: string,
  statement: StatementReply | null,
  claims: ClaimProposal[] | null
): LedgerProposals {
  if (action === "NOT_A_LEDGER") return { kind: "not_ledger", explanation };
  if (action === "CLAIMS") return { kind: "claims", claims: claims ?? [], explanation };
  const p = statementProposals(statement ?? emptyStatement(), "ai");
  p.aiTyped = true;
  p.explanation = explanation;
  return p;
}

function emptyStatement(): StatementReply {
  return { statementDate: null, periodFrom: null, periodTo: null, openingBalance: null, claimedClosing: null, rows: [] };
}

/** Lines numbered L1… and cut into chunks at line boundaries, so a claim can cite its line. */
function chunksOf(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  lines.forEach((line, i) => {
    const numbered = `L${i + 1} ${line}`;
    if (size + numbered.length > TEXT_CHUNK_CHARS && current.length) {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
    }
    current.push(numbered);
    size += numbered.length + 1;
  });
  if (current.length) chunks.push(current.join("\n"));
  return chunks;
}

async function inChunks<T>(count: number, work: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = new Array(count);
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      out[i] = await work(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, count) }, worker));
  return out;
}

async function claimsFromLongText(text: string, userPrompt: string | null, ctx: Record<string, unknown>) {
  const chunks = chunksOf(text);
  const results = await inChunks(chunks.length, (i) => {
    log.debug("-> ai ledger.import_claims", { ...ctx, chunk: i + 1, of: chunks.length, chars: chunks[i].length });
    return runAi({
      purpose: "ledger.import_claims",
      system: CLAIMS_SYSTEM_PROMPT,
      prompt: buildChatClaimsPrompt(chunks[i], i, chunks.length, userPrompt),
      maxTokens: 16000,
      json: true,
      jsonSchema: CLAIMS_SCHEMA,
      effort: "high",
    });
  });
  const claims: ClaimProposal[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    for (const c of validateClaimsReply(r.json)) {
      const key = `${c.title.toLowerCase()}|${c.amount ?? c.amountNote.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push(c);
    }
  }
  return { claims, results, replies: results.map((r) => r.json) };
}

async function statementFromLongText(text: string, userPrompt: string | null, ctx: Record<string, unknown>) {
  const chunks = chunksOf(text);
  const results = await inChunks(chunks.length, (i) => {
    log.debug("-> ai ledger.import_statement", { ...ctx, chunk: i + 1, of: chunks.length, chars: chunks[i].length });
    return runAi({
      purpose: "ledger.import_statement",
      system: STATEMENT_SYSTEM_PROMPT,
      prompt: buildTextStatementPrompt(chunks[i], i, chunks.length, userPrompt),
      maxTokens: 16000,
      json: true,
      jsonSchema: STATEMENT_SCHEMA,
      effort: "high",
    });
  });
  const parts = results.map((r) => validateStatementReply(r.json));
  // Opening from the first part that shows one, closing from the last.
  const merged: StatementReply = {
    statementDate: parts.map((p) => p.statementDate).find(Boolean) ?? null,
    periodFrom: parts.map((p) => p.periodFrom).find(Boolean) ?? null,
    periodTo: [...parts].reverse().map((p) => p.periodTo).find(Boolean) ?? null,
    openingBalance: parts.map((p) => p.openingBalance).find((v) => v !== null) ?? null,
    claimedClosing: [...parts].reverse().map((p) => p.claimedClosing).find((v) => v !== null) ?? null,
    rows: parts.flatMap((p) => p.rows),
  };
  const proposals = statementProposals(merged, "ai");
  proposals.aiTyped = true;
  return { proposals, results, replies: results.map((r) => r.json) };
}

/**
 * What an image's or a PDF's run keeps for a re-run: the rows it read, as a small sheet (or the
 * claims as text) — never the attachment itself (R6, §1.1).
 */
function sourceFromProposals(fileName: string, p: LedgerProposals): ImportSource | null {
  if (p.kind === "statement") {
    const header = ["Date", "Particulars", "Ref", "Debit", "Credit", "Note"];
    const rows = p.rows.map((r) => [r.date, r.label, r.ref, r.direction > 0 ? String(r.amount) : "", r.direction < 0 ? String(r.amount) : "", r.note]);
    // Opening and closing go in the Debit column: applyPlan reads an opening / closing line's
    // figure from whichever amount column holds it, so a re-run's plan finds them again.
    const opening = p.opening ? [["", "Opening balance", "", String(p.opening), "", ""]] : [];
    const closing = p.claimedClosing !== null ? [["", "Closing balance", "", String(p.claimedClosing), "", ""]] : [];
    return { kind: "sheet", fileName, sheets: [{ name: `Read from ${fileName}`.slice(0, 100), rows: [header, ...opening, ...rows, ...closing] }] };
  }
  if (p.kind === "claims") {
    const text = p.claims
      .map((c) => [c.promisedOn ?? "", c.title, c.amount ?? c.amountNote, c.promisedBy, c.quote ? `"${c.quote}"` : ""].filter(Boolean).join(" — "))
      .join("\n");
    return text ? { kind: "text", fileName, text } : null;
  }
  return null;
}
