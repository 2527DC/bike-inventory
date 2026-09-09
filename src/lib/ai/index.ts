// AI resolver. The only thing outside this directory that anything should import.
//
// Which provider answers is DATA, not configuration-at-boot: it comes from the AiProvider
// rows and can be changed from Settings → AI with no redeploy — the same reasoning the
// storage resolver and the RBAC layer use.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { getAdapter } from "./adapters";
import { parseJsonReply } from "./json";
import { AI_PROVIDERS, defaultModelOf, isAiProviderKey, type AiProviderKey } from "./models";
import {
  AiError,
  AiNotConfiguredError,
  type AiActiveSettings,
  type AiAttachment,
  type AiCompletion,
  type AiRequest,
  type AiResult,
} from "./types";

const log = createLogger("ai");

export * from "./types";
export * from "./models";
export { parseJsonReply } from "./json";
export { runAiSelfTest, type AiSelfTestResult } from "./self-test";
export { toAiErrorResponse, aiErrorKind } from "./http";

// A short cache, not a permanent one. Every call would otherwise cost a database round
// trip, but a provider switch must take effect quickly without a redeploy — 30s is the
// compromise, and the settings route invalidates it immediately anyway.
const CACHE_MS = 30_000;
let cached: { at: number; settings: AiActiveSettings | null } | null = null;

/** Drop the cache. Call after any write to AiProvider. */
export function invalidateAiCache(): void {
  cached = null;
}

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 3_000;

function env(n: string): string | null {
  const v = process.env[n];
  return v && v.trim() ? v.trim() : null;
}

function settingsFromRow(row: { key: string; apiKey: string | null; model: string | null }): AiActiveSettings | null {
  // Context keys deliberately avoid `token`/`key` — logger.ts redact() blanks those names.
  if (!isAiProviderKey(row.key)) {
    log.error("active AiProvider row has an unknown key", { provider: row.key });
    return null;
  }
  if (!row.apiKey) {
    log.warn("active AiProvider row has no API key", { provider: row.key });
    return null;
  }
  return { provider: row.key, model: row.model ?? defaultModelOf(row.key), apiKey: row.apiKey };
}

/**
 * The env path is bootstrap only: a fresh deploy with ANTHROPIC_API_KEY set works before
 * anyone opens the settings screen. Unlike storage it WRITES the row, so from the second
 * request on the database is the only source and the env var is never read again —
 * otherwise changing the provider in the UI would appear to do nothing on a host that still
 * carries the variable.
 */
async function bootstrapFromEnv(apiKey: string): Promise<AiActiveSettings | null> {
  log.info("no AiProvider rows — bootstrapping anthropic from ANTHROPIC_API_KEY");
  try {
    const row = await prisma.aiProvider.create({
      data: { key: "anthropic", apiKey, model: defaultModelOf("anthropic"), isActive: true },
    });
    return settingsFromRow(row);
  } catch (error) {
    // Two first requests raced and the other create won. Its row is the truth from here on.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      log.warn("bootstrap lost a race to a concurrent create — re-reading", { provider: "anthropic" });
      const row = await prisma.aiProvider.findUnique({ where: { key: "anthropic" } });
      return row?.isActive ? settingsFromRow(row) : null;
    }
    // Never `error.message` here: a PrismaClientValidationError embeds the whole `data`
    // object in it, and that object carries the API key.
    log.error("bootstrap create failed", {
      provider: "anthropic",
      name: error instanceof Error ? error.name : "unknown",
      code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
    });
    throw error;
  }
}

/**
 * The active row, resolved to {provider, model, apiKey}, or null when nothing usable is
 * set up. Bypasses the cache — the settings route reads through here after a write.
 */
export async function loadActiveAiSettings(): Promise<AiActiveSettings | null> {
  const rows = await prisma.aiProvider.findMany();

  if (rows.length === 0) {
    const key = env("ANTHROPIC_API_KEY");
    return key ? bootstrapFromEnv(key) : null;
  }

  const active = rows.filter((r) => r.isActive);
  if (active.length === 0) return null;
  if (active.length > 1) {
    // Should be impossible — the settings route flips them in one transaction — but a
    // hand edit can do it. The most recently touched row is the one somebody meant.
    active.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    log.warn("more than one active AiProvider row", { providers: active.map((r) => r.key) });
  }
  return settingsFromRow(active[0]);
}

