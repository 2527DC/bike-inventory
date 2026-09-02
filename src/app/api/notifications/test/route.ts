export const dynamic = "force-dynamic";
// The SMTP and FCM senders use Node APIs (net sockets, RSA signing) that the edge runtime does
// not have.
export const runtime = "nodejs";
// An SMTP handshake against a slow or misconfigured host can take most of the default budget.
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError, type CurrentUser } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { sendTestEmail, maskEmail } from "@/lib/notify/email";
import { sendTestPush } from "@/lib/notify/push";
import { NotConfiguredError, type SendResult, type TestSendResult } from "@/lib/notify/types";

const log = createLogger("notify:test");

// Send one real message through the saved configuration, to the ADMIN WHO PRESSED THE BUTTON.
//
// This is the only thing that ever sets `emailConnected` / `pushConnected` to true — saving
// the form never does (plan §D.4, the same rule StorageConfig.isConnected follows). A test that
// fails records WHY on the row so the settings screen can show it to the next person who opens
// the page, not only to the one who ran it.
//
// The response is ALWAYS 200 with a TestSendResult. "SMTP host is empty" is a named failure
// the admin is meant to read and fix, not a server fault, and a 500 would hide it behind a
// generic banner. Only an auth failure or a database fault leaves this route by another exit.

const SINGLETON = "singleton";

const BodySchema = z.object({
  channel: z.enum(["EMAIL", "PUSH"], { error: "channel must be EMAIL or PUSH" }),
});

/** The failed half of SendResult, so a caller holding one can read `.error` without narrowing. */
type FailedSend = Extract<SendResult, { ok: false }>;

/** The sender's contract: it returns SendResult, or throws NotConfiguredError. Anything else
 *  is a bug in the sender, logged as such — but still reported as a named failure, because a
 *  test button that returns 500 has told the admin nothing they can act on. */
function failureFromThrow(e: unknown, what: string): FailedSend {
  if (e instanceof NotConfiguredError) {
    log.warn(`${what} not configured`, { channel: e.channel, reason: e.message });
    return { ok: false, error: e.message };
  }
  const message = e instanceof Error ? e.message : String(e);
  log.error(`${what} threw unexpectedly`, { error: message });
  return { ok: false, error: `The ${what} failed unexpectedly: ${message}` };
}

async function recordEmailTest(result: SendResult) {
  const now = new Date();
  const fields = {
    emailConnected: result.ok,
    emailLastTestedAt: now,
    emailLastTestError: result.ok ? null : result.error,
  };
  await prisma.notificationConfig.upsert({
    where: { id: SINGLETON },
    update: fields,
    create: { id: SINGLETON, ...fields },
  });
}

async function recordPushTest(result: SendResult) {
  const now = new Date();
  const fields = {
    pushConnected: result.ok,
    pushLastTestedAt: now,
    pushLastTestError: result.ok ? null : result.error,
  };
  await prisma.notificationConfig.upsert({
    where: { id: SINGLETON },
    update: fields,
    create: { id: SINGLETON, ...fields },
  });
}

async function testEmail(user: CurrentUser): Promise<TestSendResult> {
  const started = Date.now();
  let result: SendResult;
  try {
    result = await sendTestEmail({ email: user.email, name: user.name });
  } catch (e) {
    result = failureFromThrow(e, "email sender");
  }
  log.debug("test email attempted", { userId: user.id, ok: result.ok, ms: Date.now() - started });

  await recordEmailTest(result);

  return result.ok
    ? { channel: "EMAIL", ok: true, detail: `sent to ${maskEmail(user.email)}` }
    : { channel: "EMAIL", ok: false, detail: result.error };
}

async function testPush(user: CurrentUser): Promise<TestSendResult> {
  const devices = await prisma.pushDevice.findMany({
    where: { userId: user.id },
    select: { id: true, token: true, platform: true },
  });

  // Nothing was sent, so nothing is recorded on the config row: whether FCM works is a
  // separate question from whether THIS admin has a device, and a "no devices" note in
  // pushLastTestError would wrongly un-prove a configuration someone else already tested.
  if (devices.length === 0) {
    log.info("test push skipped — no devices", { userId: user.id });
    return {
      channel: "PUSH",
      ok: false,
      detail: "You have no registered devices — enable push on this browser first",
    };
  }

  let sent = 0;
  const deadIds: string[] = [];
  const errors: string[] = [];
  let notConfigured: FailedSend | null = null;

  // Sequential on purpose: an admin has one to three devices, and the first NotConfiguredError
  // answers for all of them — there is no point asking FCM the same question three times.
  for (const device of devices) {
    const started = Date.now();
    let result: SendResult;
    try {
      result = await sendTestPush({ token: device.token, platform: device.platform });
    } catch (e) {
      const failure = failureFromThrow(e, "push sender");
      result = failure;
      if (e instanceof NotConfiguredError) {
        notConfigured = failure;
        break;
      }
    }
    log.debug("test push attempted", {
      userId: user.id,
      deviceId: device.id,
      platform: device.platform,
      ok: result.ok,
      ms: Date.now() - started,
    });

    if (result.ok) {
      sent += 1;
    } else {
      errors.push(result.error);
      if (result.deadToken) deadIds.push(device.id);
    }
  }

  // FCM said UNREGISTERED / INVALID_ARGUMENT: the browser dropped the token or the user cleared
  // site data. Keeping the row would make every future notify() fail on it for nothing.
  if (deadIds.length > 0) {
    await prisma.pushDevice.deleteMany({ where: { id: { in: deadIds } } });
    log.info("dead push devices removed", { userId: user.id, count: deadIds.length });
  }

  if (notConfigured) {
    await recordPushTest(notConfigured);
    return { channel: "PUSH", ok: false, detail: notConfigured.error };
  }

  if (sent > 0) {
    // One delivered message is proof the credentials work; a dead sibling token is not a
    // configuration problem and is already gone.
    await recordPushTest({ ok: true });
    const failedNote =
      errors.length > 0 ? ` (${errors.length} failed: ${errors[0]})` : "";
    return { channel: "PUSH", ok: true, detail: `sent to ${sent} device(s)${failedNote}` };
  }

  const allDead = deadIds.length === devices.length;
  const detail = allDead
    ? `All ${deadIds.length} device token(s) were rejected by FCM and have been removed — enable push again on this browser`
    : errors[0] || "No device accepted the message";
  await recordPushTest({ ok: false, error: detail });
  return { channel: "PUSH", ok: false, detail };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("settings_notifications", "edit");

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message || "Invalid request", 400);
    }
    const { channel } = parsed.data;

    log.info("test send requested", { userId: user.id, channel });

    const result = channel === "EMAIL" ? await testEmail(user) : await testPush(user);

    if (result.ok) {
      log.info("test send succeeded", { userId: user.id, channel, detail: result.detail });
    } else {
      log.warn("test send failed", { userId: user.id, channel, reason: result.detail });
    }

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    // Only a database fault or a bug above lands here — a sender failure is a 200 with ok:false.
    log.error("test send could not run", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("The test could not run", 500);
  }
}
