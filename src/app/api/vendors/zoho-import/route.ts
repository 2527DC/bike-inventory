export const dynamic = "force-dynamic";
// One batch of MAX_BATCH detail reads, spaced out for Zoho's rate limit — well under 60 s.
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getBooks } from "@/lib/integrations";
import { vendorDataFrom } from "@/lib/vendors/resolve-zoho-vendor";
import { vendorCodeFor, randomCodeSuffix } from "@/lib/vendors/code";
import { createLogger } from "@/lib/logger";
import { matchOne, normaliseGstin } from "@/lib/vendors/zoho-match";
import { listVendorsForMatching } from "@/lib/vendors/zoho-link";

const log = createLogger("vendors:zoho-sync");

/**
 * The screen sends the ticked Zoho ids a batch at a time and shows progress between calls.
 * 20 per request, each detail read at least SPACING_MS apart, keeps one import under ~90
 * Zoho calls a minute — inside Zoho's 100/min — even when the screen fires batches back to
 * back. `apiCall` still backs off on a 429 if another screen is calling Zoho at the same time.
 */
const MAX_BATCH = 20;
const SPACING_MS = 650;

const importSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Choose at least one vendor").max(MAX_BATCH, `At most ${MAX_BATCH} per request`),
});

type Outcome =
  | { zohoId: string; result: "created"; vendorId: string; name: string }
  | { zohoId: string; result: "skipped"; reason: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/vendors/zoho-import — creates vendors from Zoho, WITH their Zoho id
 * (plan 2409-zoho-vendor-sync, Part A).
 *
 * Per id: already linked → skipped (never updated); the Zoho detail read → the same
 * `vendorDataFrom` mapping a bill import uses → create. A vendor that is already here — the same
 * GSTIN or name, by the matcher the Link step uses (plan 1410-link-vendors-to-zoho) — is skipped
 * and named: it is linked, never imported a second time. The screen offers only new vendors, but
 * this is re-checked here, so a sheet left open from before cannot create a duplicate. Each vendor
 * is its own write, so a failure on one does not undo the others and a re-run simply skips what
 * is already there.
 */
export async function POST(req: NextRequest) {
  try {
    // vendors.fetch, as the preview (plan 1410-per-module-fetch-permissions, R2). Was
    // vendors.create.
    await requireFeature("vendors", "fetch");

    const body = await req.json().catch((e: unknown) => {
      log.warn("import request body is not JSON", { error: e instanceof Error ? e.message : String(e) });
      return null;
    });
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid import request", 400);
    }
    const ids = [...new Set(parsed.data.ids)];

    const zoho = await getBooks();
    if (!zoho) {
      log.warn("vendor import refused — Zoho Books is not connected");
      return errorResponse("Zoho Books is not connected. Connect it in Settings › Integrations, then try again.", 503);
    }

    const outcomes: Outcome[] = [];
    let lastCallAt = 0;
    // Every vendor here, for the matcher; a vendor created in this batch joins it, so two Zoho
    // duplicates in one batch cannot both be created.
    const vendors = await listVendorsForMatching();

    for (const zohoId of ids) {
      const skip = (reason: string) => outcomes.push({ zohoId, result: "skipped", reason });

      try {
        const existing = await prisma.vendor.findUnique({ where: { zohoVendorId: zohoId }, select: { id: true, name: true } });
        if (existing) {
          skip(`"${existing.name}" is already here`);
          continue;
        }

        const wait = lastCallAt + SPACING_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastCallAt = Date.now();
        log.debug("-> GET contact", { zohoVendorId: zohoId });
        const contact = (await zoho.getContact(zohoId)).contact;
        if (!contact) {
          log.warn("Zoho returned no contact", { zohoVendorId: zohoId });
          skip(`Zoho vendor ${zohoId} was not found in Zoho`);
          continue;
        }

        const data = vendorDataFrom(zohoId, contact.contact_name ?? "", contact);
        if (!data.name) {
          skip(`Zoho vendor ${zohoId} has no name`);
          continue;
        }

        const match = matchOne({ zohoId, name: data.name, gstin: normaliseGstin(contact.gst_no) }, vendors);
        if (match.kind !== "none") {
          const here = match.candidates[0];
          log.warn("vendor already here — not imported", { zohoVendorId: zohoId, kind: match.kind, existingVendorId: here?.id });
          skip(
            here
              ? `"${data.name}" matches "${here.name}" (${here.code}) already here — link it in the Link section instead of importing`
              : `"${data.name}" matches a vendor already here — link it instead of importing`
          );
          continue;
        }

        const clash = await prisma.vendor.findFirst({
          where: { name: { equals: data.name, mode: "insensitive" } },
          select: { id: true },
        });
        if (clash) {
          log.warn("vendor name already taken — skipped", { zohoVendorId: zohoId, existingVendorId: clash.id });
          skip(`A vendor named "${data.name}" already exists here — rename one side, then import again`);
          continue;
        }

        let created;
        try {
          created = await prisma.vendor.create({ data, select: { id: true, name: true } });
        } catch (e) {
          const target = String((e as Prisma.PrismaClientKnownRequestError)?.meta?.target ?? "");
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && target.includes("code")) {
            log.warn("vendor code collided — retrying with a new code", { zohoVendorId: zohoId });
            created = await prisma.vendor.create({
              data: { ...data, code: vendorCodeFor(data.name, randomCodeSuffix()) },
              select: { id: true, name: true },
            });
          } else if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            // A bill import or a second click created it (or took the name) in between.
            log.warn("vendor created concurrently — skipped", { zohoVendorId: zohoId, target });
            skip(`"${data.name}" was created by another request just now`);
            continue;
          } else {
            throw e;
          }
        }

        vendors.push({ id: created.id, code: data.code, name: created.name, gstin: data.gstin ?? null, isActive: true, zohoVendorId: zohoId });
        outcomes.push({ zohoId, result: "created", vendorId: created.id, name: created.name });
      } catch (e) {
        // One vendor's failure is reported and the batch carries on.
        log.error("vendor import failed for one vendor", {
          zohoVendorId: zohoId,
          error: e instanceof Error ? e.message : String(e),
        });
        skip(`Zoho vendor ${zohoId}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    const created = outcomes.filter((o) => o.result === "created").length;
    const skipped = outcomes.length - created;
    log.info("vendor import batch", { requested: ids.length, created, skipped });

    return successResponse({
      created,
      skipped,
      errors: outcomes.flatMap((o) => (o.result === "skipped" ? [o.reason] : [])),
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("vendor import failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to import Zoho vendors", 500);
  }
}
