// Safe JSON reader for OUTBOUND server-to-third-party calls (Zoho, Zakya, WhatsApp…).
//
// The counterpart to src/lib/api-client.ts, which guards the browser-to-us direction.
//
// Why it exists: `src/lib/zoho.ts` did `const data = await res.json()` with no check beyond
// 401 and 429. Every other failure mode — 500, 502, 504, a maintenance page, a WAF block —
// arrives as HTML, and the resulting SyntaxError was propagated verbatim to the user as
//
//     Unexpected token '<', "<html><hea"... is not valid JSON
//
// That message names the parser, not the fault. Zoho timing out on a 7-day item pull and
// Zoho rejecting our token produced *the same* string. This turns both into a sentence that
// says which host, which status and which endpoint.

import { createLogger } from "@/lib/logger";

const log = createLogger("http:out");

export class UpstreamError extends Error {
  status: number;
  service: string;
  endpoint: string;

  constructor(message: string, opts: { status: number; service: string; endpoint: string }) {
    super(message);
    this.name = "UpstreamError";
    this.status = opts.status;
    this.service = opts.service;
    this.endpoint = opts.endpoint;
  }
}

/**
 * Parse a third-party response as JSON, or throw an error that actually explains itself.
 *
 *     const data = await readJson<ZohoItems>(res, { service: "Zoho Books", endpoint, ms });
 */
export async function readJson<T>(
  res: Response,
  ctx: { service: string; endpoint: string; ms?: number }
): Promise<T> {
  const type = res.headers.get("content-type") || "";

  if (!type.includes("json")) {
    const peek = (await res.text().catch(() => "")).slice(0, 300);
    log.error(`${ctx.service} returned ${type || "no content-type"} instead of JSON`, {
      endpoint: ctx.endpoint,
      status: res.status,
      ms: ctx.ms,
      bodyPreview: peek,
    });

    // 502/503/504 from an API gateway is nearly always "the upstream took too long".
    // Saying so is the difference between a user retrying and a user filing a bug.
    const hint =
      res.status === 504 || res.status === 502 || res.status === 503
        ? `${ctx.service} did not respond in time (${res.status}). Try a shorter date range, or retry in a minute.`
        : res.status >= 500
          ? `${ctx.service} had a server error (${res.status}).`
          : `${ctx.service} replied with a page instead of data (${res.status}).`;

    throw new UpstreamError(hint, {
      status: res.status,
      service: ctx.service,
      endpoint: ctx.endpoint,
    });
  }

  try {
    const parsed = (await res.json()) as T;
    // Success is logged too, at debug. "Zoho returned 200 with 0 items in 12s" is the line
    // that answers "why is my import empty" — an error-only log cannot show it.
    log.debug(
      `<- ${ctx.service} ${ctx.endpoint} ${res.status} (${ctx.ms ?? "?"}ms) ${summarize(parsed)}`
    );
    return parsed;
  } catch {
    log.error(`${ctx.service} sent malformed JSON`, {
      endpoint: ctx.endpoint,
      status: res.status,
      ms: ctx.ms,
    });
    throw new UpstreamError(`${ctx.service} sent a malformed response.`, {
      status: res.status,
      service: ctx.service,
      endpoint: ctx.endpoint,
    });
  }
}

/**
 * One-line shape of a response body — array lengths and top-level keys, never values.
 * Logging the whole payload would flood the console and risks printing customer data;
 * the shape is what actually tells you whether the call did what you expected.
 */
function summarize(value: unknown): string {
  if (value == null) return "(empty)";
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value !== "object") return String(value);

  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj).slice(0, 8)) {
    if (Array.isArray(v)) parts.push(`${k}[${v.length}]`);
    else if (v && typeof v === "object") parts.push(`${k}{}`);
    else if (k === "code" || k === "message") parts.push(`${k}=${String(v).slice(0, 60)}`);
    else parts.push(k);
  }
  return `{${parts.join(" ")}}`;
}
