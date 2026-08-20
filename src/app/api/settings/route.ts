export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// Default SOP departments (used as seed if none saved)
const DEFAULT_SOP_DEPARTMENTS = ["Sales", "Service", "Ops", "Finance", "Billing", "BDC", "Content"];

export async function GET(req: NextRequest) {
  try {
    await requireFeature("settings", "view");
    const key = new URL(req.url).searchParams.get("key");

    if (key) {
      const setting = await prisma.appSetting.findUnique({ where: { key } });
      if (!setting) {
        // Return defaults for known keys
        if (key === "sop_departments") {
          return successResponse({ key, value: DEFAULT_SOP_DEPARTMENTS });
        }
        return errorResponse("Setting not found", 404);
      }
      return successResponse({ key: setting.key, value: JSON.parse(setting.value) });
    }

    const settings = await prisma.appSetting.findMany();
    const result: Record<string, unknown> = {};
    for (const s of settings) {
      try { result[s.key] = JSON.parse(s.value); } catch { result[s.key] = s.value; }
    }
    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch settings", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireFeature("settings", "edit");
    const { key, value } = await req.json();

    if (!key || value === undefined) {
      return errorResponse("key and value are required", 400);
    }

    const setting = await prisma.appSetting.upsert({
      where: { key },
      update: { value: JSON.stringify(value) },
      create: { key, value: JSON.stringify(value) },
    });

    return successResponse({ key: setting.key, value: JSON.parse(setting.value) });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update setting", 400);
  }
}
