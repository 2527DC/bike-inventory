// ─── Email sender — SMTP via nodemailer ───────────────────────────────────────
//
// The ONLY code in the repo that puts a message on an SMTP socket. notify() (index.ts) and
// POST /api/notifications/test call sendEmail() / sendTestEmail(); nothing else should import
// nodemailer. Every shape here comes from ./types — the contract the notify modules and the
// routes are written against — so this file can change internally without anything else
// noticing.
//
// Plan: docs/implementation/pending/notifications-and-settings-rbac-plan.md, Part C.
//
// WHAT THE OWNER HAS TO DO IN GOOGLE (plan §C.1 — no Google Cloud project needed)
// ---------------------------------------------------------------------------
// The sending account is a Gmail address, and Gmail will not take the account password over
// SMTP. It wants an App Password, and App Passwords do not exist until 2-Step Verification
// is on:
//
//   1. Google Account → Security → turn on 2-Step Verification.
//   2. Google Account → Security → App Passwords → generate → copy the 16-character value.
//   3. /settings/notifications → Email: host smtp.gmail.com, port 587, secure OFF (STARTTLS),
//      user = the full address, password = the App Password. Press "Send test email".
//      `emailConnected` flips true only when Gmail answers a real 250 — saving never sets it.
//
// THE LIMIT THAT WILL ACTUALLY BITE (plan §C.2)
// --------------------------------------------
// A free @gmail.com account may send to roughly 500 recipients a day (Google Workspace:
// ~2,000), and `From` is locked to the account or a verified alias. One event mailed to 40
// staff is 8% of a day's quota. That is why email defaults OFF per event in events.ts while
// push defaults on, and why every recipient has a personal opt-in — email is the scarce
// channel; push is free. If this ever mails customers rather than staff, SMTP is the wrong
// tool, and the `emailProvider` column exists so a transactional service can take over
// without touching a call site. Gmail OAuth was weighed and rejected for a free account —
// read §C.3 before proposing it again.
//
// THREE RULES THIS FILE ENFORCES
// ------------------------------
// - The transport is built PER CALL and never cached in module scope. On Vercel a module
//   lives as long as the lambda instance does, so a cached transport would keep mailing
//   through credentials an admin revoked minutes ago. Re-reading NotificationConfig costs
//   one primary-key read; being wrong costs mail sent with a dead password.
// - The App Password never leaves this module: not in a log line, not in a thrown error,
//   not in SendResult.error. nodemailer's SMTPError carries the provoking `command`, which
//   for AUTH PLAIN / AUTH LOGIN is the credentials in base64 — so every string we let out is
//   scrubbed of the password in raw AND base64 form first (see scrub()).
// - "Not configured" is a THROW (NotConfiguredError); "the send failed" is a RESULT
//   ({ ok: false }). notify() turns the throw into ONE channel-level SKIPPED outbox row
//   instead of a FAILED row per recipient, and the test route shows the message to the
//   admin as-is. Blurring the two would either flood the outbox or hide a misconfiguration.
//
// Routes that call this must declare `export const runtime = "nodejs"`. SMTP is a raw TCP
// socket on 587/465, the Edge runtime cannot open one, and the failure it produces does not
// say so — which is why the rule is repeated here and not only in the plan.

import { createTransport } from "nodemailer";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { NotConfiguredError } from "./types";
import type { EmailMessage, EmailRecipient, SendResult } from "./types";

const log = createLogger("notify:email");

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send one email to one recipient using the SMTP details in NotificationConfig.
 *
 * Throws NotConfiguredError when email is switched off or the configuration is incomplete —
 * that is a state, not a failure, and notify() records it once per channel. A send that the
 * server refuses resolves to `{ ok: false, error }`; it never throws.
 */
