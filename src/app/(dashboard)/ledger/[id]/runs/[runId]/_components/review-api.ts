// The review page's calls. Every one goes through apiTry (CLAUDE.md: never raw fetch().json()
// in the browser) and logs identifiers and counts only — never a row, a claim or the prompt.
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { AcceptRow, ReviewRun } from "./review-types";
import type { ClaimProposal } from "@/lib/brand-ledger/ai-prompts";

const log = createLogger("ledger:review");

export interface AcceptBody {
  rows?: AcceptRow[];
  opening?: number;
  claimedClosing?: number | null;
  acceptDifference?: boolean;
  claims?: ClaimProposal[];
}

export interface AcceptResult {
  accepted: boolean;
  statementId?: string;
  entries?: number;
  gaps?: number;
  firstNumber?: number;
  lastNumber?: number;
}

/** A refusal the screen shows as given, with its status so the screen can react to a 409. */
export interface Refusal {
  error: string;
  status?: number;
}

export async function loadRun(runId: string): Promise<{ run: ReviewRun } | Refusal> {
  const { data, error, status } = await apiTry<ReviewRun>(`/api/ledger/runs/${runId}`);
  if (error || !data) {
    log.warn("run failed to load", { runId, status });
    return { error: error || "Could not load this run", status };
  }
  log.debug("run loaded", {
    runId,
    task: data.task,
    status: data.status,
    kind: data.proposals?.kind ?? null,
    siblings: data.siblings?.length ?? 0,
    existing: data.existing?.length ?? 0,
  });
  return { run: data };
}

export async function acceptRun(runId: string, body: AcceptBody): Promise<{ result: AcceptResult } | Refusal> {
  const counts = {
    runId,
    rows: body.rows?.length ?? null,
    claims: body.claims?.length ?? null,
    acceptDifference: body.acceptDifference ?? false,
  };
  log.debug("-> accept", counts);
  const { data, error, status } = await apiTry<AcceptResult>(`/api/ledger/runs/${runId}/accept`, {
    method: "POST",
    json: body,
    timeoutMs: 60_000,
  });
  if (error || !data) {
    log.warn("accept refused", { ...counts, status });
    return { error: error || "Not approved", status };
  }
  log.info("run approved", { runId, entries: data.entries ?? null, gaps: data.gaps ?? null, statementId: data.statementId ?? null });
  return { result: data };
}

export async function discardRun(runId: string): Promise<{ ok: true } | Refusal> {
  const { error, status } = await apiTry(`/api/ledger/runs/${runId}/discard`, { method: "POST" });
  if (error) {
    log.warn("discard refused", { runId, status });
    return { error, status };
  }
  log.info("run discarded", { runId });
  return { ok: true };
}

/** A new run over the same kept cells or text. The prompt is sent, never logged. */
export async function rerunRun(fromRunId: string, prompt: string): Promise<{ id: string } | Refusal> {
  log.debug("-> rerun", { fromRunId, promptLength: prompt.length });
  // The route reads with the AI before it answers (maxDuration 60 s); allow for the queue.
  const { data, error, status, isTimeout } = await apiTry<{ id: string }>(`/api/ledger/runs/${fromRunId}/rerun`, {
    method: "POST",
    json: { prompt },
    timeoutMs: 120_000,
  });
  if (error || !data?.id) {
    log.warn("rerun refused", { fromRunId, status, isTimeout });
    return { error: error || "The re-run did not start", status };
  }
  log.info("rerun created", { fromRunId, runId: data.id });
  return { id: data.id };
}
