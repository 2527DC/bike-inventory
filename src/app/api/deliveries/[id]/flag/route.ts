export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("deliveries", "create");
    const { id } = await params;
    const body = await req.json();
    const reason = body.reason as string;

    if (!reason) return errorResponse("Flag reason is required", 400);

    const delivery = await prisma.delivery.findUnique({ where: { id } });
    if (!delivery) return errorResponse("Delivery not found", 404);

    if (delivery.status !== "PENDING") {
      return errorResponse("Can only flag PENDING deliveries", 400);
    }

    const updated = await prisma.delivery.update({
      where: { id },
      data: {
        status: "FLAGGED",
        flagReason: reason,
        flaggedAt: new Date(),
      },
    });

    // Get alert config for WhatsApp numbers
    const alertConfig = await prisma.alertConfig.findUnique({ where: { id: "singleton" } });
    const phones = alertConfig?.redFlagPhones?.split(",").map((p) => p.trim()).filter(Boolean) || [];

    return successResponse({
      delivery: updated,
      alertPhones: phones,
      whatsappMessage: `*RED FLAG* — Invoice ${delivery.invoiceNo}\nCustomer: ${delivery.customerName}\nAmount: ₹${delivery.invoiceAmount}\nReason: ${reason}\nTime: ${new Date().toLocaleString("en-IN")}`,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to flag delivery", 400);
  }
}
