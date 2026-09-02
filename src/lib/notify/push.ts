// ─── Push sender — FCM HTTP v1 over plain fetch ───────────────────────────────
//
// The ONLY code that talks to Firebase Cloud Messaging. notify() (src/lib/notify/index.ts)
// and the admin's "send test push" route call sendPush / sendTestPush; nothing else does.
//
// No firebase-admin. The Admin SDK drags in gRPC and Google Auth for the two calls made here:
// swap a signed JWT for an OAuth access token at the service account's token_uri, then POST
// one message to messages:send. Both are a `fetch`; the signature is node `crypto`. That is
// why any ROUTE that ends up calling this must declare `export const runtime = "nodejs"` —
// RSA signing does not exist on the Edge runtime (plan D.1).
//
// Credentials come from the NotificationConfig row, read on EVERY send, so pasting a new
// service account into Settings → Notifications takes effect on the next message with no
// redeploy. The one thing held in module scope is the minted access token. That cache is safe
// because it is DERIVED from the config rather than being the config (plan D.1): its key
// carries the key id and a fingerprint of the private key, so a rotated account misses it.
//
// Two kinds of failure, deliberately kept apart (see SendResult / NotConfiguredError in
// ./types.ts):
//   - "there is nothing to send with" → throw NotConfiguredError. notify() writes ONE
//     channel-level SKIPPED row; the test route shows the message as a named failure.
//   - "we tried and Google said no"   → return { ok: false, error }. One FAILED row per
//     recipient, with `deadToken` when FCM says the registration is gone.
//
// Plan: docs/implementation/pending/notifications-and-settings-rbac-plan.md, Part D.

import { createHash, createSign } from "crypto";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { readJson } from "@/lib/http-json";
import {
  NotConfiguredError,
  type PushMessage,
  type PushTarget,
  type SendResult,
} from "./types";

const log = createLogger("notify:push");

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

// The PWA icon from public/manifest.json. Relative on purpose: the service worker resolves it
// against its own origin, so the same payload works on localhost and in production.
// No `badge`: Android renders the badge as a monochrome silhouette, and a full-colour logo
// becomes an unreadable blob there. Add a dedicated white-on-transparent asset if wanted.
const NOTIFICATION_ICON = "/icons/icon-192.png";

// Google refuses `data` keys it uses itself. Silently forwarding one would fail the whole send.
const RESERVED_DATA_KEY = /^(from|notification|message_type|gcm\.|google\.)/;

