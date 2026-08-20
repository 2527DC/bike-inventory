export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("activity", "view");

    const logs = await prisma.opsActivityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { user: { select: { name: true } } },
    });

    return successResponse(logs);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch logs", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("activity", "create");
    const body = await req.json();

    if (!body.action || typeof body.action !== "string") {
      return errorResponse("Action is required", 400);
    }
    if (!body.details || typeof body.details !== "string") {
      return errorResponse("Details is required", 400);
    }

    const log = await prisma.opsActivityLog.create({
      data: {
        action: body.action,
        details: body.details,
        userId: user.id,
      },
      include: { user: { select: { name: true } } },
    });

    return successResponse(log, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create log", 400);
  }
}
