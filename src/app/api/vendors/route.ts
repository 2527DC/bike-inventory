export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { vendorSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("vendors", "view");
    const { page, limit, skip, search } = parseSearchParams(req.url);

    const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "true";

    const where = {
      ...(!includeInactive && { isActive: true }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { code: { contains: search, mode: "insensitive" as const } },
          { city: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    };

    const [vendors, total] = await Promise.all([
      prisma.vendor.findMany({
        where,
        select: {
          id: true, name: true, code: true, city: true, phone: true,
          whatsappNumber: true, isActive: true, paymentTermDays: true,
          _count: { select: { purchaseOrders: true, bills: true } },
          bills: {
            where: { status: { not: "PAID" } },
            select: { amount: true, paidAmount: true },
          },
        },
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.vendor.count({ where }),
    ]);

    // Compute outstanding balance per vendor
    const vendorsWithBalance = vendors.map((v) => {
      const balance = v.bills.reduce((sum, b) => sum + (b.amount - b.paidAmount), 0);
      const { bills: _bills, ...rest } = v;
      return { ...rest, outstandingBalance: balance };
    });

    return paginatedResponse(vendorsWithBalance, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch vendors", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("vendors", "create");
    const body = await req.json();
    const data = vendorSchema.parse(body);

    const vendor = await prisma.vendor.create({
      data,
      include: { contacts: true },
    });

    return successResponse(vendor, 201);
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(error instanceof Error ? error.message : "Failed to create vendor", 400);
  }
}
