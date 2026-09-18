export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { isDummy } from "@/lib/deliveries/floor-stock";
import { recordApprovalEvent } from "@/lib/approvals/events";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:api");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  try {
    const user = await requireFeature("deliveries", "create");
    const { id } = await params;
    deliveryId = id;
    const body = await req.json();
    const reason = body.reason as string;

    if (!reason) return errorResponse("Flag reason is required", 400);

    const delivery = await prisma.delivery.findUnique({ where: { id } });
    if (!delivery) return errorResponse("Delivery not found", 404);

    // A Dummy takes no action (A41b, T2).
    if (isDummy(delivery)) {
      log.warn("flag refused: dummy delivery", { deliveryId: id, invoiceNo: delivery.invoiceNo });
      return errorResponse("Dummy delivery: no warehouse matched this invoice number. No actions are allowed.", 409);
    }

    if (delivery.status !== "PENDING") {
      return errorResponse("Can only flag PENDING deliveries", 400);
    }

    // Plan 1709, R26: a flag on an APPROVED outward is evidence against the approval, so the
    // flag and its event commit together (approvals/events.ts) — if the event cannot be written
    // the flag does not happen either. `approverId` is the person who approved it, not the
    // person raising the flag, because that is whose judgement the error rate counts.
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.delivery.update({
        where: { id },
        data: {
          status: "FLAGGED",
          flagReason: reason,
          flaggedAt: new Date(),
        },
      });
      await recordApprovalEvent(tx, {
        activity: "OUTBOUND",
        event: "FLAGGED",
        recordId: id,
        recordRef: row.invoiceNo,
        actorId: user.id,
        approverId: row.approvedById,
        warehouseId: row.warehouseId,
        note: reason,
      });
      return row;
    });

    // Get alert config for WhatsApp numbers
    const alertConfig = await prisma.alertConfig.findUnique({ where: { id: "singleton" } });
    const phones = alertConfig?.redFlagPhones?.split(",").map((p) => p.trim()).filter(Boolean) || [];

    log.info("delivery flagged", { deliveryId: id, invoiceNo: delivery.invoiceNo });

    return successResponse({
      delivery: updated,
      alertPhones: phones,
      whatsappMessage: `*RED FLAG* — Invoice ${delivery.invoiceNo}\nCustomer: ${delivery.customerName}\nAmount: ₹${delivery.invoiceAmount}\nReason: ${reason}\nTime: ${new Date().toLocaleString("en-IN")}`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("flag refused", { deliveryId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    log.error("flag failed", { deliveryId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to flag delivery", 400);
  }
}