export async function sendEmail(to: EmailRecipient, msg: EmailMessage): Promise<SendResult> {
  const settings = await loadSettings();
  const transport = buildTransport(settings);

  const masked = maskEmail(to.email);
  const html = msg.html ?? wrapText(msg.text);
  // Size, not content: the number tells you whether a template ballooned; the body would put
  // customer names and stock figures in the log.
  const bytes = Buffer.byteLength(msg.text, "utf8") + Buffer.byteLength(html, "utf8");
  const started = Date.now();

  log.debug("-> SMTP send", {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    to: masked,
    bytes,
  });

  try {
    const info = await transport.sendMail({
      // Address objects rather than a hand-built `"Name" <addr>` string: nodemailer quotes and
      // encodes the display name itself, so a name with a quote or a non-ASCII character
      // cannot break the header. On the wire the result is the same `"Name" <addr>`.
      from: settings.fromName
        ? { name: settings.fromName, address: settings.fromEmail }
        : settings.fromEmail,
      to: to.name ? { name: to.name, address: to.email } : to.email,
      subject: msg.subject,
      // Both parts always. Text is what a screen reader, a watch and a plain-text client
      // show; HTML is what a phone shows. Sending only HTML also scores worse with spam filters.
      text: msg.text,
      html,
    });
    const ms = Date.now() - started;

    // A server can accept the DATA and still have refused the recipient at RCPT TO; nodemailer
    // resolves in that case and lists the address under `rejected` instead of throwing. With
    // one recipient per call, "nobody accepted it" IS a failure, whatever the promise said.
    if (info.accepted.length === 0) {
      const line = stripCode(firstLine(scrub(info.response ?? "", settings)));
      const error = `${settings.host} did not accept the recipient${line ? `: ${line}` : ""}`;
      log.error("send failed: recipient rejected", {
        to: masked,
        host: settings.host,
        port: settings.port,
        response: line,
        ms,
      });
      return { ok: false, error };
    }

    log.info("send completed", { to: masked, messageId: info.messageId, ms });
    return { ok: true, id: info.messageId };
  } catch (err) {
    const ms = Date.now() - started;
    const failure = describeSmtpError(err, settings);
    log.error("send failed", {
      to: masked,
      host: settings.host,
      port: settings.port,
      code: failure.code,
      responseCode: failure.responseCode,
      error: failure.message,
      ms,
    });
    return { ok: false, error: failure.message };
  } finally {
    // Not pooled, so sendMail has already hung up. close() makes the "one transport per call,
    // nothing lingers" rule explicit and releases whatever a failed handshake left half-open.
    transport.close();
  }
}

/**
 * The "Send test email" button. Same path as a real send — same config read, same transport,
 * same result shape — so a green tick here means a real notification would have arrived too.
 * The route that calls this owns writing emailConnected / emailLastTestedAt / emailLastTestError.
 */
export async function sendTestEmail(to: EmailRecipient): Promise<SendResult> {
  const at = new Date().toISOString();
  return sendEmail(to, {
    subject: "BCH Ops — test email",
    text: [
      "This is a test email from BCH Ops.",
      "",
      `It was sent from Settings → Notifications at ${at}.`,
      "",
      "If you are reading it, the SMTP details are correct and BCH Ops can reach your inbox. There is nothing else to do.",
    ].join("\n"),
  });
}

/**
 * "ravi@gmail.com" -> "r***@gmail.com". Enough for a log line or a success toast to say WHERE
 * the mail went without the full address landing in a log store. Anything without an "@"
 * (or with nothing before it) is not an address we should echo at all, so it becomes "***".
 */
export function maskEmail(address: string): string {
  const at = address.indexOf("@");
  if (at <= 0) return "***";
  return `${address[0]}***${address.slice(at)}`;
}

// ─── Configuration ────────────────────────────────────────────────────────────

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string | null;
  fromEmail: string;
}

/**
 * Read the singleton row and narrow it to a complete SMTP configuration, or throw
 * NotConfiguredError naming exactly what is missing. Every message here is shown to an admin
 * by the test route, so each says where to go and what to fill in — not only what is wrong.
 */
