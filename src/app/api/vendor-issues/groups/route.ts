export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// PATCH — set ONLY a vendor's WhatsApp group name/code (the Ops Issues routing label).
//
// Gated identically to the Ops Issues page "view" (same feature + fallback roles), so anyone
// who can use that page — including CUSTOM roles granted vendor_issues access, like the ops
// manager — can map groups. It writes nothing sensitive (no GST, credit, payment terms, stock,
// or financials): just the two label fields used when sharing issues to WhatsApp.
export async function PATCH(req: NextRequest) {
  try {
    await requireFeature("vendor_issues", "view");

    const body = await req.json();
    const { vendorId, waGroupName, waGroupCode } = body as {
      vendorId?: string;
      waGroupName?: string;
      waGroupCode?: string;
    };
    if (!vendorId) return errorResponse("vendorId is required", 400);

    const vendor = await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        waGroupName: (waGroupName ?? "").trim() || null,
        waGroupCode: (waGroupCode ?? "").trim() || null,
      },
      select: { id: true, waGroupName: true, waGroupCode: true },
    });

    return successResponse(vendor);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to save group", 400);
  }
}
