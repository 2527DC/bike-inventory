export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { vendorCreditSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("bills", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    const vendorId = searchParams.get("vendorId") || undefined;

    const where = {
      ...(vendorId && { vendorId }),
    };

    const [credits, total] = await Promise.all([
      prisma.vendorCredit.findMany({
        where,
        include: { vendor: { select: { name: true, code: true } } },
        orderBy: { creditDate: "desc" },
        skip,
        take: limit,
      }),
      prisma.vendorCredit.count({ where }),
    ]);

    return paginatedResponse(credits, total, page, limit);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch credits", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("bills", "create");
    const body = await req.json();
    const data = vendorCreditSchema.parse(body);

    const credit = await prisma.vendorCredit.create({
      data: {
        vendorId: data.vendorId,
        creditNoteNo: data.creditNoteNo,
        amount: data.amount,
        reason: data.reason,
        creditDate: new Date(data.creditDate),
        notes: data.notes,
      },
      include: { vendor: { select: { name: true } } },
    });

    return successResponse(credit, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create credit note", 400);
  }
}
