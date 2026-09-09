// The Anthropic adapter. One AiRequest in, one Messages API call over the official SDK,
// one normalised AiCompletion out. Every SDK failure leaves here as an AiError whose `kind`
// tells the resolver whether to retry and tells the route what to say.
import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "@/lib/logger";
import {
  AiError,
  type AiAdapter,
  type AiAdapterConfig,
  type AiAttachment,
  type AiCompletion,
  type AiRequest,
} from "./types";

const log = createLogger("ai:anthropic");

// Matches the default documented on AiRequest.maxTokens. Never lowball it: a truncated JSON
// array is worse than a slow one, and the resolver refuses a max_tokens stop anyway.
const DEFAULT_MAX_TOKENS = 16_000;

type ImageMediaType = Anthropic.Base64ImageSource["media_type"];
const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function isImageMediaType(v: string): v is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(v);
}

function toBlock(a: AiAttachment): Anthropic.ContentBlockParam {
  if (a.kind === "pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: a.base64 },
      title: a.fileName,
    };
  }
  // The API only takes these four. Anything else would come back as a 400 that the route
  // reports as "AI processing failed" — refusing it here names the real problem instead.
  if (!isImageMediaType(a.mediaType)) {
    throw new AiError(
      "unsupported_attachment",
      `Anthropic cannot read images of type "${a.mediaType}". Upload a PNG, JPEG, WebP or GIF.`,
      { provider: "anthropic" },
    );
  }
  return { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.base64 } };
}

function normaliseStop(raw: Anthropic.StopReason | null): AiCompletion["stopReason"] {
  switch (raw) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

/**
 * SDK error → AiError, most specific class first. The SDK's messages are safe to keep —
 * they name the status and the API's own error type, never the key.
 */
function toAiError(error: unknown, model: string): AiError {
  if (error instanceof AiError) return error;
  const opts = { provider: "anthropic" as const, cause: error };

  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiError("auth", error.message, { ...opts, status: error.status });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError("rate_limit", error.message, { ...opts, status: error.status });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AiError("invalid_request", error.message, { ...opts, status: error.status });
  }
  // 404 is an unknown model id — the catalogue in models.ts is stale, not the request.
  if (error instanceof Anthropic.NotFoundError) {
    return new AiError(
      "invalid_request",
      `${error.message} (model "${model}" — check the catalogue in models.ts)`,
      { ...opts, status: error.status },
    );
  }
  // No response at all: DNS, TLS, a dropped socket, a timeout. `status` is undefined here,
  // which is why this sits before the generic APIError branch.
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError("network", error.message, opts);
  }
  if (error instanceof Anthropic.APIError) {
    // 529 is Anthropic's "overloaded"; 503 and the rest of 5xx mean the same thing to us.
    const status = error.status;
    if (status !== undefined && status >= 500) {
      return new AiError("overloaded", error.message, { ...opts, status });
    }
    return new AiError("provider", error.message, { ...opts, status });
  }
  return new AiError("provider", error instanceof Error ? error.message : String(error), opts);
}

export const anthropicAdapter: AiAdapter = {
  key: "anthropic",

  async complete(req: AiRequest, cfg: AiAdapterConfig): Promise<AiCompletion> {
    // A new client per call, on purpose. The key is a database value an admin can rotate
    // from Settings → AI at any moment, and a module-scope client would keep the old one
    // until the next deploy. maxRetries: 0 because the resolver owns the one retry policy;
    // a second one in here would multiply it.
    const client = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 0 });
    const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;

    try {
      const content: Anthropic.ContentBlockParam[] = [
        ...(req.attachments ?? []).map(toBlock),
        { type: "text", text: req.prompt },
      ];

      // Context keys deliberately avoid `token`/`key` — logger.ts redact() blanks those names.
      log.debug("-> messages.stream", { model: cfg.model, blocks: content.length, maxOut: maxTokens });

      // Streamed not for progress — nobody watches this — but because a 16k-token reply over
      // a plain request can outlive the HTTP timeout. No `thinking` and no `temperature`:
      // Opus 5 and Sonnet 5 run adaptive thinking by default and Haiku 4.5 rejects
      // `adaptive`, so leaving both out is the one shape every model in models.ts accepts.
      const message = await client.messages
        .stream({
          model: cfg.model,
          max_tokens: maxTokens,
          system: req.system,
          messages: [{ role: "user", content }],
        })
        .finalMessage();

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      log.debug("<- messages.stream", {
        model: message.model,
        stopReason: message.stop_reason,
        usageIn: message.usage.input_tokens,
        usageOut: message.usage.output_tokens,
        textChars: text.length,
      });

      return {
        text,
        usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
        stopReason: normaliseStop(message.stop_reason),
        rawStopReason: message.stop_reason,
      };
    } catch (error) {
      const aiError = toAiError(error, cfg.model);
      log.error("messages.stream failed", {
        model: cfg.model,
        kind: aiError.kind,
        status: aiError.status,
        error: aiError.message,
      });
      throw aiError;
    }
  },
};
