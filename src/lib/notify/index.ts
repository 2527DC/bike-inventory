// ─── notify() — the one entry point ───────────────────────────────────────────
//
// Every event in the app raises a notification through this function and nothing else. It
// resolves the admin's global per-event switch, subtracts each recipient's own opt-out, fans
// out to push and email, and writes one NotificationOutbox row per channel per recipient so
// "why didn't I get that?" has an answer in the database.
//
// Plan: docs/implementation/pending/notifications-and-settings-rbac-plan.md, Part F.
//
// TWO RULES, both load-bearing:
//
// 1. It NEVER throws into its caller. A failed notification must not roll back — or even
//    surface as an error on — the stock write, job update or shipment that triggered it. Every
//    failure is logged and recorded as FAILED or SKIPPED, and the caller gets a count.
//
// 2. It is called AFTER the caller's prisma.$transaction has COMMITTED, never inside it
//    (§F.0). Prisma 6 gives an interactive transaction five seconds; this function does SMTP
//    and FCM network I/O. Inside the transaction it would time the write out and roll it back —
//    and a push already delivered cannot be recalled by a rollback. Callers collect what they
//    need inside the transaction and call this afterwards, ideally inside next/server's
//    `after()` so the HTTP response is not delayed either.

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { NOTIFICATION_EVENTS, type EventKey } from "./events";
import {
  NotConfiguredError,
  type Channel,
  type NotifyInput,
  type NotifyOutcome,
  type OutboxStatus,
  type SendResult,
} from "./types";
import { sendEmail, maskEmail } from "./email";
import { sendPush, tokenTail } from "./push";

export type { NotifyInput, NotifyOutcome } from "./types";
export { NOTIFICATION_EVENTS, EVENT_KEYS, type EventKey } from "./events";

const log = createLogger("notify");

/** How many sends run at once per channel. Enough to finish 40 staff in a few seconds; not enough to trip FCM or Gmail rate limits. */
const SEND_CONCURRENCY = 5;

type OutboxRow = {
  eventKey: string;
  channel: Channel;
  status: OutboxStatus;
  userId: string | null;
  target: string | null;
  refId: string | null;
  error: string | null;
};

