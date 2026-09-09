export const dynamic = "force-dynamic";
// jspdf's node build statically requires fs and path; nodemailer needs real sockets.
export const runtime = "nodejs";
// Rendering the PDF and handing it to Gmail over a per-call transport. The binding constraint
// is actually the transport's own socketTimeout of 30s, not this — see the note on
// EmailMessage.attachments — but a route that renders and sends should not run on the default.
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { sendEmail, maskEmail } from "@/lib/notify/email";
import { NotConfiguredError } from "@/lib/notify/types";
import { renderPurchaseOrderPdf, type PoPdfLine } from "@/lib/purchase-orders/pdf";
import { loadCompanyIdentity } from "@/lib/purchase-orders/company";
import { buildPoEmail } from "@/lib/purchase-orders/email";
import { logActivity } from "@/lib/activity-log";
import { tryGetStorage } from "@/lib/storage";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:send");

const sendSchema = z.object({
  to: z.string().email("That does not look like an email address").optional(),
  cc: z.string().email("That does not look like an email address").optional().or(z.literal("")),
  note: z.string().max(1000).optional(),
});

/** A send is refused this close to the previous one. */
const RESEND_COOLDOWN_MS = 60_000;
/** A PENDING row older than this was abandoned by a crash, not still in flight. */
const STALE_PENDING_MS = 5 * 60_000;