/** The fields of a Google service-account JSON this module actually uses. */
interface ServiceAccount {
  project_id: string;
  private_key: string;
  private_key_id?: string;
  client_email: string;
  token_uri: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface FcmSendResponse {
  /** "projects/<id>/messages/<message id>" on success. */
  name?: string;
  error?: {
    code?: number;
    message?: string;
    /** gRPC status name: INVALID_ARGUMENT, NOT_FOUND, UNAUTHENTICATED, PERMISSION_DENIED… */
    status?: string;
    details?: Array<{ "@type"?: string; errorCode?: string; [key: string]: unknown }>;
  };
}

/**
 * The last 6 characters of a registration token — enough to recognise a device in a log line
 * or the outbox `target` column, not enough to send to it. The only form of a token that may
 * ever be logged or returned to a browser.
 */
export function tokenTail(token: string): string {
  return token.slice(-6);
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function sendPush(target: PushTarget, msg: PushMessage): Promise<SendResult> {
  const { row, account } = await loadConfig(); // throws NotConfiguredError
  const tail = tokenTail(target.token);

  // The key belongs to exactly one project, so the JSON's project_id is authoritative. A
  // different value typed into the form is a mistake worth surfacing, not a reason to fail.
  if (row.fcmProjectId && row.fcmProjectId !== account.project_id) {
    log.warn("fcmProjectId differs from the service account's project_id — using the account's", {
      configured: row.fcmProjectId,
      serviceAccount: account.project_id,
    });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(account);
  } catch (error) {
    if (error instanceof NotConfiguredError) throw error;
    // Already logged where it happened. Here it becomes an outcome the outbox can record:
    // Google rejecting the grant is a failed send, not an absent configuration.
    return { ok: false, error: errorMessage(error) };
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;
  const message = buildMessage(target, msg);
  const started = Date.now();
  log.debug("-> POST messages:send", { platform: target.platform, tail, hasLink: !!msg.link });

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch (error) {
    log.error("FCM unreachable", {
      platform: target.platform,
      tail,
      error: errorMessage(error),
      ms: Date.now() - started,
    });
    return { ok: false, error: "FCM could not be reached — check outbound network" };
  }
  const ms = Date.now() - started;

  let body: FcmSendResponse;
  try {
    body = await readJson<FcmSendResponse>(res, { service: "FCM", endpoint: "POST messages:send", ms });
  } catch (error) {
    // readJson has already logged host, status and a body preview.
    return { ok: false, error: errorMessage(error) };
  }

  if (res.ok) {
    if (!body.name) log.warn("FCM answered 200 without a message name", { platform: target.platform, tail, ms });
    else log.info("push sent", { platform: target.platform, tail, id: body.name, ms });
    return body.name ? { ok: true, id: body.name } : { ok: true };
  }

  // Google says the bearer is no good. Drop it so the next send mints a fresh one instead of
  // failing the same way for the rest of the cached hour.
  if (res.status === 401) tokenCache.delete(cacheKey(account));

  const errorCode = fcmErrorCode(body.error) ?? body.error?.status ?? "UNKNOWN";
  const detail = sanitize(body.error?.message ?? "no error message", target.token);
  const error = `FCM ${res.status} ${errorCode}: ${detail}`;

  // UNREGISTERED is the clean signal that the device is gone (app uninstalled, permission
  // revoked, token rotated). INVALID_ARGUMENT is broader — a bad payload gets it too — so it
  // only counts as a dead token when Google's message is about the token itself.
  const deadToken =
    (res.status === 404 && errorCode === "UNREGISTERED") ||
    (res.status === 400 && errorCode === "INVALID_ARGUMENT" && /token|registration/i.test(detail));

  if (deadToken) {
    log.warn("push token is dead — caller should delete the device", {
      platform: target.platform,
      tail,
      status: res.status,
      errorCode,
    });
    return { ok: false, error, deadToken: true };
  }

  log.error("push failed", { platform: target.platform, tail, status: res.status, errorCode, ms });
  return { ok: false, error };
}

/** What the "Send test push" button sends. Opens the settings screen it was pressed on. */
export async function sendTestPush(target: PushTarget): Promise<SendResult> {
  return sendPush(target, {
    title: "BCH Ops — test notification",
    body: `Push is working on this device (${new Date().toISOString()})`,
    link: "/settings/notifications",
  });
}

// ─── Configuration ─────────────────────────────────────────────────────────────

const REQUIRED_FIELDS = ["project_id", "private_key", "client_email", "token_uri"] as const;

async function loadConfig() {
  const row = await prisma.notificationConfig.findUnique({ where: { id: "singleton" } });

  if (!row) {
    throw new NotConfiguredError(
      "PUSH",
      "Push is not configured: nothing has been saved in Settings → Notifications yet"
    );
  }
  if (!row.pushEnabled) {
    throw new NotConfiguredError("PUSH", "Push is switched off in Settings → Notifications");
  }
  if (row.pushProvider !== "FCM") {
    throw new NotConfiguredError(
      "PUSH",
      `Push provider "${row.pushProvider}" is not implemented — only FCM sends today`
    );
  }
  if (!row.fcmServiceAccount || !row.fcmServiceAccount.trim()) {
    throw new NotConfiguredError("PUSH", "FCM is not configured: fcmServiceAccount is empty");
  }

  return { row, account: parseServiceAccount(row.fcmServiceAccount) };
}

function parseServiceAccount(raw: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // The length is the one safe fact about the blob: it tells a truncated paste from a typo.
    log.error("fcmServiceAccount is not valid JSON", { error: errorMessage(error), length: raw.length });
    throw new NotConfiguredError(
      "PUSH",
      "FCM service account is not valid JSON — paste the whole file Firebase downloaded"
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new NotConfiguredError("PUSH", "FCM service account must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    const value = obj[field];
    if (typeof value !== "string" || !value.trim()) {
      throw new NotConfiguredError("PUSH", `FCM service account is missing "${field}"`);
    }
  }

  return {
    project_id: obj.project_id as string,
    private_key: obj.private_key as string,
    private_key_id: typeof obj.private_key_id === "string" ? obj.private_key_id : undefined,
    client_email: obj.client_email as string,
    token_uri: obj.token_uri as string,
  };
}

// ─── OAuth — JWT bearer grant ──────────────────────────────────────────────────

interface MintedToken {
  accessToken: string;
  /** Epoch ms, already 60 s before Google's real expiry so an in-flight send never straddles it. */
  expiresAt: number;
}

// Holds the in-flight PROMISE, not just the result, so forty parallel sends at the top of the
// hour mint one token between them rather than forty.
const tokenCache = new Map<string, Promise<MintedToken>>();

function cacheKey(account: ServiceAccount): string {
  // A fingerprint, never the key. Two accounts with the same email and key id but a different
  // private key (a rotation Google did without changing the id) must not share a token.
  const fingerprint = createHash("sha256").update(account.private_key).digest("hex").slice(0, 16);
  return `${account.client_email}|${account.private_key_id ?? ""}|${fingerprint}`;
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const key = cacheKey(account);

  const pending = tokenCache.get(key);
  if (pending) {
    const cached = await pending.catch((error: unknown) => {
      // The earlier mint failed; that failure was logged when it happened. Fall through and
      // try again rather than returning the same rejection to every later send.
      log.debug("cached access-token mint had failed; re-minting", { error: errorMessage(error) });
      return null;
    });
    if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
    tokenCache.delete(key);
  }

  const mint = mintAccessToken(account);
  tokenCache.set(key, mint);
  try {
    return (await mint).accessToken;
  } catch (error) {
    tokenCache.delete(key); // never leave a rejected promise for the next caller to hit
    throw error;
  }
}

async function mintAccessToken(account: ServiceAccount): Promise<MintedToken> {
  const assertion = signJwt(account);
  const started = Date.now();
  log.debug("-> POST token_uri (JWT bearer grant)", { clientEmail: account.client_email });

  let res: Response;
  try {
    res = await fetch(account.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }).toString(),
    });
  } catch (error) {
    log.error("Google OAuth unreachable", { error: errorMessage(error), ms: Date.now() - started });
    throw new Error("Google OAuth could not be reached — check outbound network");
  }
  const ms = Date.now() - started;

  // readJson's debug line prints key NAMES only, so access_token never reaches the log.
  const body = await readJson<OAuthTokenResponse>(res, { service: "Google OAuth", endpoint: "POST token", ms });

  if (!res.ok || !body.access_token) {
    // invalid_grant here almost always means a revoked key or a server clock that is off —
    // the description says which, and neither contains anything sensitive.
    log.error("Google OAuth refused the service account", {
      status: res.status,
      error: body.error,
      description: body.error_description,
      ms,
    });
    const detail = [body.error ?? String(res.status), body.error_description].filter(Boolean).join(": ");
    throw new Error(`Google OAuth ${res.status} ${detail}`);
  }

  const lifetimeMs = (body.expires_in ?? 3600) * 1000;
  log.info("FCM access token minted", { clientEmail: account.client_email, expiresInS: body.expires_in, ms });
  return { accessToken: body.access_token, expiresAt: Date.now() + lifetimeMs - 60_000 };
}

function signJwt(account: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: account.private_key_id }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: FCM_SCOPE,
      aud: account.token_uri,
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claims}`;

  try {
    const signature = createSign("RSA-SHA256").update(unsigned).end().sign(account.private_key);
    return `${unsigned}.${base64url(signature)}`;
  } catch (error) {
    // OpenSSL's message names the defect ("no start line", "unsupported") — never the key.
    // A key that cannot sign is a configuration defect, so this is NotConfigured, not a
    // failed send: one SKIPPED row, and the test button names the field to fix.
    log.error("service-account private_key cannot sign", { error: errorMessage(error) });
    throw new NotConfiguredError(
      "PUSH",
      `FCM service account private_key is not a usable RSA key (${errorMessage(error)})`
    );
  }
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── Message shape ─────────────────────────────────────────────────────────────

function buildMessage(target: PushTarget, msg: PushMessage): Record<string, unknown> {
  const message: Record<string, unknown> = {
    token: target.token,
    notification: { title: msg.title, body: msg.body },
  };

  // `data.link` travels on every platform: public/sw.js reads it on notificationclick and the
  // Expo app routes on it. It is the fallback when fcm_options.link cannot be sent (below).
  const data = stringData(msg.data, msg.link);
  if (data) message.data = data;

  // The platform block is the ONLY thing PushDevice.platform decides (plan D.1). iOS has no
  // branch on purpose — see the PushPlatform enum in prisma/schema.prisma.
  if (target.platform === "WEB") {
    const link = absoluteHttpsLink(msg.link);
    message.webpush = {
      notification: { icon: NOTIFICATION_ICON },
      ...(link ? { fcm_options: { link } } : {}),
    };
  } else {
    message.android = { priority: "high", notification: { channel_id: "default" } };
  }

  return message;
}

/**
 * FCM validates `webpush.fcm_options.link` and refuses anything that is not an https URL — a
 * relative path AND an http://localhost origin both come back as INVALID_ARGUMENT and fail
 * the whole send. So: a relative link is made absolute with NEXTAUTH_URL when that is https;
 * otherwise fcm_options is left out and the service worker opens `data.link` instead, which
 * it resolves against its own origin and which therefore works in development too.
 */
function absoluteHttpsLink(link: string | undefined): string | null {
  if (!link) return null;
  if (/^https:\/\//i.test(link)) return link;
  if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return null; // http:, mailto:, anything else Google rejects

  const base = process.env.NEXTAUTH_URL?.replace(/\/+$/, "");
  if (!base || !/^https:\/\//i.test(base)) return null;
  return `${base}${link.startsWith("/") ? "" : "/"}${link}`;
}

/** FCM `data` must be flat string→string. Coerce, drop Google's reserved keys, add the link. */
function stringData(
  data: Record<string, string> | undefined,
  link: string | undefined
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(data ?? {})) {
    if (RESERVED_DATA_KEY.test(name)) {
      log.warn("dropped a reserved FCM data key from the payload", { name });
      continue;
    }
    out[name] = String(value);
  }
  if (link) out.link = link;
  return Object.keys(out).length > 0 ? out : undefined;
}

// ─── Error plumbing ────────────────────────────────────────────────────────────

/** Google's own error code, from the FcmError detail when present (UNREGISTERED, SENDER_ID_MISMATCH…). */
function fcmErrorCode(error: FcmSendResponse["error"]): string | undefined {
  const detail = error?.details?.find((d) => typeof d.errorCode === "string");
  return detail?.errorCode;
}

/**
 * Make Google's message safe to store and show. Its texts do not normally echo the token, but
 * a validation message can quote the offending field, so the full token is replaced with its
 * tail just in case, and the whole thing is capped so an outbox row stays readable.
 */
function sanitize(message: string, token: string): string {
  return message.split(token).join(`…${tokenTail(token)}`).replace(/\s+/g, " ").trim().slice(0, 300);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