export async function notify(eventKey: EventKey, input: NotifyInput): Promise<NotifyOutcome> {
  const outcome: NotifyOutcome = { eventKey, sent: 0, failed: 0, skipped: 0 };
  const rows: OutboxRow[] = [];
  const refId = input.refId ?? null;
  const started = Date.now();

  const record = (row: Omit<OutboxRow, "eventKey" | "refId">) => {
    rows.push({ eventKey, refId, ...row });
    if (row.status === "SENT") outcome.sent++;
    else if (row.status === "FAILED") outcome.failed++;
    else outcome.skipped++;
  };

  try {
    const recipientIds = Array.from(new Set(input.recipients.filter(Boolean)));
    if (recipientIds.length === 0) {
      log.debug("no recipients", { eventKey, refId });
      return outcome;
    }

    // ── 0. The MASTER switches ────────────────────────────────────────────────
    // The system ships installed but OFF (owner, 2 Sep 2026): every event is wired, and both
    // channels stay switched off in Settings → Notifications until someone deliberately turns
    // one on. While a channel is off there is no point resolving recipients, preferences or
    // devices for it — one channel-level SKIPPED row says why, and we move on. This is also
    // what keeps the outbox quiet in the months before push or email is actually configured.
    const config = await prisma.notificationConfig.findUnique({
      where: { id: "singleton" },
      select: { pushEnabled: true, emailEnabled: true },
    });
    const pushMaster = config?.pushEnabled ?? false;
    const emailMaster = config?.emailEnabled ?? false;

    // ── 1. The admin's global switch for this event ───────────────────────────
    // An absent row means "use the code default" — the column defaults on the table are not
    // the whole story because the right default differs per event (see events.ts).
    const setting = await prisma.notificationEventSetting.findUnique({ where: { eventKey } });
    const defaults = NOTIFICATION_EVENTS[eventKey].defaults;
    const pushOn = pushMaster && (setting ? setting.pushEnabled : defaults.push);
    const emailOn = emailMaster && (setting ? setting.emailEnabled : defaults.email);

    if (!pushOn) {
      record({
        channel: "PUSH", status: "SKIPPED", userId: null, target: null,
        error: pushMaster ? "event disabled for push" : "push is switched off in Settings → Notifications",
      });
    }
    if (!emailOn) {
      record({
        channel: "EMAIL", status: "SKIPPED", userId: null, target: null,
        error: emailMaster ? "event disabled for email" : "email is switched off in Settings → Notifications",
      });
    }

    if (pushOn || emailOn) {
      // ── 2. Recipients and their own opt-outs ─────────────────────────────────
      // Inactive users are dropped here as a second line of defence — usersWithPermission
      // already filters them, but a caller may pass ids from elsewhere (a job's mechanic).
      const users = await prisma.user.findMany({
        where: { id: { in: recipientIds }, isActive: true },
        select: { id: true, name: true, email: true },
      });
      const prefs = await prisma.notificationPreference.findMany({
        where: { eventKey, userId: { in: users.map((u) => u.id) } },
        select: { userId: true, push: true, email: true },
      });
      const prefByUser = new Map(prefs.map((p) => [p.userId, p]));
      const wantsPush = (id: string) => prefByUser.get(id)?.push ?? true;
      const wantsEmail = (id: string) => prefByUser.get(id)?.email ?? true;

      log.debug("resolved", {
        eventKey,
        refId,
        asked: recipientIds.length,
        active: users.length,
        pushOn,
        emailOn,
      });

      // ── 3. Push ──────────────────────────────────────────────────────────────
      if (pushOn) {
        const pushUsers = users.filter((u) => wantsPush(u.id));
        for (const u of users) {
          if (!wantsPush(u.id)) record({ channel: "PUSH", status: "SKIPPED", userId: u.id, target: null, error: "opted out" });
        }

        const devices = await prisma.pushDevice.findMany({
          where: { userId: { in: pushUsers.map((u) => u.id) } },
          select: { id: true, userId: true, token: true, platform: true },
        });
        const usersWithDevice = new Set(devices.map((d) => d.userId));
        for (const u of pushUsers) {
          if (!usersWithDevice.has(u.id)) record({ channel: "PUSH", status: "SKIPPED", userId: u.id, target: null, error: "no registered device" });
        }

        const deadDeviceIds: string[] = [];
        await fanOut("PUSH", devices, async (d) => {
          const result = await sendPush(
            { token: d.token, platform: d.platform },
            // Caller-supplied data first, then ours — so eventKey/refId can never be overwritten
            // by a caller's key of the same name. FCM requires every data value to be a string.
            {
              title: input.title,
              body: input.body,
              link: input.link,
              data: { ...(input.data ?? {}), ...(refId ? { refId } : {}), eventKey },
            }
          );
          if (!result.ok && result.deadToken) deadDeviceIds.push(d.id);
          return { userId: d.userId, target: tokenTail(d.token), result };
        });

        // A token FCM has declared dead never comes back. Leaving it makes every later send
        // slower and noisier; deleting it is the only correct response (§D.1).
        if (deadDeviceIds.length) {
          await prisma.pushDevice.deleteMany({ where: { id: { in: deadDeviceIds } } });
          log.warn("dead push tokens removed", { eventKey, count: deadDeviceIds.length });
        }
      }

      // ── 4. Email ─────────────────────────────────────────────────────────────
      if (emailOn) {
        const emailUsers = users.filter((u) => wantsEmail(u.id));
        for (const u of users) {
          if (!wantsEmail(u.id)) record({ channel: "EMAIL", status: "SKIPPED", userId: u.id, target: null, error: "opted out" });
        }

        const text = input.link ? `${input.body}\n\n${absoluteUrl(input.link)}` : input.body;
        await fanOut("EMAIL", emailUsers, async (u) => {
          const result = await sendEmail({ email: u.email, name: u.name }, { subject: input.title, text });
          return { userId: u.id, target: maskEmail(u.email), result };
        });
      }
    }
  } catch (error) {
    // Anything unexpected — a database hiccup resolving recipients, a bug — lands here and is
    // logged, never rethrown. The caller's write has already committed and must stay that way.
    log.error("notify failed before or during fan-out", {
      eventKey,
      refId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ── 5. The outbox ──────────────────────────────────────────────────────────
  // fanOut already flushed after each concurrency batch; this catches the channel-level rows
  // (event disabled, opted out, no device) and anything a partial fan-out left behind. Guarded
  // separately, because a logging failure must not hide that sends already happened.
  await flushOutbox();

  log.info("notification processed", { ...outcome, refId, ms: Date.now() - started });
  return outcome;

  // ── helpers (closures over `record`) ──────────────────────────────────────

  /**
   * Send to each target with bounded concurrency, recording one outbox row per target.
   *
   * The FIRST target is sent alone. If the sender throws NotConfiguredError there, the whole
   * channel is skipped with ONE channel-level row (userId and target null) instead of forty
   * identical failures — and no further sends are attempted. Only once one send has proven
   * the channel is configured do the rest go out concurrently.
   */
  async function fanOut<T>(
    channel: Channel,
    targets: T[],
    send: (t: T) => Promise<{ userId: string; target: string; result: SendResult }>
  ): Promise<void> {
    if (targets.length === 0) return;

    type Probe = { configured: true } | { configured: false; reason: string };

    // `unconfigured` is set the moment ANY send reports the channel is not configured, not just
    // the probe. Both senders re-read NotificationConfig on every call, so an admin flipping the
    // master switch off mid-fan-out makes every remaining send throw. Before this, those targets
    // returned a Probe nobody looked at and produced NO row at all — no SENT, no FAILED, no
    // SKIPPED — so recipients vanished without trace and the counts under-reported.
    let unconfigured: string | null = null;

    const handle = async (t: T): Promise<Probe> => {
      try {
        const { userId, target, result } = await send(t);
        if (result.ok) {
          record({ channel, status: "SENT", userId, target, error: null });
        } else {
          record({ channel, status: "FAILED", userId, target, error: result.error });
          log.warn("send failed", { eventKey, channel, userId, error: result.error });
        }
        return { configured: true };
      } catch (error) {
        if (error instanceof NotConfiguredError) {
          unconfigured ??= error.message;
          return { configured: false, reason: error.message };
        }
        // A sender contract violation — they should return {ok:false}, not throw. Record it
        // as FAILED against the target we can identify, and carry on with the others.
        const msg = error instanceof Error ? error.message : String(error);
        log.error("sender threw", { eventKey, channel, error: msg });
        record({ channel, status: "FAILED", userId: null, target: null, error: msg });
        return { configured: true };
      }
    };

    const [first, ...rest] = targets;
    const probe = await handle(first);
    if (!probe.configured) {
      record({ channel, status: "SKIPPED", userId: null, target: null, error: probe.reason });
      log.warn("channel skipped", { eventKey, channel, reason: probe.reason, targets: targets.length });
      return;
    }

    let sentSoFar = 1;
    for (let i = 0; i < rest.length; i += SEND_CONCURRENCY) {
      await Promise.all(rest.slice(i, i + SEND_CONCURRENCY).map(handle));

      // Flush what we have. The outbox used to be written in ONE createMany after every send
      // finished, so an invocation killed mid-fan-out — 40 staff × a fresh SMTP handshake each
      // is tens of seconds — lost every row including the SENT ones. Mail had gone out and the
      // table said nothing happened, which is the exact question the table exists to answer.
      await flushOutbox();

      if (unconfigured) {
        // The channel went unconfigured partway through. Every remaining target is accounted
        // for by one row rather than N identical failures, and we stop sending.
        const remaining = rest.length - Math.min(i + SEND_CONCURRENCY, rest.length);
        record({
          channel, status: "SKIPPED", userId: null, target: null,
          error: `${unconfigured} (stopped after ${sentSoFar} of ${targets.length}; ${remaining} not attempted)`,
        });
        log.warn("channel became unconfigured mid-send", { eventKey, channel, reason: unconfigured, remaining });
        return;
      }
      sentSoFar += Math.min(SEND_CONCURRENCY, rest.length - i);
    }
  }

  /** Write and clear whatever outbox rows have accumulated. Never throws. */
  async function flushOutbox(): Promise<void> {
    if (rows.length === 0) return;
    const batch = rows.splice(0, rows.length);
    try {
      await prisma.notificationOutbox.createMany({ data: batch });
    } catch (error) {
      log.error("outbox write failed", {
        eventKey, refId, rows: batch.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** A link in an email has to be absolute; push carries relative links for the service worker. */
function absoluteUrl(link: string): string {
  if (/^https?:\/\//i.test(link)) return link;
  const base = (process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  return base ? `${base}${link.startsWith("/") ? "" : "/"}${link}` : link;
}
