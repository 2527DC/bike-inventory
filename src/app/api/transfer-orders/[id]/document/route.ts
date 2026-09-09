export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { z } from "zod";
import { docTypeLabel } from "@/lib/transfers/policy";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfer-orders:document");

const schema = z.object({
  docType: z.enum(["DELIVERY_CHALLAN", "TAX_INVOICE"]),
  // Optional since 9 Sep 2026 (owner: "it's just we upload a file"). Blank is stored as null.
  docNumber: z.string().trim().max(40).optional(),
  docDate: z.string().optional(),
  docUrl: z.string().min(1, "The uploaded file is required"),
  eWayBillNo: z.string().trim().max(30).optional(),
});

/**
 * POST: attach (or replace) the document this transfer has to travel with.
 *
 * ─── UPLOAD-ONLY IN v1, AND THAT IS A DECISION, NOT A GAP ─────────────────────────────────
 *
 * The tax invoice is raised in Zoho Books, which is the tax system of record, and the PDF is
 * uploaded here. This application deliberately does NOT generate one: an app-issued invoice
 * would create a second invoice series alongside Zoho's, and two series against one GSTIN is
 * the kind of thing that is discovered during an audit rather than during a release. An
 * in-app delivery challan — which carries no series and no tax — is a later, safer step.
 *
 * ─── WHY THE URL IS CHECKED AGAINST THE ORDER NUMBER ──────────────────────────────────────
 *
 * `docUrl` arrives from the browser after a direct-to-bucket upload, so it is a client-supplied
 * string that the server never saw written. Without the prefix check, a caller could point one
 * transfer's document record at another transfer's invoice — or at any object in the bucket
 * under an allowed prefix. Requiring `transfers/<orderNo>/` means the record can only name a
 * file filed under this order.
 *
 * ─── REPLACE UNTIL DISPATCH, NEVER AFTER ──────────────────────────────────────────────────
 *
 * Before the van leaves, a wrong attachment is a typo. After it leaves, the document is what
 * the driver is physically carrying and what an officer at a checkpoint would be shown — so
 * changing the record would make this app disagree with the paper in the cab.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("transfers", "view");
    const { id } = await params;
    const body = await req.json();
    const input = schema.parse(body);

    const order = await prisma.transferOrder.findUnique({
      where: { id },
      select: {
        id: true,
        orderNo: true,
        status: true,
        createdById: true,
        requiredDocType: true,
        docUrl: true,
      },
    });
    if (!order) return errorResponse("Transfer order not found", 404);

    const canEdit = await userCan(user.id, "transfers", "edit");
    if (!canEdit && order.createdById !== user.id) {
      return errorResponse("You can only attach a document to a transfer you raised.", 403);
    }

    if (order.status !== "PENDING" && order.status !== "APPROVED") {
      return errorResponse(
        order.status === "IN_TRANSIT"
          ? "This transfer has already been dispatched — its document cannot be changed."
          : `A ${order.status.toLowerCase().replace(/_/g, " ")} transfer cannot take a document.`,
        409
      );
    }

    if (order.requiredDocType && input.docType !== order.requiredDocType) {
      return errorResponse(
        `This transfer needs a ${docTypeLabel(order.requiredDocType)}, not a ${docTypeLabel(input.docType)}.`,
        400
      );
    }

    // The uploaded file must be filed under THIS order. See the header.
    const expectedPrefix = `transfers/${order.orderNo}/`;
    if (!input.docUrl.includes(expectedPrefix)) {
      log.warn("document url outside the order's folder", { orderId: order.id, orderNo: order.orderNo });
      return errorResponse("That file was not uploaded for this transfer.", 400);
    }

    let docDate: Date | null = null;
    if (input.docDate) {
      const parsed = new Date(input.docDate);
      if (Number.isNaN(parsed.getTime())) return errorResponse("That document date is not a valid date.", 400);
      docDate = parsed;
    }

    const replacing = Boolean(order.docUrl);

    await prisma.transferOrder.update({
      where: { id },
      data: {
        docType: input.docType,
        docNumber: input.docNumber?.trim() || null,
        docDate,
        docUrl: input.docUrl,
        docUploadedById: user.id,
        docUploadedAt: new Date(),
        ...(input.eWayBillNo?.trim() ? { eWayBillNo: input.eWayBillNo.trim() } : {}),
      },
    });

    await logActivity(prisma, {
      module: "transfers",
      action: replacing ? "updated" : "document_attached",
      entityType: "TransferOrder",
      entityId: order.id,
      entityRef: order.orderNo,
      details: `${docTypeLabel(input.docType)}${input.docNumber?.trim() ? ` ${input.docNumber.trim()}` : ""}${replacing ? " (replaced)" : ""}`,
      userId: user.id,
      userName: user.name,
    });

    log.info("transfer document attached", {
      orderId: order.id,
      orderNo: order.orderNo,
      docType: input.docType,
      replacing,
    });

    return successResponse({ message: replacing ? "Document replaced" : "Document attached" });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid document details", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to attach the document";
    log.error("transfer document failed", { message });
    return errorResponse(message, 400);
  }
}
