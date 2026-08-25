export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { buildAccountabilityScorecard, formatScorecardMessage } from "@/lib/accountability";
import { createLogger } from "@/lib/logger";

const log = createLogger("cron:overdue-alerts");

// Vercel Cron: daily 8 AM — "0 8 * * *" (see vercel.json).
// Pushes the Daily Accountability scorecard every morning (the REVIEW step of
// the system loop) so the founder + Checker get the number without pulling it.
export async function GET(req: NextRequest) {
  try {
    // Verify cron secret (same pattern as zoho-pull)
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      return errorResponse("CRON_SECRET not configured", 500);
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      return errorResponse("Unauthorized", 401);
    }

    const now = new Date();

    // Build the daily accountability scorecard + WhatsApp message
    const scorecard = await buildAccountabilityScorecard();
    const message = formatScorecardMessage(scorecard);

    // Fetch alert phone numbers from AlertConfig
    const alertConfig = await prisma.alertConfig.findUnique({
      where: { id: "singleton" },
    });

    const phones: string[] = alertConfig?.redFlagPhones
      ? alertConfig.redFlagPhones.split(",").map((p) => p.trim()).filter(Boolean)
      : [];

    let whatsappSent = false;
    const whatsappErrors: string[] = [];

    // If WHATSAPP_TOKEN exists, attempt to send via WhatsApp Cloud API
    const whatsappToken = process.env.WHATSAPP_TOKEN;
    const whatsappPhoneId = process.env.WHATSAPP_PHONE_ID;

    if (whatsappToken && whatsappPhoneId && phones.length > 0) {
      for (const phone of phones) {
        try {
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
                to: phone.replace(/\D/g, ""), // strip non-digits
                type: "text",
                text: { body: message },
              }),
            }
          );

          if (!res.ok) {
            const errBody = await res.text();
            whatsappErrors.push(`Phone ${phone}: ${res.status} — ${errBody}`);
          } else {
            whatsappSent = true;
          }
        } catch (e) {
          whatsappErrors.push(
            `Phone ${phone}: ${e instanceof Error ? e.message : "Send failed"}`
          );
        }
      }
    } else if (phones.length > 0) {
      // No WhatsApp token — data still returned in response for manual review
      log.warn("WhatsApp token not configured — scorecard returned in the response only", {
        recipients: phones.length,
      });
    }

    return successResponse({
      alertSent: whatsappSent,
      scorecard,
      message,
      phones,
      whatsappConfigured: !!(whatsappToken && whatsappPhoneId),
      whatsappErrors: whatsappErrors.length > 0 ? whatsappErrors : undefined,
      checkedAt: now.toISOString(),
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Daily accountability push failed",
      500
    );
  }
}
