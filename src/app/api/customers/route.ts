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
    // WALK_IN | REGULAR | DEALER. Not validated against the enum here — an unknown value
    // simply matches nothing, which is the honest answer for a bad query string.
    const type = req.nextUrl.searchParams.get("type") || undefined;

    const where = {
      ...(type && { type: type as never }),
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
          // whatsapp and address were on the model but not returned. Both are things a
          // person needs to see next to a phone number.
          whatsapp: true, address: true,
          type: true, isActive: true, createdAt: true,
          _count: { select: { invoices: true, payments: true } },
        },
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.customer.count({ where }),
    ]);

    // ── Outstanding, in ONE query for the page — never one sum per row.
    //
    // The obvious implementation is a per-customer aggregate inside a map. Do not write that.
    // This codebase has already paid for it: the Zoho import ran two queries per record
    // across Mumbai→Singapore and died at maxDuration. The list is paginated, so a single
    // groupBy over the page ids costs one round trip regardless of page size.
    //
    // CustomerInvoice already carries @@index([customerId]) and @@index([status]).
    const ids = customers.map((c) => c.id);
    const owed = ids.length
      ? await prisma.customerInvoice.groupBy({
          by: ["customerId"],
          where: { customerId: { in: ids }, status: { not: "PAID" } },
          _sum: { amount: true, paidAmount: true },
        })
      : [];

    const outstandingById = new Map(
      owed.map((o) => [o.customerId, (o._sum.amount ?? 0) - (o._sum.paidAmount ?? 0)])
    );

    const shaped = customers.map((c) => ({
      ...c,
      outstanding: outstandingById.get(c.id) ?? 0,
    }));

    return paginatedResponse(shaped, total, page, limit);
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

    // Phone is the identity, not the name — two different walk-ins are frequently called
    // the same thing, and matching on name merged their records. Matching on phone also
    // means the counter and the workshop resolve to the same customer row.
    const existing = await prisma.customer.findUnique({ where: { phone: data.phone } });

    if (existing) {
      return successResponse(existing);
    }

    const customer = await prisma.customer.create({
      data: {
        name: data.name,
        phone: data.phone,
        whatsapp: data.whatsapp || null,
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
