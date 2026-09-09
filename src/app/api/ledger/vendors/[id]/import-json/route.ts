export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";
import {
  LEDGER_JSON_IMPORT_ENABLED,
  importBrand,
  ledgerExportSchema,
} from "@/lib/brand-ledger/import-json";

const log = createLogger("ledger:import-json");

const MAX_BYTES = 5 * 1024 * 1024;

// POST — the one-time import of the ledger app's JSON export into this vendor.
//
// Setup tooling (plan 0909-vendor-ledger-screens, R8): the file is read, validated and
// written in one transaction, and never stored. Needs both ledger grants, because the file
// carries claims as well as entries. Answers 410 once LEDGER_JSON_IMPORT_ENABLED is off.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let vendorId = "";
  try {
    const user = await requireFeature("brand_ledger", "create");
    if (!(await userCan(user.id, "brand_ledger_gaps", "create"))) {
      return errorResponse("You do not have permission to create Ledger Claims", 403);
    }
    vendorId = (await params).id;

    if (!LEDGER_JSON_IMPORT_ENABLED) {
      return errorResponse("The one-time JSON import has been switched off now that setup is complete.", 410);
    }

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true } });
    if (!vendor) return errorResponse("Vendor not found", 404);

    const form = await req.formData();
    const file = form.get("file");
    const brandId = String(form.get("brandId") ?? "").trim();
    if (!(file instanceof File)) return errorResponse("Choose the ledger app's JSON export", 400);
    if (!/\.json$/i.test(file.name)) return errorResponse("Only a .json export is accepted", 400);
    if (file.size === 0 || file.size > MAX_BYTES) return errorResponse("The file must be between 1 byte and 5 MB", 400);
    if (!brandId) return errorResponse("brandId is required", 400);

    log.debug("-> import-json", { vendorId, brandId, fileName: file.name, bytes: file.size });

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch (e) {
      log.warn("export is not valid JSON", { vendorId, fileName: file.name, reason: e instanceof Error ? e.message : String(e) });
      return errorResponse("The file is not valid JSON", 400);
    }

    const doc = ledgerExportSchema.parse(parsed);
    const counts = await importBrand({ vendorId, doc, brandId, userId: user.id });
    return successResponse(counts, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      log.warn("export failed validation", { vendorId, issues: error.issues.slice(0, 5) });
      const first = error.issues[0];
      return errorResponse(`The export does not match the ledger app's shape: ${first?.path.join(".")} ${first?.message}`, 400);
    }
    // A refusal from importBrand (vendor not empty, unknown brand, unreadable date) is a
    // sentence for the person, not a server fault.
    if (error instanceof Error && /already has ledger data|no brand with id|unreadable date/.test(error.message)) {
      log.warn("import refused", { vendorId, reason: error.message });
      return errorResponse(error.message, 409);
    }
    return failure(error, { scope: "ledger:import-json", vendorId });
  }
}
