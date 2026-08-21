// Owner alerting for store analytics.
//
// Recipients come from AlertConfig.redFlagPhones and delivery goes through the WhatsApp Cloud
// API — the same mechanism api/cron/overdue-alerts already uses. That route inlines its own
// copy of the send loop; this module is the extracted version. Folding overdue-alerts onto it
// is a worthwhile follow-up but is deliberately NOT done here: it is working production code
// that cannot be exercised without live WhatsApp credentials, and a phase-7 change should not
// put an existing daily alert at risk.
//
// Failure policy: sending is best-effort and never throws. A watchdog that crashes because
// WhatsApp is down stops watching, which is the opposite of what it is for. The caller gets a
// result object and reports it in the cron response, where it lands in the Vercel log.

import { prisma } from "@/lib/db";

export interface AlertResult {
  attempted: number;
  sent: number;
  /** Why nothing was sent, when nothing was sent. Surfaced in the cron response. */
  skipped: string | null;
  errors: string[];
}

export async function sendOwnerAlert(message: string): Promise<AlertResult> {
  const result: AlertResult = { attempted: 0, sent: 0, skipped: null, errors: [] };

  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    result.skipped = "WHATSAPP_TOKEN / WHATSAPP_PHONE_ID not configured";
    return result;
  }

  const config = await prisma.alertConfig.findUnique({ where: { id: "singleton" } });
  const phones = (config?.redFlagPhones ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (phones.length === 0) {
    result.skipped = "no recipients: set AlertConfig.redFlagPhones";
    return result;
  }

  result.attempted = phones.length;

  for (const phone of phones) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone.replace(/\D/g, ""),
          type: "text",
          text: { body: message },
        }),
      });
      if (res.ok) result.sent++;
      else result.errors.push(`${phone}: ${res.status} ${(await res.text()).slice(0, 120)}`);
    } catch (e) {
      result.errors.push(`${phone}: ${e instanceof Error ? e.message : "send failed"}`);
    }
  }

  return result;
}
