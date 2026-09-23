// ─── Shared contracts for the notification subsystem ──────────────────────────
//
// Every module under src/lib/notify and every route under src/app/api/notifications codes
// against THIS file, so the pieces can be written independently and still fit. Change a
// shape here and grep for its name before assuming anything still compiles.
//
// Plan: docs/implementation/pending/notifications-and-settings-rbac-plan.md.

import type { EventKey } from "./events";

// ─── Channels ─────────────────────────────────────────────────────────────────
// Kept as string unions here so client components can import this file without pulling
// @prisma/client into the browser bundle.
//
// `Channel` is a configured SERVICE — the settings screen's two tabs, the test send and
// NotConfiguredError. EMAIL is still one: SMTP sends purchase orders to vendors. It is NOT a
// notification channel (owner, 23 Sep 2026, plan 2309): `OutboxChannel` mirrors the Prisma
// enum NotificationChannel, which is PUSH only.
export type Channel = "PUSH" | "EMAIL";
export type OutboxChannel = "PUSH";
export type OutboxStatus = "SENT" | "FAILED" | "SKIPPED";
export type PushPlatformKey = "WEB" | "ANDROID";

// ─── notify() — the one entry point (src/lib/notify/index.ts) ─────────────────

export interface NotifyInput {
  /**
   * User ids, ALREADY filtered by the caller: the actor removed, inactive users removed.
   * notify() does not know who triggered the event and does not second-guess this list.
   */
  recipients: string[];
  /** Notification title — one short line. */
  title: string;
  /** Body — a sentence or two. Plain text; push and the /notifications inbox show it as is. */
  body: string;
  /** The record this is about: productId, jobId, shipmentId, SyncLog id. Written to the outbox. */
  refId?: string;
  /** Relative URL to open on tap / in the email. e.g. "/stock/abc123". */
  link?: string;
  /** Extra key/value data for the push payload. FCM requires string values. */
  data?: Record<string, string>;
  /**
   * Buttons on the notification itself (plan 1709 §3.8, R24 / Q19). Optional everywhere: a
   * caller that omits it gets exactly the notification it got before.
   *
   * At most TWO are shown — see `PushAction`. The body of the notification is always the
   * "just open it" path, so an action is never the only way to act on the message.
   */
  actions?: PushAction[];
}

