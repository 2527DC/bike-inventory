export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("customers", "view");
    const { id } = await params;

    const invoice = await prisma.customerInvoice.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
        payments: {
          orderBy: { paymentDate: "desc" },
          include: { recordedBy: { select: { name: true } } },
        },
      },
    });

    if (!invoice) return errorResponse("Invoice not found", 404);
    return successResponse(invoice);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch invoice", 500);
  }
}
