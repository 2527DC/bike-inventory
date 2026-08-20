export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, parseSearchParams } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { preBookingSchema } from "@/lib/validations";

// GET: List pre-bookings
export async function GET(req: NextRequest) {
  try {
    await requireFeature("deliveries", "view");
    const { limit, skip, searchParams } = parseSearchParams(req.url);
    const status = searchParams.get("status") || undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (status && status !== "ALL") where.status = status;

    const [preBookings, total] = await Promise.all([
      prisma.preBooking.findMany({
        where,
        include: {
          brand: { select: { name: true } },
          createdBy: { select: { name: true } },
          matchedShipment: {
            select: { id: true, shipmentNo: true, expectedDeliveryDate: true, status: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.preBooking.count({ where }),
    ]);

    return successResponse({ preBookings, total });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// POST: Create pre-booking (from Zoho invoice or manual)
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("deliveries", "create");
    const body = await req.json();
    const data = preBookingSchema.parse(body);

    const preBooking = await prisma.preBooking.create({
      data: {
        customerName: data.customerName,
        customerPhone: data.customerPhone || null,
        zohoInvoiceNo: data.zohoInvoiceNo,
        productName: data.productName,
        salesPerson: data.salesPerson || null,
        brandId: data.brandId || null,
        createdById: user.id,
      },
      include: {
        brand: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });

    return successResponse(preBooking, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
