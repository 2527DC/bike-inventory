export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { vendorSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendors:list");

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
          // Carried-forward balance as of 1 Apr 2026. The detail route returns it because it
          // uses `include`; this `select` silently dropped it, so /vendors showed blank.
          openingBalance: true,
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

    // Open credit per vendor on this page (plan 1210 Part 6.1, R11): the unused part of each
    // OPEN credit note, one GROUP BY for the page. A credit applied for more than its total
    // (D17, flagged red on the Credits tab) counts as 0 here rather than eating another
    // credit's open amount.
    const vendorIds = vendors.map((v) => v.id);
    const openCreditRows = vendorIds.length
      ? await prisma.$queryRaw<Array<{ vendorId: string; open: number }>>`
          SELECT "vendorId", round(sum(greatest(amount - "usedAmount", 0))::numeric, 2)::float8 AS open
            FROM "VendorCredit"
           WHERE "vendorId" = ANY(${vendorIds}) AND status = 'OPEN'
           GROUP BY "vendorId"`
      : [];
    const openCreditBy = new Map(openCreditRows.map((r) => [r.vendorId, r.open]));

    // "Outstanding" keeps meaning unpaid bills — Σ (amount − paidAmount) over bills not PAID.
    // It is deliberately NOT the ledger balance (no opening, no credit notes); the 0809 plan
    // kept the two apart and /vendors/[id] shows the ledger balance.
    const vendorsWithBalance = vendors.map((v) => {
      const balance = v.bills.reduce((sum, b) => sum + (b.amount - b.paidAmount), 0);
      const { bills: _bills, ...rest } = v;
      return { ...rest, outstandingBalance: balance, openCredit: openCreditBy.get(v.id) ?? 0 };
    });

    return paginatedResponse(vendorsWithBalance, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("vendor list failed", { error: error instanceof Error ? error.message : String(error) });
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
    log.warn("vendor create failed", { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to create vendor", 400);
  }
}
