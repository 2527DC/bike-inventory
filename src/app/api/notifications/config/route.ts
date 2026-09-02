export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import type { NotificationConfig, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import type { NotificationConfigView } from "@/lib/notify/types";

const log = createLogger("notify:config");

// Read and write the notification configuration.
//
// ONE row (`id: "singleton"`) holds both channels — the SMTP fields and the FCM fields never
// collide — mirroring StorageConfig exactly. Two values on it are secrets and follow the same
// rule secretAccessKey does in api/settings/storage/route.ts: the GET returns a MASK, never the
// value, and a PUT that sends the field absent or empty leaves the stored value alone. That is
// what lets an admin open the form, change the port and press Save without wiping a password
// the browser never had.
//
// `emailConnected` / `pushConnected` are NOT writable here. They flip true only when a real
// send succeeds in ../test, and saving a changed credential flips them back to false — a value
// nobody has tested has not proven itself.

const SINGLETON = "singleton";

// Only SMTP is implemented (plan §C). GMAIL_OAUTH and SES exist in the plan as future values,
// and the screen shows them disabled; accepting them here would let a saved row name a sender
// that does not exist and turn every send into a silent skip. Widen this when a sender lands.
const EMAIL_PROVIDERS = ["SMTP"] as const;
const PUSH_PROVIDERS = ["FCM"] as const;

const optionalText = (max: number) => z.string().trim().max(max).optional();

const EmailSchema = z
  .object({
    provider: z.enum(EMAIL_PROVIDERS, { error: "email.provider: only SMTP is implemented" }).optional(),
    smtpHost: optionalText(253),
    // null is accepted as "clear it" even though the contract only names number — a superset
    // that costs nothing and lets a blank port field actually blank the column.
    smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
    smtpSecure: z.boolean().optional(),
    smtpUser: optionalText(320),
    smtpPassword: z.string().max(500).optional(),
    fromName: optionalText(120),
    fromEmail: z
      .string()
      .trim()
      .max(320)
      .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
        message: "email.fromEmail: not a valid address",
      })
      .optional(),
    enabled: z.boolean().optional(),
  })
  .optional();

const PushSchema = z
  .object({
    provider: z.enum(PUSH_PROVIDERS, { error: "push.provider: only FCM is implemented" }).optional(),
    projectId: optionalText(120),
    // Service-account files run 2–3 KB; 64 KB leaves room without accepting a pasted novel.
    serviceAccountJson: z.string().max(64 * 1024).optional(),
    webApiKey: optionalText(200),
    messagingSenderId: optionalText(40),
    webAppId: optionalText(120),
    vapidKey: optionalText(200),
    enabled: z.boolean().optional(),
  })
  .optional();

const UpdateSchema = z.object({ email: EmailSchema, push: PushSchema });

const PASSWORD_MASK = "••••••••";

// ─── Service-account validation ────────────────────────────────────────────────
//
// Parsed on SAVE, with the field named, because a malformed file discovered at send time is
// far harder to diagnose (plan §D.4). Only the keys the FCM sender actually reads are required;
// Google's file has more, and they are stored verbatim with the rest.

const REQUIRED_SA_FIELDS = ["project_id", "private_key", "client_email", "token_uri"] as const;

type ParsedServiceAccount =
  | { ok: true; projectId: string; clientEmail: string }
  | { ok: false; error: string };

function parseServiceAccount(raw: string): ParsedServiceAccount {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Not logged as an error: a paste with a stray character is user input, not a fault.
    return { ok: false, error: "serviceAccountJson: not valid JSON" };
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, error: "serviceAccountJson: expected a JSON object" };
  }
  const obj = json as Record<string, unknown>;
  if (obj.type !== "service_account") {
    return { ok: false, error: 'serviceAccountJson: type must be "service_account"' };
  }
  for (const field of REQUIRED_SA_FIELDS) {
    const v = obj[field];
    if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, error: `serviceAccountJson: missing ${field}` };
    }
  }
  return {
    ok: true,
    projectId: (obj.project_id as string).trim(),
    clientEmail: (obj.client_email as string).trim(),
  };
}