async function loadSettings(): Promise<SmtpSettings> {
  let cfg;
  try {
    cfg = await prisma.notificationConfig.findUnique({ where: { id: "singleton" } });
  } catch (err) {
    // A database fault is neither "not configured" nor "the send failed" — rethrow so the
    // caller's own handling applies, but say so here first, because this is the line that
    // tells the difference between "SMTP is broken" and "the database is".
    log.error("could not read NotificationConfig", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  if (!cfg) {
    throw notConfigured(
      "Email is not configured yet — open Settings → Notifications and fill in the SMTP details",
      { reason: "no-row" }
    );
  }
  if (!cfg.emailEnabled) {
    // A switched-off channel is a decision someone made, not a fault. Logged at debug so it
    // does not bury the misconfigurations below, which ARE worth a warn.
    throw notConfigured("Email sending is switched off in Settings → Notifications", {
      reason: "disabled",
      deliberate: true,
    });
  }
  if (cfg.emailProvider !== "SMTP") {
    throw notConfigured(
      `Email provider ${cfg.emailProvider} is declared but not implemented`,
      { reason: "provider", provider: cfg.emailProvider }
    );
  }

  // Each check names the schema column as well as the human label, so the message an admin
  // reads and the field a developer greps for are the same word.
  if (!cfg.smtpHost) {
    throw notConfigured(missingField("smtpHost", "host"), { reason: "missing", field: "smtpHost" });
  }
  if (cfg.smtpPort == null) {
    throw notConfigured(missingField("smtpPort", "port"), { reason: "missing", field: "smtpPort" });
  }
  if (!Number.isInteger(cfg.smtpPort) || cfg.smtpPort < 1 || cfg.smtpPort > 65535) {
    throw notConfigured(
      `SMTP port (smtpPort) is ${cfg.smtpPort}, which is not a valid port — use 587 for STARTTLS or 465 for implicit TLS`,
      { reason: "invalid", field: "smtpPort", value: cfg.smtpPort }
    );
  }
  if (!cfg.smtpUser) {
    throw notConfigured(missingField("smtpUser", "username"), { reason: "missing", field: "smtpUser" });
  }
  if (!cfg.smtpPassword) {
    throw notConfigured(missingField("smtpPassword", "password"), { reason: "missing", field: "smtpPassword" });
  }
  if (!cfg.fromEmail) {
    throw notConfigured(missingField("fromEmail", "from address"), { reason: "missing", field: "fromEmail" });
  }

  return {
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    user: cfg.smtpUser,
    password: cfg.smtpPassword,
    fromName: cfg.fromName || null,
    fromEmail: cfg.fromEmail,
  };
}

function missingField(column: string, label: string): string {
  return `SMTP ${label} (${column}) is not set in Settings → Notifications`;
}

/**
 * Log the reason and hand back the error to throw. Centralised so every not-configured path
 * is observable — a silent throw here would be the one place in the send pipeline with no
 * log line, and it is exactly the place an admin will ask about.
 */
function notConfigured(
  message: string,
  ctx: { reason: string; deliberate?: boolean; [k: string]: unknown }
): NotConfiguredError {
  const { deliberate, ...rest } = ctx;
  if (deliberate) log.debug(`email skipped: ${message}`, rest);
  else log.warn(`email not configured: ${message}`, rest);
  return new NotConfiguredError("EMAIL", message);
}

// ─── Transport ────────────────────────────────────────────────────────────────

/**
 * A fresh transport for this one call. Never hoist this to module scope — see the header.
 */
function buildTransport(s: SmtpSettings) {
  return createTransport({
    host: s.host,
    port: s.port,
    // true  = TLS from the first byte (port 465).
    // false = plain connection, then STARTTLS once the server offers it (port 587). nodemailer
    //         negotiates the upgrade on its own; `requireTLS` makes it refuse to continue if
    //         the upgrade is NOT offered, so an App Password never crosses the wire in clear
    //         text because someone typed the wrong port.
    secure: s.secure,
    requireTLS: !s.secure,
    auth: { user: s.user, pass: s.password },
    // nodemailer waits 2 minutes to connect and 10 for a stalled socket by default. A
    // serverless route is killed long before that, and the admin would see a gateway timeout
    // instead of our named reason. Fail fast, in words.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

// ─── Errors ───────────────────────────────────────────────────────────────────

interface SmtpFailure {
  /** Safe for SendResult.error — scrubbed, one line, bounded length. */
  message: string;
  /** nodemailer's code: EAUTH, ECONNECTION, ETIMEDOUT, EDNS, EENVELOPE, EMESSAGE, ESOCKET. */
  code?: string;
  /** The numeric SMTP reply (535, 550, 421…) when the server gave one. */
  responseCode?: number;
}

/**
 * Turn whatever nodemailer threw into one sentence an admin can act on, carrying the SMTP
 * response code when the server gave one. SMTPError exposes `code`, `responseCode` and
 * `response` (the server's last line); the password is scrubbed from everything we read
 * before a character of it is kept.
 */
function describeSmtpError(err: unknown, s: SmtpSettings): SmtpFailure {
  const e = (err ?? {}) as {
    code?: unknown;
    responseCode?: unknown;
    response?: unknown;
    message?: unknown;
  };
  const code = typeof e.code === "string" ? e.code : undefined;
  const responseCode = typeof e.responseCode === "number" ? e.responseCode : undefined;
  const response =
    typeof e.response === "string" ? stripCode(firstLine(scrub(e.response, s))) : "";
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "unknown error";
  const message = firstLine(scrub(raw, s));

  const where = `${s.host}:${s.port}`;
  const withCode = responseCode ? ` (SMTP ${responseCode})` : "";
  const isGoogle = /gmail|google/i.test(s.host);

  let text: string;
  switch (code) {
    case "EAUTH":
      // The single most common failure on day one: the account password was pasted where the
      // App Password belongs. Gmail's own 535 text does not say that, so we do.
      text = `${where} rejected the username or password${withCode}.${
        isGoogle ? " For Gmail this must be an App Password, not the account password." : ""
      }`;
      break;
    case "EDNS":
      text = `Could not resolve SMTP host "${s.host}" — check the host name.`;
      break;
    case "ECONNECTION":
    case "ETIMEDOUT":
    case "ESOCKET":
      text = `Could not connect to ${where} (${s.secure ? "implicit TLS" : "STARTTLS"}): ${message}. Check host, port and the secure setting.`;
      break;
    case "EENVELOPE":
      text = `${where} rejected the sender or recipient${withCode}: ${response || message}`;
      break;
    default:
      text = responseCode
        ? `SMTP ${responseCode} from ${where}: ${response || message}`
        : `${where}: ${message}`;
  }

  // NotificationOutbox.error and the settings screen both show this; neither wants a page.
  return { message: text.slice(0, 400), code, responseCode };
}

/**
 * Remove the App Password from text before it leaves the module. Three forms, because SMTP
 * transmits credentials base64-encoded and nodemailer's SMTPError.command holds the exact
 * bytes it sent: the raw value, base64(password) (AUTH LOGIN's second step) and
 * base64("\0user\0password") (AUTH PLAIN's single step).
 */
function scrub(text: string, s: SmtpSettings): string {
  // AUTH PLAIN joins authzid, user and password with NUL bytes. Built with fromCharCode
  // rather than a unicode escape so no editor or tool can silently swallow the byte.
  const NUL = String.fromCharCode(0);
  const secrets = [
    s.password,
    Buffer.from(s.password, "utf8").toString("base64"),
    Buffer.from(`${NUL}${s.user}${NUL}${s.password}`, "utf8").toString("base64"),
  ];
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join("[redacted]");
  }
  return out;
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/)[0] ?? "").trim();
}

/** "535-5.7.8 Username and Password not accepted" -> "5.7.8 Username and Password not accepted". */
function stripCode(line: string): string {
  return line.replace(/^\d{3}[ -]?/, "");
}

// ─── HTML template ────────────────────────────────────────────────────────────

/**
 * Minimal HTML around a plain-text body, for callers that did not supply their own. Inline
 * styles only — mail clients strip <style> blocks — and one column that fits a phone, because
 * that is where staff read these. The text is escaped and newlines become <br>, so what
 * notify() wrote is exactly what the reader sees.
 */
function wrapText(text: string): string {
  const body = escapeHtml(text).replace(/\r?\n/g, "<br>");
  const font =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:0;background:#f4f4f5;">',
    `<div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:${font};font-size:15px;line-height:1.5;color:#18181b;">`,
    '<div style="font-weight:600;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#71717a;margin-bottom:12px;">BCH Ops</div>',
    `<div style="background:#ffffff;border-radius:8px;padding:20px;">${body}</div>`,
    '<div style="font-size:12px;color:#71717a;margin-top:16px;">You receive this because of your notification preferences. Change them under More → My notifications.</div>',
    "</div></body></html>",
  ].join("");
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}
