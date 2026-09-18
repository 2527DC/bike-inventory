export const dynamic = "force-dynamic";

export const runtime = "nodejs";
// nodejs, explicitly: this route holds a Google OAuth token and talks to the People API over
// HTTPS through Prisma-backed credentials. Not an edge workload.

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { GoogleContactsClient, googleContactsStatus } from "@/lib/integrations/google-contacts";
import { toPlus91 } from "@/lib/phone";
import { createLogger } from "@/lib/logger";

const log = createLogger("customers:google-sync");

/**
 * Sync chosen customers into the shop's Google account (plan 1709, R44, P14b, P14c, P14d).
 *
 * ─── WHY THIS IS THE ONLY WAY A CONTACT REACHES GOOGLE ────────────────────────────────────
 *
 * Save Customer on an outward writes the app's database and NOTHING else (P14c, P14d). Google is
 * never called from the counter, so Google can never slow down or block a sale. The Customers
 * list is where a person ticks who should be on the phones and presses Sync — which also covers
 * every customer created before this existed, so there is no separate backfill.
 *
 * ─── SEARCH FIRST, NEVER OVERWRITE ────────────────────────────────────────────────────────
 *
 * Per customer: search Google by phone. Found → record the id and report "already in Google",
 * leaving whatever is there untouched (P14b) — the shop's phone book may hold a better name than
 * an invoice did. Not found → create name, `+91-` phone, the alternate from the latest delivery,
 * a note naming the invoice and date, and the "BCH Customers" group.
 *
 * ─── ONE CUSTOMER'S FAILURE IS NOT THE BATCH'S ────────────────────────────────────────────
 *
 * Each customer is its own try: a 400 on one malformed number must not abandon the other 199.
 * The reason is stored on the row (`googleSyncError`) so the list can show it next week, not only
 * in a toast that disappears.
 */
const bodySchema = z.object({
  customerIds: z
    .array(z.string().min(1))
    .min(1, "Choose at least one customer.")
    // 200 per call: the People API allows one write per request, and a longer run would outlive
    // the request budget. The screen sends the next page itself.
    .max(200, "At most 200 customers in one sync. Do it in pages."),
});

type Outcome = "created" | "already" | "failed";

interface SyncResult {
  customerId: string;
  name: string;
  phone: string;
  outcome: Outcome;
  reason?: string;
}

/** Whether the Customers screen may show the Sync button — `customers.edit`, not `settings.edit`. */
export async function GET() {
  try {
    await requireFeature("customers", "edit");
    const status = await googleContactsStatus();
    // Deliberately NOT the whole status object: the client id and the error timestamp are an
    // admin's business, and this endpoint is open to anyone who may edit a customer.
    return successResponse({ connected: status.connected, accountEmail: status.accountEmail });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("google sync status failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not read the Google connection.", 500);
  }
}

export async function POST(req: NextRequest) {
  let requested = 0;
  try {
    await requireFeature("customers", "edit");
    const body = bodySchema.parse(await req.json());
    requested = body.customerIds.length;

    const client = await GoogleContactsClient.create();
    if (!client) {
      log.warn("google sync attempted while not connected", { requested });
      return errorResponse(
        "Google Contacts is not connected. An admin can connect it in Settings → Integrations.",
        409
      );
    }

    const customers = await prisma.customer.findMany({
      where: { id: { in: body.customerIds } },
      select: {
        id: true,
        name: true,
        phone: true,
        googleContactId: true,
        // The alternate number and the invoice for the note come from the latest outward (P14b).
        deliveries: {
          select: { invoiceNo: true, invoiceDate: true, alternatePhone: true },
          orderBy: { invoiceDate: "desc" },
          take: 1,
        },
      },
    });
    if (customers.length === 0) return errorResponse("None of those customers exist.", 404);

    const group = await client.ensureContactGroup();
    const results: SyncResult[] = [];

    for (const customer of customers) {
      const phone = toPlus91(customer.phone) ?? customer.phone;
      try {
        const existing = await client.findContactByPhone(customer.phone);
        if (existing) {
          await prisma.customer.update({
            where: { id: customer.id },
            data: { googleContactId: existing, googleSyncedAt: new Date(), googleSyncError: null },
          });
          results.push({ customerId: customer.id, name: customer.name, phone, outcome: "already" });
          continue;
        }

        const latest = customer.deliveries[0];
        const note = latest
          ? `BCH · ${latest.invoiceNo} · ${latest.invoiceDate.toLocaleDateString("en-IN")}`
          : "BCH";

        const resourceName = await client.createContact({
          name: customer.name,
          phone,
          alternatePhone: latest?.alternatePhone ?? null,
          note,
          groupResourceName: group,
        });

        await prisma.customer.update({
          where: { id: customer.id },
          data: { googleContactId: resourceName, googleSyncedAt: new Date(), googleSyncError: null },
        });
        results.push({ customerId: customer.id, name: customer.name, phone, outcome: "created" });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // Every catch logs (CLAUDE.md), then stores the reason so it survives the toast.
        log.warn("customer sync failed", { customerId: customer.id, reason });
        try {
          await prisma.customer.update({
            where: { id: customer.id },
            data: { googleSyncError: reason.slice(0, 500) },
          });
        } catch (writeErr) {
          log.error("could not record googleSyncError", {
            customerId: customer.id,
            message: writeErr instanceof Error ? writeErr.message : String(writeErr),
          });
        }
        results.push({ customerId: customer.id, name: customer.name, phone, outcome: "failed", reason });
      }
    }

    const created = results.filter((r) => r.outcome === "created").length;
    const already = results.filter((r) => r.outcome === "already").length;
    const failed = results.filter((r) => r.outcome === "failed").length;

    // `lastSyncAt` on the integration row is what the settings card shows as "last used".
    try {
      await prisma.integrationConfig.updateMany({
        where: { provider: "google_contacts" },
        data: { lastSyncAt: new Date() },
      });
    } catch (err) {
      log.warn("could not stamp lastSyncAt", { message: err instanceof Error ? err.message : String(err) });
    }

    log.info("google contact sync finished", { requested, created, already, failed });
    return successResponse({ created, already, failed, results });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid sync request", 400);
    }
    log.error("google contact sync failed", {
      requested,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Google sync failed", 500);
  }
}