/**
 * The live settings.
 *
 * Throws AiNotConfiguredError when nothing usable is set up. That is a *defined* outcome,
 * not a crash: routes turn it into a 501 pointing at Settings → AI. The negative result is
 * cached too, so a missing configuration does not hammer the database on every attempt.
 */
async function getActiveAi(): Promise<AiActiveSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    if (cached.settings) return cached.settings;
    throw new AiNotConfiguredError();
  }

  const settings = await loadActiveAiSettings();
  cached = { at: Date.now(), settings };
  if (!settings) {
    log.warn("no AI provider is configured");
    throw new AiNotConfiguredError();
  }
  log.debug("active provider resolved", { provider: settings.provider, model: settings.model });
  return settings;
}

/** Checked before the call, not discovered by it — a 400 mid-upload is the wrong place. */
function assertAttachmentsSupported(provider: AiProviderKey, attachments: AiAttachment[]): void {
  const { label, supports } = AI_PROVIDERS[provider];
  if (attachments.some((a) => a.kind === "pdf") && !supports.pdf) {
    throw new AiError(
      "unsupported_attachment",
      `${label} cannot read PDF documents. Choose another provider at Settings → AI, or upload an image.`,
      { provider },
    );
  }
  if (attachments.some((a) => a.kind === "image") && !supports.image) {
    throw new AiError(
      "unsupported_attachment",
      `${label} cannot read images. Choose another provider at Settings → AI, or upload a PDF.`,
      { provider },
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run one request against the active provider.
 *
 * Retries are decided HERE and nowhere else: up to three attempts, only for an AiError the
 * adapter marked retryable (rate limit, overloaded, no response), 3s then 6s apart. A reply
 * that stopped on max_tokens or refusal is never handed back — the caller would otherwise
 * parse half a document and never know.
 */
export async function runAi(req: AiRequest): Promise<AiResult> {
  const started = Date.now();

  let settings: AiActiveSettings;
  try {
    settings = await getActiveAi();
  } catch (error) {
    log.error("ai call failed", {
      purpose: req.purpose,
      kind: error instanceof AiNotConfiguredError ? "not_configured" : "settings",
      attempts: 0,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error instanceof AiNotConfiguredError ? new AiNotConfiguredError(error.message, req.purpose) : error;
  }

  const { provider, model, apiKey } = settings;
  const attachments = req.attachments ?? [];
  const ctx = { purpose: req.purpose, provider, model };
  let attempts = 0;

  try {
    assertAttachmentsSupported(provider, attachments);

    log.debug("-> ai", {
      ...ctx,
      promptChars: req.prompt.length,
      systemChars: req.system?.length ?? 0,
      attachments: attachments.length,
      attachmentBytes: attachments.reduce((n, a) => n + a.base64.length, 0),
      maxOut: req.maxTokens ?? null,
      hasSchema: Boolean(req.jsonSchema),
      effort: req.effort ?? null,
    });

    const adapter = getAdapter(provider);
    let completion: AiCompletion;
    for (;;) {
      attempts += 1;
      try {
        completion = await adapter.complete(req, { apiKey, model });
        break;
      } catch (error) {
        if (!(error instanceof AiError) || !error.retryable || attempts >= MAX_ATTEMPTS) throw error;
        log.warn("ai retry", { ...ctx, attempt: attempts, kind: error.kind, status: error.status });
        await sleep(RETRY_BASE_MS * attempts);
      }
    }

    if (completion.stopReason === "max_tokens") {
      throw new AiError(
        "max_tokens",
        `The ${req.purpose} reply was cut off at ${completion.usage.output} output tokens. Raise maxTokens or send a smaller input.`,
        { provider },
      );
    }
    if (completion.stopReason === "refusal") {
      throw new AiError("refusal", `The model declined the ${req.purpose} request.`, { provider });
    }

    // A schema implies JSON: the caller wants the parsed value, not the text.
    const json = req.json || req.jsonSchema ? parseJsonReply(completion.text) : undefined;
    const latencyMs = Date.now() - started;

    log.info("ai call finished", {
      ...ctx,
      usageIn: completion.usage.input,
      usageOut: completion.usage.output,
      latencyMs,
      stopReason: completion.rawStopReason,
      attempts,
    });

    return { ...completion, json, provider, model, latencyMs };
  } catch (error) {
    log.error("ai call failed", {
      ...ctx,
      kind: error instanceof AiError ? error.kind : error instanceof Error ? error.name : "unknown",
      status: error instanceof AiError ? error.status : undefined,
      attempts,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
