// The contract between a call site, the resolver in ./index.ts, and a provider adapter.
//
// A call site builds an AiRequest and gets back an AiResult. It never names a provider, a
// model or an API key — those come from the active AiProvider row. An adapter turns an
// AiRequest plus {apiKey, model} into an AiCompletion using its provider's official SDK,
// and reports failure by throwing AiError with a `kind` the resolver can act on (retry, or
// surface with a message that says what to do).
import type { AiProviderKey } from "./models";

export type AiAttachmentKind = "pdf" | "image";

export interface AiAttachment {
  kind: AiAttachmentKind;
  /** "application/pdf" | "image/png" | "image/jpeg" | "image/webp" */
  mediaType: string;
  /** Raw base64 — no `data:` prefix, no newlines. */
  base64: string;
  fileName?: string;
}

export interface AiRequest {
  /**
   * A label for logs and error messages, e.g. "bank.statement_parse". It does NOT route
   * the call — every purpose uses the one active provider. Per-purpose routing is the
   * bigger plan (ai-provider-config-and-task-routing-plan.md), not this one.
   */
  purpose: string;
  prompt: string;
  system?: string;
  attachments?: AiAttachment[];
  /** Output cap. Default 16000 — never lowball it; a truncated JSON array is worse than a slow one. */
  maxTokens?: number;
  /**
   * Parse the reply as JSON (an object or an array; code fences and surrounding prose are
   * stripped first). On failure runAi throws AiError("parse") — it never hands back half of
   * a document.
   */
  json?: boolean;
}

export interface AiUsage {
  input: number;
  output: number;
}

/** What an adapter returns. Normalised across providers. */
export interface AiCompletion {
  text: string;
  usage: AiUsage;
  /** Normalised. "max_tokens" and "refusal" are turned into AiError by the resolver. */
  stopReason: "end" | "max_tokens" | "refusal" | "other";
  /** The provider's own value, for the log line. */
  rawStopReason?: string | null;
}

/** What a call site gets. */
export interface AiResult extends AiCompletion {
  json?: unknown;
  provider: AiProviderKey;
  model: string;
  latencyMs: number;
}

export interface AiAdapterConfig {
  apiKey: string;
  model: string;
}

export interface AiAdapter {
  readonly key: AiProviderKey;
  complete(req: AiRequest, cfg: AiAdapterConfig): Promise<AiCompletion>;
}

/** The active row, resolved. Internal to src/lib/ai — routes never see apiKey. */
export interface AiActiveSettings {
  provider: AiProviderKey;
  model: string;
  apiKey: string;
}

export type AiErrorKind =
  | "auth" // key rejected — fix it in Settings → AI
  | "rate_limit" // 429 — retryable
  | "overloaded" // 529 / 503 — retryable
  | "network" // no response at all — retryable
  | "invalid_request" // 400 — our request shape is wrong, not retryable
  | "max_tokens" // reply was cut off; the caller must raise maxTokens
  | "refusal" // the model declined
  | "parse" // json: true and the reply was not JSON
  | "unsupported_attachment" // e.g. a PDF sent to a provider whose supports.pdf is false
  | "provider"; // anything else the SDK raised

const RETRYABLE: ReadonlySet<AiErrorKind> = new Set(["rate_limit", "overloaded", "network"]);

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;
  readonly retryable: boolean;
  readonly provider?: AiProviderKey;

  constructor(
    kind: AiErrorKind,
    message: string,
    opts: { status?: number; provider?: AiProviderKey; cause?: unknown; retryable?: boolean } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "AiError";
    this.kind = kind;
    this.status = opts.status;
    this.provider = opts.provider;
    this.retryable = opts.retryable ?? RETRYABLE.has(kind);
  }
}

/**
 * No provider is active, or the active one has no key. A *defined* outcome, not a crash:
 * routes turn it into a 501 pointing at Settings → AI, the way StorageNotConfiguredError
 * points at Settings → Storage.
 */
export class AiNotConfiguredError extends Error {
  readonly purpose?: string;

  constructor(message = "AI is not configured. Set a provider and key at Settings → AI.", purpose?: string) {
    super(message);
    this.name = "AiNotConfiguredError";
    this.purpose = purpose;
  }
}
