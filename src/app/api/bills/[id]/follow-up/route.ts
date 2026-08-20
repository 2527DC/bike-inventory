export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { billFollowUpSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("bills", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = billFollowUpSchema.parse(body);

    const bill = await prisma.vendorBill.update({
      where: { id },
      data: {
        lastFollowedUp: new Date(),
        nextFollowUpDate: data.nextFollowUpDate ? new Date(data.nextFollowUpDate) : null,
        followUpNotes: data.followUpNotes,
      },
      include: { vendor: { select: { name: true, phone: true, whatsappNumber: true } } },
    });

    return successResponse(bill);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update follow-up", 400);
  }
}
