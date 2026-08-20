export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { customerSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("customers", "view");
    const { page, limit, skip, search } = parseSearchParams(req.url);

    const where = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    };

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        select: {
          id: true, name: true, phone: true, email: true,
          type: true, isActive: true, createdAt: true,
          _count: { select: { invoices: true, payments: true } },
        },
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.customer.count({ where }),
    ]);

    return paginatedResponse(customers, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch customers", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("customers", "create");
    const body = await req.json();
    const data = customerSchema.parse(body);

    // Find existing customer by name (case-insensitive) or create new
    const existing = await prisma.customer.findFirst({
      where: { name: { equals: data.name, mode: "insensitive" } },
    });

    if (existing) {
      return successResponse(existing);
    }

    const customer = await prisma.customer.create({
      data: {
        name: data.name,
        phone: data.phone,
        email: data.email || null,
        address: data.address,
        type: data.type || "WALK_IN",
      },
    });

    return successResponse(customer, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create customer", 400);
  }
}
