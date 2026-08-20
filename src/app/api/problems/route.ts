export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("problems", "view");
    const problems = await prisma.appProblem.findMany({
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return successResponse(problems);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("problems", "create");
    const body = await req.json();
    const { text, category } = body as { text: string; category?: string };

    if (!text?.trim()) return errorResponse("Problem description is required", 400);

    const problem = await prisma.appProblem.create({
      data: {
        text: text.trim(),
        category: category || "general",
        userId: user.id,
      },
      include: { user: { select: { name: true } } },
    });

    return successResponse(problem, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireFeature("problems", "edit");
    const body = await req.json();
    const { id, status } = body as { id: string; status: string };

    if (!id) return errorResponse("Problem ID required", 400);

    const updated = await prisma.appProblem.update({
      where: { id },
      data: { status: status || "resolved" },
    });

    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
