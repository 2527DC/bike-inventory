export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { storeUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("settings", "view");

    const updates = await prisma.storeUpdate.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: { select: { name: true } } },
    });

    return successResponse(updates);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch updates", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("settings", "create");
    const body = await req.json();
    const data = storeUpdateSchema.parse(body);

    const update = await prisma.storeUpdate.create({
      data: {
        text: data.text,
        category: data.category,
        userId: user.id,
      },
      include: { user: { select: { name: true } } },
    });

    return successResponse(update, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create update", 400);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireFeature("settings", "delete");
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return errorResponse("ID is required", 400);

    await prisma.storeUpdate.delete({ where: { id } });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to delete update", 400);
  }
}
