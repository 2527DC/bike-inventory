// AiError / AiNotConfiguredError → the response a route returns. One place, so every
// AI-backed route says the same thing for the same failure, and the sentence is written for
// the person who reads it in a toast. Logs nothing: the resolver already wrote the error
// line with the purpose, provider, status and attempt count.
import { errorResponse } from "@/lib/api-utils";
import { AiError, AiNotConfiguredError } from "./types";

/** Null when the error is not an AI one — the route falls through to its usual handling. */
export function toAiErrorResponse(error: unknown): Response | null {
  // 501, exactly as StorageNotConfiguredError: the request was fine, the server has no
  // provider set up, and the message already points at Settings → AI.
  if (error instanceof AiNotConfiguredError) return errorResponse(error.message, 501);
  if (!(error instanceof AiError)) return null;

  switch (error.kind) {
    case "auth":
      return errorResponse("The AI provider rejected the API key. Check Settings → AI.", 502);
    case "rate_limit":
    case "overloaded":
      return errorResponse("The AI service is busy. Please try again in a minute.", 503);
    case "network":
      return errorResponse("Could not reach the AI provider. Please try again.", 503);
    case "max_tokens":
      return errorResponse("The AI reply was cut off before it finished. Try a smaller file.", 502);
    case "parse":
      return errorResponse("The AI reply could not be read. Please try again.", 502);
    case "refusal":
      return errorResponse("The AI declined to process this content.", 422);
    case "unsupported_attachment":
      // The adapter's own sentence names the provider and what to do instead.
      return errorResponse(error.message, 400);
    case "invalid_request":
    case "provider":
      return errorResponse("AI processing failed. Please try again.", 502);
  }
}

/** One word for a log line: the AiError kind, "not_configured", or the error's name. */
export function aiErrorKind(error: unknown): string {
  if (error instanceof AiError) return error.kind;
  if (error instanceof AiNotConfiguredError) return "not_configured";
  return error instanceof Error ? error.name : typeof error;
}
