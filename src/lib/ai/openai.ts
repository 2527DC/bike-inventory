// OpenAI adapter, on the official `openai` SDK. Never a hand-rolled fetch.
//
// It uses the Responses API (client.responses.create), not chat completions: Responses is
// the endpoint that accepts an inline base64 PDF as an `input_file` part, and a bank
// statement is a PDF. Chat completions would need a prior file upload.
//
// One client per call, on purpose: the key comes from the AiProvider row and an admin can
// rotate it at any time. maxRetries is 0 because the resolver (./index.ts) owns retries.
import OpenAI from "openai";
import { createLogger } from "@/lib/logger";
import { AiError, type AiAdapter, type AiCompletion, type AiErrorKind, type AiRequest } from "./types";

const log = createLogger("ai:openai");

const DEFAULT_MAX_TOKENS = 16000;

type InputContent = OpenAI.Responses.ResponseInputContent;
type ResponsesResult = OpenAI.Responses.Response;

/** Looks like the request never got an HTTP answer (DNS, TLS, reset, timeout). */
const NETWORK_MESSAGE = /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|timeout|network/i;

function toContent(req: AiRequest): InputContent[] {
  const parts: InputContent[] = [];
  for (const a of req.attachments ?? []) {
    if (a.kind === "pdf") {
      parts.push({
        type: "input_file",
        filename: a.fileName ?? "document.pdf",
        file_data: `data:application/pdf;base64,${a.base64}`,
      });
    } else {
      parts.push({
        type: "input_image",
        image_url: `data:${a.mediaType};base64,${a.base64}`,
        detail: "auto",
      });
    }
  }
  parts.push({ type: "input_text", text: req.prompt });
  return parts;
}

/** A `refusal` content part inside any message output item. */
function hasRefusal(output: ResponsesResult["output"]): boolean {
  return output.some((item) => item.type === "message" && item.content.some((c) => c.type === "refusal"));
}

function toStopReason(res: ResponsesResult): Pick<AiCompletion, "stopReason" | "rawStopReason"> {
  const reason = res.incomplete_details?.reason;
  const refused = hasRefusal(res.output);
  const rawStopReason = [res.status, reason, refused ? "refusal" : undefined].filter(Boolean).join(":") || null;

  let stopReason: AiCompletion["stopReason"];
  if (res.status === "incomplete" && reason === "max_output_tokens") stopReason = "max_tokens";
  else if (reason === "content_filter" || refused) stopReason = "refusal";
  else if (res.status === "completed") stopReason = "end";
  else stopReason = "other";

  return { stopReason, rawStopReason };
}

function describe(kind: AiErrorKind, status: number | undefined, message: string): string {
  switch (kind) {
    case "auth":
      return "OpenAI rejected the API key. Fix it at Settings → AI.";
    case "rate_limit":
      return "OpenAI rate limit hit (429). Try again shortly.";
    case "overloaded":
      return `OpenAI is unavailable right now (${status}). Try again shortly.`;
    case "invalid_request":
      return `OpenAI rejected the request (${status}): ${message}`;
    case "network":
      return `OpenAI could not be reached: ${message}`;
    default:
      return `OpenAI error (${status ?? "no status"}): ${message}`;
  }
}

/**
 * The SDK throws typed subclasses of OpenAI.APIError, each pinned to a status:
 * AuthenticationError 401, PermissionDeniedError 403, BadRequestError 400, RateLimitError
 * 429, InternalServerError >= 500. APIConnectionError has no status — nothing answered.
 * Matching on the class first and the numeric status second means a status the SDK has
 * no class for (e.g. 404 for an unknown model id) still lands in a sensible kind.
 */