/**
 * Email the purchase order to the vendor, with the PDF attached.
 *
 * ─── DELIVERY IS AT-LEAST-ONCE, AND THIS ROUTE SAYS SO ───────────────────────────────────
 *
 * Between Gmail accepting the message and this process recording that it did, there is a
 * window. A crash or a timeout in that window leaves a send that HAPPENED with a row that says
 * PENDING. Nothing can close that gap over SMTP; what can be done is make it small and make it
 * visible:
 *
 *   1. The `PurchaseOrderSend` row is written PENDING **before** the SMTP call, so a
 *      double-tap mid-flight is caught by the cooldown below rather than sending twice.
 *   2. The moment `sendMail` resolves, ONE narrow update stamps the messageId. The crash
 *      window is that single statement wide, not the whole transaction that follows.
 *   3. On entry, any PENDING row older than five minutes is marked FAILED with
 *      "unknown — timed out", so a stale row never blocks a retry or reads as in-flight.
 *
 * A row carrying a messageId whose purchase order never flipped is therefore "sent, not
 * confirmed" — and the vendor's own copy is the tiebreaker, which is why the PDF filename
 * carries the PO number and why `sendCount` increments.
 *
 * ─── WHY THIS DOES NOT ASK canTransition ─────────────────────────────────────────────────
 *
 * A RESEND is legal from SENT_TO_VENDOR, and `PO_TRANSITIONS` has no self-edge there — asking
 * the table would refuse every resend with a 409. So the state check is explicit, and the
 * status flip is claimed only on the FIRST send, with `status: "APPROVED"` in the WHERE.
 * (Getting this wrong in the other direction is exactly what made mark-sent dead code in P9.)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("purchase_orders", "edit");
    const { id } = await params;

    const parsed = sendSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const { to: toOverride, cc, note } = parsed.data;

    // Sweep first: a row abandoned by a crash must not make the cooldown below refuse a
    // legitimate retry for ever.
    const swept = await prisma.purchaseOrderSend.updateMany({
      where: {
        purchaseOrderId: id,
        status: "PENDING",
        attemptedAt: { lt: new Date(Date.now() - STALE_PENDING_MS) },
      },
      data: { status: "FAILED", error: "unknown — timed out before the result was recorded" },
    });
    if (swept.count > 0) {
      log.warn("swept stale pending sends", { poId: id, count: swept.count });
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true, poNumber: true, status: true, sendCount: true,
        orderDate: true, expectedDate: true, notes: true, deliveryAddress: true,
        subtotal: true, gstTotal: true, grandTotal: true,
        approvedAt: true, approvedBy: { select: { name: true } },
        vendor: {
          select: {
            name: true, code: true, email: true,
            addressLine1: true, addressLine2: true, city: true, state: true, pincode: true,
            gstin: true, phone: true,
            contacts: {
              select: { name: true, email: true, isPrimary: true },
              orderBy: { isPrimary: "desc" },
            },
          },
        },
        items: {
          select: {
            // `name` is the line's own description (plan 0909, D2); the product is optional.
            name: true, quantity: true, unitPrice: true, gstRate: true, amount: true,
            product: { select: { sku: true, hsnCode: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        sends: {
          select: { id: true, status: true, attemptedAt: true },
          orderBy: { attemptedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!po) return errorResponse("Purchase order not found", 404);

    if (po.status !== "APPROVED" && po.status !== "SENT_TO_VENDOR") {
      return errorResponse("This purchase order must be approved before it can be sent", 409);
    }

    // Recipient: what the sheet typed, else the vendor's billing address, else the primary
    // contact's. `contacts` is SORTED not filtered — nothing in the database guarantees a
    // primary exists, so take the first one that actually has an address.
    const recipient =
      toOverride ??
      po.vendor.email ??
      po.vendor.contacts.find((c) => c.email)?.email ??
      null;
    if (!recipient) {
      return errorResponse(
        "This vendor has no email address. Enter one below, or add it on the vendor's page.",
        400
      );
    }

    const last = po.sends[0];
    if (last && last.status !== "FAILED" && Date.now() - last.attemptedAt.getTime() < RESEND_COOLDOWN_MS) {
      return errorResponse(
        "This purchase order was sent moments ago. Wait a minute before sending it again.",
        429
      );
    }

    const company = await loadCompanyIdentity();
    const items: PoPdfLine[] = po.items.map((it) => ({
      sku: it.product?.sku ?? null,
      name: it.name,
      hsnCode: it.product?.hsnCode ?? null,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      gstRate: it.gstRate,
      amount: it.amount,
    }));

    // PENDING before the SMTP call, so a second request in flight sees it via the cooldown.
    const sendRow = await prisma.purchaseOrderSend.create({
      data: {
        purchaseOrderId: id,
        channel: "EMAIL",
        status: "PENDING",
        toEmail: recipient,
        ccEmail: cc || null,
        note: note ?? null,
        sentById: user.id,
        sentByName: user.name,
      },
      select: { id: true },
    });

    const failRow = (error: string) =>
      prisma.purchaseOrderSend.update({
        where: { id: sendRow.id },
        data: { status: "FAILED", error, completedAt: new Date() },
      });

    let pdf: Buffer;
    try {
      pdf = await renderPurchaseOrderPdf(
        {
          poNumber: po.poNumber,
          orderDate: po.orderDate,
          expectedDate: po.expectedDate,
          notes: po.notes,
          deliveryAddress: po.deliveryAddress,
          subtotal: po.subtotal,
          gstTotal: po.gstTotal,
          grandTotal: po.grandTotal,
          approvedByName: po.approvedBy?.name ?? null,
          approvedAt: po.approvedAt,
          vendor: {
            name: po.vendor.name,
            code: po.vendor.code,
            address: [po.vendor.addressLine1, po.vendor.addressLine2].filter(Boolean).join(", ") || null,
            city: po.vendor.city,
            state: po.vendor.state,
            pincode: po.vendor.pincode,
            gstin: po.vendor.gstin,
            phone: po.vendor.phone,
            contactName: po.vendor.contacts[0]?.name ?? null,
          },
          items,
        },
        company
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not render the purchase order";
      await failRow(message);
      log.error("pdf render failed during send", { poId: id, message });
      return errorResponse(message, 500);
    }

    const subject = buildPoEmail(
      {
        poNumber: po.poNumber,
        orderDate: po.orderDate,
        expectedDate: po.expectedDate,
        itemCount: po.items.length,
        grandTotal: po.grandTotal,
        vendorName: po.vendor.name,
        note,
      },
      company
    );

    let result;
    try {
      result = await sendEmail(
        { email: recipient, name: po.vendor.name },
        {
          ...subject,
          ...(cc ? { cc } : {}),
          attachments: [
            { filename: `${po.poNumber}.pdf`, content: pdf, contentType: "application/pdf" },
          ],
        }
      );
    } catch (e) {
      // Not configured is a THROW, not a result — and it is not the same as a send that
      // failed. 503 says "the app cannot send at all", which is an admin's job, not the
      // buyer's. A raw database error from loadSettings falls through to the outer catch.
      if (e instanceof NotConfiguredError) {
        await failRow(e.message);
        log.warn("send attempted while email is not configured", { poId: id });
        return errorResponse(e.message, 503);
      }
      throw e;
    }

    if (!result.ok) {
      await failRow(result.error);
      log.error("purchase order email rejected", { poId: id, to: maskEmail(recipient) });
      // The PO is untouched: an email that did not go is not a send.
      return errorResponse(result.error, 502);
    }

    // ⚠ The narrowest possible statement, immediately. Everything after this can fail without
    // losing the fact that Gmail accepted the message.
    await prisma.purchaseOrderSend.update({
      where: { id: sendRow.id },
      data: { status: "SENT", messageId: result.id ?? null, completedAt: new Date() },
    });

    // Best effort, and genuinely optional: a copy of the exact bytes the vendor received. The
    // PDF is re-rendered on demand elsewhere, and a re-render after an amendment is NOT what
    // was sent — this is the only artefact that answers "what did they actually get".
    let pdfUrl: string | null = null;
    try {
      const storage = await tryGetStorage();
      if (storage) {
        pdfUrl = await storage.put(
          `purchase-orders/${po.poNumber}/${sendRow.id}.pdf`,
          pdf,
          "application/pdf"
        );
      }
    } catch (e) {
      // Never fails the send. The email is already in the vendor's inbox; refusing to record
      // that because a bucket was unreachable would be the wrong trade.
      log.warn("could not archive the sent pdf", {
        poId: id,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      if (pdfUrl) {
        await tx.purchaseOrderSend.update({ where: { id: sendRow.id }, data: { pdfUrl } });
      }

      // Claimed only on the FIRST send: status flips from APPROVED, and a resend leaves it
      // alone. `sentAt` uses the same rule — it means "when did this first go out".
      await tx.purchaseOrder.updateMany({
        where: { id, status: "APPROVED" },
        data: { status: "SENT_TO_VENDOR", sentAt: now },
      });

      await tx.purchaseOrder.update({
        where: { id },
        data: {
          sentById: user.id,
          sentToEmail: recipient,
          sentVia: "EMAIL",
          sendCount: { increment: 1 },
        },
      });

      await logActivity(tx, {
        module: "purchase_orders",
        action: "sent",
        entityType: "PurchaseOrder",
        entityId: id,
        entityRef: po.poNumber,
        fromValue: po.status,
        toValue: "SENT_TO_VENDOR",
        // The masked address: the activity feed is readable by anyone holding activity.view,
        // which is wider than the people who may see a vendor's contact details.
        details: `Emailed to ${maskEmail(recipient)}${po.sendCount > 0 ? ` (send ${po.sendCount + 1})` : ""}`,
        userId: user.id,
        userName: user.name,
      });
    });

    log.info("purchase order emailed", {
      poId: id,
      poNumber: po.poNumber,
      to: maskEmail(recipient),
      messageId: result.id,
      sendCount: po.sendCount + 1,
      archived: Boolean(pdfUrl),
    });

    return successResponse({
      sent: true,
      to: recipient,
      filename: `${po.poNumber}.pdf`,
      sendCount: po.sendCount + 1,
      messageId: result.id ?? null,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to send the purchase order";
    log.error("send failed", { message });
    return errorResponse(message, 500);
  }
}
