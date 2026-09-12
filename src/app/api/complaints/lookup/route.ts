export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("complaints", "view");
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code")?.trim();

    if (!code) {
      return errorResponse("Bicycle unit code is required (e.g. U-000001)", 400);
    }

    const unit = await prisma.inventoryUnit.findFirst({
      where: {
        unitCode: { equals: code, mode: "insensitive" },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            brand: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
          },
        },
        warehouse: { select: { id: true, name: true } },
        bin: { select: { id: true, code: true, name: true, directions: true } },
        assembledBy: { select: { id: true, name: true, email: true } },
        complaints: {
          select: {
            id: true,
            ticketNo: true,
            customerName: true,
            description: true,
            isAssemblyFault: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!unit) {
      return errorResponse(`No bicycle found with unit code "${code}". Make sure the code is correct.`, 404);
    }

    return successResponse(unit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to lookup bicycle unit", 500);
  }
}
