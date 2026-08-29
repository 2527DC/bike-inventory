export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { buildAccountabilityScorecard, formatScorecardMessage } from "@/lib/accountability";
import { createLogger } from "@/lib/logger";

const log = createLogger("alerts:scorecard");

// Daily Accountability scorecard — replaces the former `api/cron/overdue-alerts`, which
// pushed this every morning at 08:00 via Vercel Cron. There are no scheduled jobs in this
// application any more; someone presses a button instead.
//
// The guard is split on purpose, and the split is the point:
//   GET  — read the scorecard.       `reports.view`   (it is a report)
//   POST — send it over WhatsApp.    `settings.edit`  (it messages the phone numbers in
//          AlertConfig, and `settings.edit` is exactly what governs those numbers — see
//          api/alerts/config/route.ts). Seeing a number must not imply being able to
//          make someone's phone buzz.
// Neither needs a new permission, so no re-seed is required.

async function scorecard() {
  const data = await buildAccountabilityScorecard();
  return { scorecard: data, message: formatScorecardMessage(data) };
}

export async function GET() {
  try {
    await requireFeature("reports", "view");
    const { scorecard: data, message } = await scorecard();
    return successResponse({ scorecard: data, message, checkedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("scorecard build failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Could not build the scorecard", 500);
  }
}

export async function POST() {
  try {
    const user = await requireFeature("settings", "edit");
    const { scorecard: data, message } = await scorecard();

    const alertConfig = await prisma.alertConfig.findUnique({ where: { id: "singleton" } });
    const phones: string[] = alertConfig?.redFlagPhones
      ? alertConfig.redFlagPhones.split(",").map((p) => p.trim()).filter(Boolean)
      : [];

    const whatsappToken = process.env.WHATSAPP_TOKEN;
    const whatsappPhoneId = process.env.WHATSAPP_PHONE_ID;
    const configured = !!(whatsappToken && whatsappPhoneId);

    log.info("scorecard send requested", {
      userId: user.id, recipients: phones.length, whatsappConfigured: configured,
    });

    if (!configured) {
      log.warn("WhatsApp is not configured — returning the scorecard without sending");
      return successResponse({
        alertSent: false, scorecard: data, message, phones,
        whatsappConfigured: false,
        reason: "WhatsApp is not configured. The scorecard is returned here instead.",
      });
    }
    if (phones.length === 0) {
      log.warn("no alert phone numbers configured — nothing sent");
      return successResponse({
        alertSent: false, scorecard: data, message, phones: [],
        whatsappConfigured: true,
        reason: "No alert phone numbers are configured. Add them under Settings.",
      });
    }

    let sent = 0;
    const failures: string[] = [];

    for (const phone of phones) {
      const to = phone.replace(/\D/g, "");
      try {
        log.debug("-> WhatsApp send", { toLast4: to.slice(-4) });
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${whatsappPhoneId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${whatsappToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to,
              type: "text",
              text: { body: message },
            }),
          }
        );

        if (!res.ok) {
          // Read as text, not json: Graph can answer HTML through a proxy, and calling
          // .json() on that hides the real status behind a parse error.
          const body = (await res.text()).slice(0, 300);
          log.error("WhatsApp send rejected", { status: res.status, toLast4: to.slice(-4) });
          failures.push(`${phone}: ${res.status} — ${body}`);
        } else {
          sent++;
        }
      } catch (e) {
        log.error("WhatsApp send threw", {
          toLast4: to.slice(-4), error: e instanceof Error ? e.message : String(e),
        });
        failures.push(`${phone}: ${e instanceof Error ? e.message : "Send failed"}`);
      }
    }

    log.info("scorecard send finished", { sent, failed: failures.length });

    return successResponse({
      alertSent: sent > 0,
      sent,
      scorecard: data,
      message,
      phones,
      whatsappConfigured: true,
      whatsappErrors: failures.length > 0 ? failures : undefined,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("scorecard send failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Scorecard send failed", 500);
  }
}
