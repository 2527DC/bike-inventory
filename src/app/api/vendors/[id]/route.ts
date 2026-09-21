export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { vendorUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendors:detail");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("vendors", "view");
    const { id } = await params;
    const vendor = await prisma.vendor.findUnique({
      where: { id },
      include: {
        // No `contacts`: the vendor's one contact is on the Vendor row itself since plan 2109
        // R28 (contactPerson / contactDesignation / phone / email / whatsappNumber).
        purchaseOrders: { orderBy: { createdAt: "desc" }, take: 10, include: { items: true } },
        bills: { orderBy: { dueDate: "asc" }, take: 10, include: { payments: true } },
        credits: { orderBy: { creditDate: "desc" }, take: 10 },
        // The brands this vendor supplies. Read by the "Brands supplied" chips on
        // /vendors/[id], and the reason vendor resolution tiers 2 and 3 have any data at all.
        // Shaped like the ledger routes already shape it (api/ledger/vendors/route.ts) so the
        // two screens agree on what a brand chip looks like.
        brands: {
          select: { isPrimary: true, brand: { select: { id: true, name: true } } },
          orderBy: { brand: { name: "asc" } },
        },
        _count: { select: { issues: true } },
      },
    });

    if (!vendor) return errorResponse("Vendor not found", 404);
    return successResponse(vendor);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("vendor fetch failed", { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch vendor", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("vendors", "edit");
    const { id } = await params;
    const body = await req.json();
    const parsed = vendorUpdateSchema.parse(body);

    // The contact block (plan 2109 R28) sends "" for a cleared field; store it as null so a
    // cleared phone is "no phone", not a blank string that `??` fallbacks would treat as set.
    const data: Prisma.VendorUpdateInput = { ...parsed };
    for (const key of ["contactPerson", "contactDesignation", "phone", "email", "whatsappNumber"] as const) {
      if (parsed[key] !== undefined) data[key] = parsed[key]?.trim() || null;
    }

    const vendor = await prisma.vendor.update({ where: { id }, data });

    log.info("vendor updated", { vendorId: id, fields: Object.keys(data) });
    return successResponse(vendor);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.warn("vendor update failed", { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to update vendor", 400);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("vendors", "delete");
    const { id } = await params;

    await prisma.vendor.update({ where: { id }, data: { isActive: false } });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.warn("vendor deactivate failed", { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to delete vendor", 400);
  }
}
