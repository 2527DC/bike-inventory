// Google Gemini adapter, on @google/genai — Google's current SDK. Never a hand-rolled fetch.
//
// One GoogleGenAI client per call, on purpose: the key comes from the AiProvider row and an
// admin can rotate it at any time, so a module-scope client would keep serving a revoked
// key until the next deploy.
//
// Retries belong to the resolver (./index.ts). The SDK's own loop defaults to 5 attempts
// with exponential backoff up to 60 s, which would turn one 429 into five and hide the
// real wait behind a single slow call — so it is switched off here (attempts: 1).
import { ApiError, FinishReason, GoogleGenAI } from "@google/genai";
import type { Candidate, Content, GenerateContentResponse, Part } from "@google/genai";
import { createLogger } from "@/lib/logger";
import { AiError, type AiAdapter, type AiCompletion, type AiErrorKind } from "./types";

const log = createLogger("ai:google");

const DEFAULT_MAX_TOKENS = 16000;

/** Finish reasons that mean the model declined, as opposed to finished or ran out of room. */
const REFUSAL_FINISH: ReadonlySet<FinishReason> = new Set([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.LANGUAGE,
  FinishReason.IMAGE_SAFETY,
]);

/** Looks like the request never got an HTTP answer (DNS, TLS, reset, timeout). */
const NETWORK_MESSAGE = /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|timeout|network/i;

function toStopReason(candidate: Candidate | undefined, blockReason: string | undefined): AiCompletion["stopReason"] {
  // A blocked prompt has no candidates at all — promptFeedback is the only signal.
  if (blockReason) return "refusal";
  const reason = candidate?.finishReason;
  if (reason === FinishReason.STOP) return "end";
  if (reason === FinishReason.MAX_TOKENS) return "max_tokens";
  if (reason && REFUSAL_FINISH.has(reason)) return "refusal";
  return "other";
}

/**
 * The SDK's `text` getter concatenates the first candidate's text parts and skips thought
 * parts. It is undefined when there is no candidate (blocked prompt) — fall back to joining
 * the parts by hand so a partially-populated response still yields whatever text it has.
 */
function textOf(response: GenerateContentResponse): string {
  const aggregated = response.text;
  if (aggregated !== undefined) return aggregated;
  const parts: Part[] = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("");
}

function describe(kind: AiErrorKind, status: number, message: string): string {
  switch (kind) {
    case "auth":
      return "Google rejected the Gemini API key. Fix it at Settings → AI.";
    case "rate_limit":
      return "Google Gemini rate limit hit (429). Try again shortly.";
    case "overloaded":
      return `Google Gemini is unavailable right now (${status}). Try again shortly.`;
    case "invalid_request":
      return `Google Gemini rejected the request (${status}): ${message}`;
    default:
      return `Google Gemini error (${status}): ${message}`;
  }
}

/**
 * The SDK throws ApiError (with a numeric `status`) for any non-2xx answer, and a plain
 * Error / TypeError when the request never got an answer. Gemini reports a bad key as a
 * 400 whose message says "API key not valid", not as a 401 — hence the message check.
 */
function toAiError(err: unknown, model: string): AiError {
  if (err instanceof AiError) return err;

  if (err instanceof ApiError) {
    const status = err.status;
    const message = err.message;
    let kind: AiErrorKind;
    if (status === 401 || status === 403 || (status === 400 && /api key/i.test(message))) kind = "auth";
    else if (status === 400) kind = "invalid_request";
    else if (status === 404) kind = "invalid_request"; // an unknown model id — the catalogue in models.ts is stale
    else if (status === 429) kind = "rate_limit";
    else if (status >= 500) kind = "overloaded";
    else kind = "provider";
    const text = status === 404 ? `${message} (model "${model}" — check the catalogue in models.ts)` : message;
    return new AiError(kind, describe(kind, status, text), { status, provider: "google", cause: err });
  }

  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof TypeError || NETWORK_MESSAGE.test(message)) {
    return new AiError("network", `Google Gemini could not be reached: ${message}`, { provider: "google", cause: err });
  }
  // Something the SDK raised before sending (argument validation, bad base64, ...). Not
  // retryable: the same request will fail the same way.
  return new AiError("provider", `Google Gemini SDK error: ${message}`, { provider: "google", cause: err });
}

export const googleAdapter: AiAdapter = {
  key: "google",

  async complete(req, cfg) {
    const ai = new GoogleGenAI({
      apiKey: cfg.apiKey,
      httpOptions: { retryOptions: { attempts: 1 } }, // 0 or 1 = no retries; the resolver retries
    });

    const attachments = req.attachments ?? [];
    // Gemini takes an inline PDF exactly like an inline image: inlineData with the mime type.
    const parts: Part[] = [
      ...attachments.map((a): Part => ({ inlineData: { mimeType: a.mediaType, data: a.base64 } })),
      { text: req.prompt },
    ];
    const contents: Content[] = [{ role: "user", parts }];
    const maxOut = req.maxTokens ?? DEFAULT_MAX_TOKENS;

    // Context keys deliberately avoid "token"/"key" — redact() blanks those names.
    const ctx = {
      purpose: req.purpose,
      model: cfg.model,
      attachments: attachments.length,
      promptChars: req.prompt.length,
      hasSystem: Boolean(req.system),
      maxOut,
      hasSchema: Boolean(req.jsonSchema),
    };
    log.debug("-> models.generateContent", ctx);

    const started = Date.now();
    let response: GenerateContentResponse;
    try {
      response = await ai.models.generateContent({
        model: cfg.model,
        contents,
        config: {
          ...(req.system ? { systemInstruction: req.system } : {}),
          maxOutputTokens: maxOut,
          // Gemini's native JSON mode: the reply is guaranteed to parse, so the resolver's
          // fence-stripping becomes a no-op instead of a rescue. A schema goes as
          // `responseJsonSchema` (GenerateContentConfig, @google/genai 2.21 — plain JSON
          // Schema, and `responseMimeType` is required beside it). `effort` has no Gemini
          // equivalent and is ignored here.
          ...(req.json || req.jsonSchema ? { responseMimeType: "application/json" } : {}),
          ...(req.jsonSchema ? { responseJsonSchema: req.jsonSchema } : {}),
        },
      });
    } catch (err) {
      const aiErr = toAiError(err, cfg.model);
      log.error("models.generateContent failed", {
        purpose: req.purpose,
        model: cfg.model,
        kind: aiErr.kind,
        status: aiErr.status,
        ms: Date.now() - started,
        message: aiErr.message,
      });
      throw aiErr;
    }

    const candidate = response.candidates?.[0];
    const blockReason = response.promptFeedback?.blockReason;
    const stopReason = toStopReason(candidate, blockReason);
    const rawStopReason = blockReason ? `blocked:${blockReason}` : (candidate?.finishReason ?? null);
    const usage = {
      input: response.usageMetadata?.promptTokenCount ?? 0,
      output: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
    const text = textOf(response);

    log.debug("<- models.generateContent", {
      purpose: req.purpose,
      model: cfg.model,
      ms: Date.now() - started,
      stopReason,
      rawStopReason,
      textChars: text.length,
      usageIn: usage.input,
      usageOut: usage.output,
      thoughtsOut: response.usageMetadata?.thoughtsTokenCount ?? 0,
    });

    return { text, usage, stopReason, rawStopReason };
  },
};
