export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";

const log = createLogger("settings:alerts-config");

export async function GET() {
  try {
    await requireFeature("settings", "view");

    const config = await prisma.alertConfig.findUnique({ where: { id: "singleton" } });
    return successResponse(config || { id: "singleton", redFlagPhones: "" });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("failed to read alert config", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch config", 500);
  }
}

/**
 * ONE ROUTE, TWO PERMISSIONS — the guard is per FIELD, not per request.
 *
 * This body carries two unrelated things: `redFlagPhones`, which belongs to the Alerts screen
 * and to `settings`, and `whatsappTemplates`, which belongs to the WhatsApp Templates screen and
 * to `whatsapp_templates`. A single `requireFeature("settings", "edit")` at the top got both
 * halves wrong at once:
 *
 *   - templates are READ on `whatsapp_templates.view` (api/whatsapp-templates/route.ts:48) but
 *     were WRITTEN on `settings.edit`, so a user holding the WhatsApp module could open the
 *     screen and not save;
 *   - and anyone with plain `settings.edit` could rewrite every customer-facing template
 *     without holding the module at all.
 *
 * So: authenticate first, then check the permission that matches each field as it is accepted.
 * A request touching both fields must hold both grants.
 */
export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const { redFlagPhones, whatsappTemplates } = body as {
      redFlagPhones?: string;
      whatsappTemplates?: { scheduled?: string; dispatched?: string; delivered?: string };
    };

    const updateData: Record<string, unknown> = {};
    const fields: string[] = [];

    if (redFlagPhones !== undefined) {
      if (!(await userCan(user.id, "settings", "edit"))) {
        log.warn("denied redFlagPhones write", { userId: user.id, need: "settings.edit" });
        throw new AuthError("You do not have permission to edit settings", 403);
      }
      updateData.redFlagPhones = redFlagPhones;
      fields.push("redFlagPhones");
    }

    if (whatsappTemplates !== undefined) {
      if (!(await userCan(user.id, "whatsapp_templates", "edit"))) {
        log.warn("denied whatsappTemplates write", {
          userId: user.id,
          need: "whatsapp_templates.edit",
        });
        throw new AuthError("You do not have permission to edit whatsapp_templates", 403);
      }
      updateData.whatsappTemplates = whatsappTemplates;
      fields.push("whatsappTemplates");
    }

    // Previously an empty body upserted the singleton with nothing in it, which looked like a
    // successful save and changed nothing. Name it instead.
    if (fields.length === 0) {
      log.warn("no recognised fields in body", { userId: user.id });
      return errorResponse("No recognised fields to update", 400);
    }

    const config = await prisma.alertConfig.upsert({
      where: { id: "singleton" },
      update: updateData,
      create: { id: "singleton", ...updateData },
    });

    log.info("alert config updated", { userId: user.id, fields });
    return successResponse(config);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("failed to update alert config", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to update config", 400);
  }
}
