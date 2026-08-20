export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { binSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("settings", "view");
    const bins = await prisma.bin.findMany({
      where: { isActive: true },
      include: { _count: { select: { products: true } } },
      orderBy: { code: "asc" },
    });
    return successResponse(bins);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch bins", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("settings", "create");
    const body = await req.json();
    const data = binSchema.parse(body);

    // Check for duplicate code
    const existing = await prisma.bin.findUnique({ where: { code: data.code } });
    if (existing) {
      return errorResponse(`Bin code "${data.code}" already exists. Try a different name.`, 409);
    }

    const bin = await prisma.bin.create({ data });
    return successResponse(bin, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create bin", 400);
  }
}