export interface NotifyOutcome {
  eventKey: EventKey;
  /** Rows written to NotificationOutbox, by status. */
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * RULE (plan §F.0): notify() is called AFTER the surrounding prisma.$transaction has
 * committed, never inside it. It never throws into its caller — every failure is logged
 * and recorded as a FAILED or SKIPPED outbox row.
 */
export type NotifyFn = (eventKey: EventKey, input: NotifyInput) => Promise<NotifyOutcome>;

// ─── Senders (src/lib/notify/email.ts, src/lib/notify/push.ts) ────────────────

export type SendResult =
  | { ok: true; /** provider message id / FCM message name, for the log line */ id?: string }
  | {
      ok: false;
      /** Human-readable, safe to store in NotificationOutbox.error and to show an admin. NEVER contains a credential. */
      error: string;
      /** Push only: FCM said the token is UNREGISTERED / INVALID_ARGUMENT — delete the PushDevice row. */
      deadToken?: boolean;
    };

export interface EmailRecipient {
  email: string;
  name?: string;
}

/** One file on an outgoing email. `content` is the bytes, never a path. */
export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailMessage {
  subject: string;
  text: string;
  /** Optional; when absent the sender wraps `text` in a minimal HTML template. */
  html?: string;
  /**
   * Files to attach. Nothing in this app attached one before the purchase-order email, so
   * treat this as new ground rather than a well-worn path.
   *
   * ⚠ SIZE. The SMTP transport is built per call with `socketTimeout: 30_000` and no pooling,
   * so a large attachment on a slow uplink dies at THIRTY seconds — not at a route's
   * `maxDuration`. Worse, it surfaces as ESOCKET, which `describeSmtpError` reports as
   * "Could not connect… check host, port and the secure setting" — a misleading sentence for a
   * transfer that timed out mid-DATA. Keep attachments small; a purchase-order PDF is ~90 KB.
   */
  attachments?: EmailAttachment[];
  /** Copied recipients. One address, because that is all the send sheet offers. */
  cc?: string;
  /**
   * Where a reply should go. Without it a vendor replying to a purchase order writes back to
   * the SMTP account, which may be a mailbox nobody reads.
   */
  replyTo?: string;
}

export interface PushTarget {
  token: string;
  platform: PushPlatformKey;
}

/**
 * One button on a notification (plan 1709 §3.8).
 *
 * `action` is the id the service worker reads back as `event.action` on notificationclick, so
 * it is a stable code word ("approve", "reject") and NOT display text. `title` is what the
 * person reads.
 *
 * **Two, and only two.** Chrome on Android shows two; desktop Chrome shows two; Firefox two.
 * Anything beyond is silently dropped by the browser, and a button that exists in the payload
 * but not on screen is a feature nobody can find. `normaliseActions` in push.ts caps the list
 * rather than trusting callers to count.
 *
 * **They are a shortcut, never the only route.** iOS Safari ignores `actions` entirely (Q19),
 * so every notification carrying them must still do the right thing when the body is tapped —
 * which for approvals means opening `link`.
 */
export interface PushAction {
  action: string;
  title: string;
}

/** The most buttons any target browser renders. See `PushAction`. */
export const MAX_PUSH_ACTIONS = 2;

export interface PushMessage {
  title: string;
  body: string;
  /** Relative URL opened on notificationclick. Becomes webpush.fcm_options.link / data.link. */
  link?: string;
  data?: Record<string, string>;
  /** Buttons. See `PushAction` — capped at `MAX_PUSH_ACTIONS`, mirrored into `data.actions`. */
  actions?: PushAction[];
}

/**
 * Thrown by a sender when its service has no usable configuration (no SMTP host, empty
 * fcmServiceAccount...). For push, notify() catches it and writes ONE channel-level SKIPPED
 * outbox row (userId and target null) rather than one per recipient. For SMTP, the PO send
 * route and the test route surface `message` as a named failure — never a 500.
 */
export class NotConfiguredError extends Error {
  channel: Channel;
  constructor(channel: Channel, message: string) {
    super(message);
    this.name = "NotConfiguredError";
    this.channel = channel;
  }
}

// ─── API payload shapes — what the routes return and the screens consume ──────

/** GET /api/notifications/config — secrets MASKED, never the real value. */
export interface NotificationConfigView {
  email: {
    provider: string;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpSecure: boolean;
    smtpUser: string | null;
    /** "••••••••" when a password is stored, null when none. Never the value. */
    smtpPasswordMasked: string | null;
    fromName: string | null;
    fromEmail: string | null;
    // No `enabled`: SMTP has no on/off switch (plan 2309). It is ready when the fields are set.
    connected: boolean;
    lastTestedAt: string | null;
    lastTestError: string | null;
  };
  push: {
    provider: string;
    projectId: string | null;
    /** "configured (client_email …@…)" when JSON is stored, null when none. Never the JSON. */
    serviceAccountMasked: string | null;
    webApiKey: string | null;
    messagingSenderId: string | null;
    webAppId: string | null;
    vapidKey: string | null;
    enabled: boolean;
    connected: boolean;
    lastTestedAt: string | null;
    lastTestError: string | null;
  };
  /** null until the singleton row has been saved for the first time. */
  updatedAt: string | null;
}

/**
 * PUT /api/notifications/config — partial. A secret field that is ABSENT or an empty string
 * leaves the stored value untouched (so re-saving the form does not wipe a password the
 * browser never had). Send a value to replace it.
 */
export interface NotificationConfigUpdate {
  email?: Partial<{
    provider: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPassword: string;
    fromName: string;
    fromEmail: string;
  }>;
  push?: Partial<{
    provider: string;
    projectId: string;
    serviceAccountJson: string;
    webApiKey: string;
    messagingSenderId: string;
    webAppId: string;
    vapidKey: string;
    enabled: boolean;
  }>;
}

/**
 * GET /api/notifications/push-config — the PUBLIC half of the Firebase web config, which any
 * signed-in browser needs to mint a token. requireAuth only; nothing here is secret (these
 * values ship in every Firebase web app's bundle). `ready` is false until every field is set
 * and pushEnabled is true, and the client must not call getToken() when it is false.
 */
export interface PushWebConfig {
  ready: boolean;
  apiKey: string | null;
  projectId: string | null;
  messagingSenderId: string | null;
  appId: string | null;
  vapidKey: string | null;
}

/** POST /api/notifications/devices body. */
export interface RegisterDeviceInput {
  token: string;
  platform: PushPlatformKey;
  userAgent?: string;
}

/** GET /api/notifications/devices — the caller's own devices only. */
export interface DeviceView {
  id: string;
  platform: PushPlatformKey;
  /** Last 6 characters of the token — enough to recognise, not enough to send. */
  tokenTail: string;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
}

/** GET/PUT /api/notifications/events — one row per registered event, defaults merged in. */
export interface EventSettingView {
  eventKey: EventKey;
  label: string;
  description: string;
  push: boolean;
  /** True when no DB row exists yet and the values shown are the code defaults. */
  isDefault: boolean;
}

export interface EventSettingUpdate {
  eventKey: EventKey;
  push: boolean;
}

/** GET/PUT /api/notifications/preferences — the SESSION user's own rows, defaults merged in. */
export interface PreferenceView {
  eventKey: EventKey;
  label: string;
  description: string;
  push: boolean;
}

export interface PreferenceUpdate {
  eventKey: EventKey;
  push: boolean;
}

/** POST /api/notifications/test body and response. */
export interface TestSendInput {
  channel: Channel;
  toEmail?: string;
  testSubject?: string;
  testMessage?: string;
}

export interface TestSendResult {
  channel: Channel;
  ok: boolean;
  /** On success: where it went (masked). On failure: the named reason. */
  detail: string;
}

/** One row of GET /api/notifications/inbox — the session user's own (plan 2309, Part D). */
export interface InboxItem {
  id: string;
  eventKey: string;
  title: string;
  body: string;
  /** Relative, e.g. "/transfers/abc". Null when the notification links nowhere. */
  link: string | null;
  /** ISO time it was read; null while unread. */
  readAt: string | null;
  createdAt: string;
}
