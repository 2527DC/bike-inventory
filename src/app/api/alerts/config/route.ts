export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("settings", "view");

    const config = await prisma.alertConfig.findUnique({ where: { id: "singleton" } });
    return successResponse(config || { id: "singleton", redFlagPhones: "" });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch config", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireFeature("settings", "edit");
    const body = await req.json();
    const { redFlagPhones, whatsappTemplates } = body as {
      redFlagPhones?: string;
      whatsappTemplates?: { scheduled?: string; dispatched?: string; delivered?: string };
    };

    const updateData: Record<string, unknown> = {};
    if (redFlagPhones !== undefined) updateData.redFlagPhones = redFlagPhones;
    if (whatsappTemplates !== undefined) updateData.whatsappTemplates = whatsappTemplates;

    const config = await prisma.alertConfig.upsert({
      where: { id: "singleton" },
      update: updateData,
      create: { id: "singleton", ...updateData },
    });

    return successResponse(config);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update config", 400);
  }
}
