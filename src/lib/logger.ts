// ─── Leveled logger ──────────────────────────────────────────────────────────
// One logger for both sides of the app. Server code and client code import the same
// `log`; only the threshold source differs.
//
// WHY THIS EXISTS
// ---------------
// The bug that prompted it: fetching 7 days of stock from Zoho surfaced
//
//     Unexpected token '<', "<html><hea"... is not valid JSON
//
// which is not an error — it is the *absence* of one. Something upstream answered with an
// HTML page instead of JSON, `res.json()` choked on the first character, and the real
// failure (which host, which status, which endpoint) was never recorded anywhere. With
// request/response logging the same incident reads as "GET zohoapis.in/items -> 504
// text/html in 28s" and needs no guessing.
//
// THRESHOLD
// ---------
// Set a NUMBER in the environment. Anything at or above the threshold is printed.
//
//     LOG_LEVEL=0   debug  — every request, response, timing and payload size
//     LOG_LEVEL=1   info   — lifecycle: sync started, 42 items imported          (default dev)
//     LOG_LEVEL=2   warn   — recoverable: retry, slow response, empty result     (default prod)
//     LOG_LEVEL=3   error  — the operation failed
//     LOG_LEVEL=4   silent — nothing
//
// Two variables, because a server-only variable is not readable in the browser:
//
//     LOG_LEVEL              server (route handlers, lib code, scripts)
//     NEXT_PUBLIC_LOG_LEVEL  browser (pages, components) — MUST carry the NEXT_PUBLIC_
//                            prefix or Next strips it from the client bundle
//
// Never log a credential. `redact()` below strips the obvious keys, but the real rule is
// to pass context objects you have chosen deliberately, not whole request bodies.

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const isServer = typeof window === "undefined";

function resolveThreshold(): number {
  const raw = isServer
    ? process.env.LOG_LEVEL
    : process.env.NEXT_PUBLIC_LOG_LEVEL;

  if (raw != null && raw !== "") {
    // Accept both "2" and "warn" so a .env written either way behaves.
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n < LOG_LEVELS.length) return n;
    const byName = LOG_LEVELS.indexOf(raw.toLowerCase() as LogLevel);
    if (byName !== -1) return byName;
  }
  // Unset: chatty in development, quiet in production. Production still keeps warn+error,
  // because a log threshold that hides failures is worse than no logging at all.
  return process.env.NODE_ENV === "production" ? 2 : 1;
}

// Resolved once per process/page-load. Changing the env var needs a restart, which is
// deliberate: re-reading it on every call would make hot paths measurably slower.
const THRESHOLD = resolveThreshold();

/** Is this level currently enabled? Use to skip building an expensive context object. */
export function isEnabled(level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= THRESHOLD;
}

const SECRET_KEY = /(pass|secret|token|key|auth|cookie|credential|accesscode|otp)/i;

/** Shallow-redact obvious secrets and truncate anything long enough to flood the console. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value.length > 500 ? value.slice(0, 500) + "…" : value;
  if (typeof value !== "object") return value;
  if (depth > 3) return "[deep]";

  if (Array.isArray(value)) {
    const head = value.slice(0, 20).map((v) => redact(v, depth + 1));
    return value.length > 20 ? [...head, `…+${value.length - 20} more`] : head;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

const CONSOLE: Record<Exclude<LogLevel, "silent">, (...a: unknown[]) => void> = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function emit(level: Exclude<LogLevel, "silent">, scope: string, msg: string, ctx?: unknown) {
  if (!isEnabled(level)) return;
  const stamp = new Date().toISOString();
  const where = isServer ? "server" : "client";
  const head = `${stamp} ${level.toUpperCase().padEnd(5)} [${where}:${scope}] ${msg}`;
  if (ctx === undefined) CONSOLE[level](head);
  else CONSOLE[level](head, redact(ctx));
}

export interface Logger {
  debug(msg: string, ctx?: unknown): void;
  info(msg: string, ctx?: unknown): void;
  warn(msg: string, ctx?: unknown): void;
  error(msg: string, ctx?: unknown): void;
  /** Narrow a logger to a sub-scope: log.scope("zoho").scope("items") -> "zoho:items". */
  scope(child: string): Logger;
}

/**
 * Create a scoped logger. The scope shows in every line, so grep-ing one subsystem out of a
 * busy log is a single search.
 *
 *     const log = createLogger("zoho:items");
 *     log.info("pull started", { fromDate, days: 7 });
 */
export function createLogger(scope: string): Logger {
  return {
    debug: (m, c) => emit("debug", scope, m, c),
    info: (m, c) => emit("info", scope, m, c),
    warn: (m, c) => emit("warn", scope, m, c),
    error: (m, c) => emit("error", scope, m, c),
    scope: (child) => createLogger(`${scope}:${child}`),
  };
}

/** Default logger for code that has not picked a scope yet. Prefer createLogger(). */
export const log = createLogger("app");

/** The active threshold, for a health endpoint or a debug banner. */
export const currentLevel: LogLevel = LOG_LEVELS[THRESHOLD];