/**
 * The only thing about the stored JSON that ever leaves the server. The client_email is the
 * service account's identity, not a credential — it is what an admin needs to recognise which
 * account is on file. Rows written before this validation existed may hold anything, so an
 * unparseable value still reads as "configured" rather than failing the whole GET.
 */
function maskServiceAccount(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = parseServiceAccount(raw);
  return parsed.ok ? `configured (client_email ${parsed.clientEmail})` : "configured";
}

// ─── View ──────────────────────────────────────────────────────────────────────

function toView(row: NotificationConfig | null): NotificationConfigView {
  return {
    email: {
      provider: row?.emailProvider ?? "SMTP",
      smtpHost: row?.smtpHost ?? null,
      smtpPort: row?.smtpPort ?? null,
      smtpSecure: row?.smtpSecure ?? false,
      smtpUser: row?.smtpUser ?? null,
      // NEVER the real value. This endpoint is reachable by anyone with settings_notifications.view.
      smtpPasswordMasked: row?.smtpPassword ? PASSWORD_MASK : null,
      fromName: row?.fromName ?? null,
      fromEmail: row?.fromEmail ?? null,
      enabled: row?.emailEnabled ?? false,
      connected: row?.emailConnected ?? false,
      lastTestedAt: row?.emailLastTestedAt?.toISOString() ?? null,
      lastTestError: row?.emailLastTestError ?? null,
    },
    push: {
      provider: row?.pushProvider ?? "FCM",
      projectId: row?.fcmProjectId ?? null,
      serviceAccountMasked: maskServiceAccount(row?.fcmServiceAccount ?? null),
      webApiKey: row?.fcmWebApiKey ?? null,
      messagingSenderId: row?.fcmMessagingSenderId ?? null,
      webAppId: row?.fcmWebAppId ?? null,
      vapidKey: row?.fcmVapidKey ?? null,
      enabled: row?.pushEnabled ?? false,
      connected: row?.pushConnected ?? false,
      lastTestedAt: row?.pushLastTestedAt?.toISOString() ?? null,
      lastTestError: row?.pushLastTestError ?? null,
    },
    // The contract makes this non-nullable, but no row exists until the first save. The epoch
    // is an unmistakable "never saved" — a fabricated "now" would read as a real timestamp.
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function GET() {
  try {
    await requireFeature("settings_notifications", "view");

    const row = await prisma.notificationConfig.findUnique({ where: { id: SINGLETON } });
    log.debug("config read", { exists: !!row });

    return successResponse(toView(row));
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not read notification config", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not read the notification settings", 500);
  }
}

/** "" clears a text column; undefined leaves it alone. Secrets never pass through here. */
function textOrNull(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  return v === "" ? null : v;
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireFeature("settings_notifications", "edit");

    const parsed = UpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message || "Invalid settings", 400);
    }
    const { email, push } = parsed.data;

    const existing = await prisma.notificationConfig.findUnique({ where: { id: SINGLETON } });

    // Typed as the CREATE input on purpose: this model has no relations, so the same plain
    // scalar object is valid for both arms of the upsert below without a cast.
    const data: Prisma.NotificationConfigCreateInput = { updatedById: user.id };
    // A changed credential has not proven itself, so the channel's `connected` flag is reset
    // and a forced re-test is the point. Compared against the stored row rather than "field was
    // present" so re-saving an unchanged form does not undo a passing test.
    let emailCredentialChanged = false;
    let pushCredentialChanged = false;

    if (email) {
      const next = {
        emailProvider: email.provider,
        smtpHost: textOrNull(email.smtpHost),
        smtpPort: email.smtpPort,
        smtpSecure: email.smtpSecure,
        smtpUser: textOrNull(email.smtpUser),
        fromName: textOrNull(email.fromName),
        fromEmail: textOrNull(email.fromEmail),
        emailEnabled: email.enabled,
      };
      // Empty means "unchanged" — the browser only ever saw the mask, so an empty field is the
      // form echoing back what it was given, not a request to clear the password.
      const password = email.smtpPassword ? email.smtpPassword : undefined;

      Object.assign(data, next, password !== undefined ? { smtpPassword: password } : {});

      // fromName and enabled do not affect whether the server accepts a send; everything else
      // does. Gmail in particular rejects a From that is not the account or a verified alias.
      const credentialKeys = [
        "emailProvider", "smtpHost", "smtpPort", "smtpSecure", "smtpUser", "fromEmail",
      ] as const;
      emailCredentialChanged =
        password !== undefined ||
        credentialKeys.some((k) => next[k] !== undefined && next[k] !== (existing?.[k] ?? null));
    }

    if (push) {
      const next = {
        pushProvider: push.provider,
        fcmProjectId: textOrNull(push.projectId),
        fcmWebApiKey: textOrNull(push.webApiKey),
        fcmMessagingSenderId: textOrNull(push.messagingSenderId),
        fcmWebAppId: textOrNull(push.webAppId),
        fcmVapidKey: textOrNull(push.vapidKey),
        pushEnabled: push.enabled,
      };

      let serviceAccount: string | undefined;
      const rawJson = push.serviceAccountJson?.trim();
      if (rawJson) {
        const sa = parseServiceAccount(rawJson);
        if (!sa.ok) {
          log.warn("service account rejected", { userId: user.id, reason: sa.error });
          return errorResponse(sa.error, 400);
        }
        // Stored verbatim: the sender parses it again and Google's file carries keys we do
        // not validate but may need later. Re-serialising would only lose formatting.
        serviceAccount = rawJson;
        if (!next.fcmProjectId) {
          // The project id is inside the file; make the admin type it only when it differs.
          next.fcmProjectId = sa.projectId;
        } else if (next.fcmProjectId !== sa.projectId) {
          // Not rejected — a project can be renamed — but a send to the wrong project fails
          // with an opaque 404, and this line is what explains it.
          log.warn("projectId does not match service account", {
            userId: user.id,
            projectId: next.fcmProjectId,
            serviceAccountProjectId: sa.projectId,
          });
        }
      }

      Object.assign(
        data,
        next,
        serviceAccount !== undefined ? { fcmServiceAccount: serviceAccount } : {}
      );

      // The web-SDK values (API key, sender id, app id, VAPID) are what BROWSERS use to mint a
      // token; the server's ability to send rests on the project and the service account
      // alone. `pushConnected` describes the server's send, so only those reset it.
      const credentialKeys = ["pushProvider", "fcmProjectId"] as const;
      pushCredentialChanged =
        serviceAccount !== undefined ||
        credentialKeys.some((k) => next[k] !== undefined && next[k] !== (existing?.[k] ?? null));
    }

    if (emailCredentialChanged) {
      data.emailConnected = false;
      data.emailLastTestError = null;
    }
    if (pushCredentialChanged) {
      data.pushConnected = false;
      data.pushLastTestError = null;
    }

    // Prisma skips `undefined` fields in both arms, so one object serves the whole upsert.
    const row = await prisma.notificationConfig.upsert({
      where: { id: SINGLETON },
      update: data,
      create: { id: SINGLETON, ...data },
    });

    // Identifiers and booleans only — never the credentials themselves.
    log.info("notification config saved", {
      userId: user.id,
      emailTouched: !!email,
      pushTouched: !!push,
      emailCredentialChanged,
      pushCredentialChanged,
      emailEnabled: row.emailEnabled,
      pushEnabled: row.pushEnabled,
      hasSmtpPassword: !!row.smtpPassword,
      hasServiceAccount: !!row.fcmServiceAccount,
    });

    return successResponse(toView(row));
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not save notification config", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not save the notification settings", 500);
  }
}
