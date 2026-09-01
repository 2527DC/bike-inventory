"use client";

// ─── The one way the browser talks to our API ────────────────────────────────
//
// Replaces the `fetch(url).then(r => r.json())` pattern repeated across the app, which has
// a specific failure this module exists to remove.
//
// THE BUG IT FIXES
// ----------------
// `res.json()` assumes the body is JSON. Three things routinely make it HTML instead:
//
//   1. The session expired. `middleware.ts` answers a protected route with 307 -> /login.
//      fetch FOLLOWS redirects, so the browser receives the login PAGE with status 200.
//      `res.ok` is true, every status check passes, and `.json()` dies on "<!DOCTYPE".
//      Verified on this app: POST /api/zoho/trigger-pull with no cookie ->
//      307 -> /login -> 200 text/html.
//
//   2. An upstream gateway timed out. Zoho's own error pages are bare `<html><head>…`,
//      which is exactly the "<html><hea" seen in the stock-fetch report.
//
//   3. The route crashed and the framework rendered an error page.
//
// In all three the user was shown `Unexpected token '<', "<html><hea"... is not valid JSON`
// — a message that names the symptom and hides the cause. Here the content-type is checked
// BEFORE parsing, so the thrown error says which of the three actually happened.

import { createLogger } from "@/lib/logger";

const log = createLogger("http");

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
  /**
   * Present only on responses built by `paginatedResponse` (src/lib/api-utils.ts). It sits
   * BESIDE `data`, not inside it, which is why `apiFetch` — which returns `data` — cannot
   * see it. Callers that need the page block use `apiFetchEnvelope` below.
   */
  pagination?: PageMeta;
}

/** The block `paginatedResponse` attaches. Shape is fixed by src/lib/api-utils.ts. */
export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

/** Thrown for any non-success outcome. Carries enough to log or branch on. */
export class ApiError extends Error {
  status: number;
  url: string;
  /** True when the failure was an expired/absent session rather than a real fault. */
  isAuth: boolean;

  constructor(message: string, opts: { status: number; url: string; isAuth?: boolean }) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status;
    this.url = opts.url;
    this.isAuth = opts.isAuth ?? false;
  }
}

let requestSeq = 0;

/**
 * Call an internal API route and return `data` from the success envelope.
 *
 *     const rows = await apiFetch<StockRow[]>("/api/stock");
 *     await apiFetch("/api/zoho/trigger-pull", { method: "POST", json: { step: "init" } });
 *
 * Throws ApiError on any failure — including the HTML cases above — so callers use
 * try/catch instead of hand-checking `res.ok` and `res.success` at every call site.
 */
export async function apiFetch<T = unknown>(
  url: string,
  init: (Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit | null }) = {}
): Promise<T> {
  return (await apiFetchEnvelope<T>(url, init)).data;
}

/**
 * As `apiFetch`, but returns the WHOLE envelope instead of just `data`.
 *
 * Exists because `paginatedResponse` puts its page block beside `data`, so a list screen that
 * needs `total` / `totalPages` cannot get them from `apiFetch`. Before this, the only way was
 * to hand-roll `fetch` in the page and re-implement the HTML guard badly — which is the exact
 * thing CLAUDE.md bans and this module exists to prevent.
 *
 *     const { data, pagination } = await apiFetchEnvelope<TeamUser[]>("/api/users?page=2");
 */
export async function apiFetchEnvelope<T = unknown>(
  url: string,
  init: (Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit | null }) = {}
): Promise<ApiEnvelope<T>> {
  const id = ++requestSeq;
  const method = (init.method || "GET").toUpperCase();
  const started = Date.now();

  const { json, ...rest } = init;
  const options: RequestInit = { ...rest };
  if (json !== undefined) {
    options.method = method;
    options.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
    options.body = JSON.stringify(json);
  }

  log.debug(`#${id} -> ${method} ${url}`, json !== undefined ? { body: json } : undefined);

  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (e) {
    // Network-level: offline, DNS, connection reset. No response object exists.
    const msg = e instanceof Error ? e.message : "Network request failed";
    log.error(`#${id} xx ${method} ${url} — network failure`, { error: msg });
    throw new ApiError(`Cannot reach the server. Check your connection.`, { status: 0, url });
  }

  const ms = Date.now() - started;
  const type = res.headers.get("content-type") || "";
  const isJson = type.includes("application/json");

  // --- The HTML guard. Runs BEFORE any parse attempt. ---
  if (!isJson) {
    const peek = (await res.text().catch(() => "")).slice(0, 200);
    const looksLikeLogin = res.redirected
      ? res.url.includes("/login")
      : /login|sign in/i.test(peek);

    if (looksLikeLogin || res.status === 401 || res.status === 403) {
      log.warn(`#${id} <- ${method} ${url} — session expired (${res.status}, ${ms}ms)`, {
        redirectedTo: res.redirected ? res.url : undefined,
      });
      throw new ApiError("Your session has expired. Please sign in again.", {
        status: res.status,
        url,
        isAuth: true,
      });
    }

    log.error(`#${id} <- ${method} ${url} — expected JSON, got ${type || "unknown"} (${res.status}, ${ms}ms)`, {
      status: res.status,
      contentType: type,
      bodyPreview: peek,
    });
    throw new ApiError(
      res.status >= 500
        ? `The server failed while handling this request (${res.status}). It returned a page instead of data — usually a timeout or a crash.`
        : `Unexpected ${res.status} response from ${url}.`,
      { status: res.status, url }
    );
  }

  let payload: ApiEnvelope<T>;
  try {
    payload = (await res.json()) as ApiEnvelope<T>;
  } catch {
    log.error(`#${id} <- ${method} ${url} — malformed JSON (${res.status}, ${ms}ms)`);
    throw new ApiError("The server sent a malformed response.", { status: res.status, url });
  }

  if (!res.ok || payload?.success === false) {
    const msg = payload?.error || `Request failed (${res.status})`;
    log.warn(`#${id} <- ${method} ${url} — ${res.status} ${msg} (${ms}ms)`);
    throw new ApiError(msg, { status: res.status, url, isAuth: res.status === 401 });
  }

  log.debug(`#${id} <- ${method} ${url} — ${res.status} ok (${ms}ms)`);
  return payload;
}

/**
 * Non-throwing variant, for call sites that render an inline error instead of a toast.
 *
 *     const { data, error } = await apiTry<StockRow[]>("/api/stock");
 */
export async function apiTry<T = unknown>(
  url: string,
  init?: Parameters<typeof apiFetch>[1]
): Promise<{ data: T | null; error: string | null; isAuth: boolean }> {
  try {
    return { data: await apiFetch<T>(url, init), error: null, isAuth: false };
  } catch (e) {
    const err = e instanceof ApiError ? e : null;
    return {
      data: null,
      error: e instanceof Error ? e.message : "Request failed",
      isAuth: err?.isAuth ?? false,
    };
  }
}