function toAiError(err: unknown, model: string): AiError {
  if (err instanceof AiError) return err;

  if (err instanceof OpenAI.APIUserAbortError) {
    return new AiError("provider", "OpenAI request was aborted.", { provider: "openai", cause: err, retryable: false });
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new AiError("network", describe("network", undefined, err.message), { provider: "openai", cause: err });
  }
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    const message = err.message;
    let kind: AiErrorKind;
    if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) kind = "auth";
    else if (err instanceof OpenAI.RateLimitError) kind = "rate_limit";
    else if (err instanceof OpenAI.InternalServerError) kind = "overloaded";
    else if (err instanceof OpenAI.BadRequestError) kind = "invalid_request";
    else if (status === 401 || status === 403) kind = "auth";
    else if (status === 429) kind = "rate_limit";
    else if (status !== undefined && status >= 500) kind = "overloaded";
    else if (status === 400) kind = "invalid_request";
    else if (status === 404) kind = "invalid_request"; // an unknown model id — the catalogue in models.ts is stale
    else if (status === undefined) kind = "network";
    else kind = "provider";
    const text = status === 404 ? `${message} (model "${model}" — check the catalogue in models.ts)` : message;
    return new AiError(kind, describe(kind, status, text), { status, provider: "openai", cause: err });
  }

  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof TypeError || NETWORK_MESSAGE.test(message)) {
    return new AiError("network", describe("network", undefined, message), { provider: "openai", cause: err });
  }
  // Something the SDK raised before sending (argument validation, bad base64, ...). Not
  // retryable: the same request will fail the same way.
  return new AiError("provider", `OpenAI SDK error: ${message}`, { provider: "openai", cause: err });
}

export const openaiAdapter: AiAdapter = {
  key: "openai",

  async complete(req, cfg) {
    const client = new OpenAI({ apiKey: cfg.apiKey, maxRetries: 0 });

    const attachments = req.attachments ?? [];
    const content = toContent(req);
    const maxOut = req.maxTokens ?? DEFAULT_MAX_TOKENS;

    // Context keys deliberately avoid "token"/"key" — redact() blanks those names.
    const ctx = {
      purpose: req.purpose,
      model: cfg.model,
      attachments: attachments.length,
      promptChars: req.prompt.length,
      hasSystem: Boolean(req.system),
      maxOut,
      // A jsonSchema is not sent to OpenAI: this adapter keeps the prompt path and the
      // resolver's json.ts salvage, so the prompt itself must describe the shape. Logged so
      // a schema-shaped call is recognisable in the log next to the other providers'.
      hasSchema: Boolean(req.jsonSchema),
    };
    log.debug("-> responses.create", ctx);

    const started = Date.now();
    let res: ResponsesResult;
    try {
      // No `temperature`: the GPT-5 family rejects it with a 400.
      res = await client.responses.create({
        model: cfg.model,
        input: [{ role: "user", content }],
        ...(req.system ? { instructions: req.system } : {}),
        max_output_tokens: maxOut,
      });
    } catch (err) {
      const aiErr = toAiError(err, cfg.model);
      log.error("responses.create failed", {
        purpose: req.purpose,
        model: cfg.model,
        kind: aiErr.kind,
        status: aiErr.status,
        ms: Date.now() - started,
        message: aiErr.message,
      });
      throw aiErr;
    }

    // A 200 whose body says the model failed. Returning "" with stopReason "other" would
    // surface later as a parse error and hide the real cause, so it is a failure here.
    if (res.status === "failed") {
      const code = res.error?.code ?? "unknown";
      const aiErr = new AiError("provider", `OpenAI response failed (${code}): ${res.error?.message ?? "no message"}`, {
        provider: "openai",
        retryable: code === "server_error" || code === "rate_limit_exceeded",
      });
      log.error("responses.create returned status=failed", {
        purpose: req.purpose,
        model: cfg.model,
        code,
        ms: Date.now() - started,
        message: aiErr.message,
      });
      throw aiErr;
    }

    const { stopReason, rawStopReason } = toStopReason(res);
    const usage = {
      input: res.usage?.input_tokens ?? 0,
      output: res.usage?.output_tokens ?? 0,
    };
    const text = res.output_text;

    log.debug("<- responses.create", {
      purpose: req.purpose,
      model: cfg.model,
      ms: Date.now() - started,
      stopReason,
      rawStopReason,
      textChars: text.length,
      usageIn: usage.input,
      usageOut: usage.output,
      reasoningOut: res.usage?.output_tokens_details?.reasoning_tokens ?? 0,
    });

    return { text, usage, stopReason, rawStopReason };
  },
};
