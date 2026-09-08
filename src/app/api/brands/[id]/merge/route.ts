export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:brands:merge");

/** Thrown inside the transaction to refuse with a sentence; the catch turns it into a 400. */
class MergeRefused extends Error {}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("brands", "create");
    const { id: sourceBrandId } = await params;
    const { targetBrandId } = await req.json();

    if (!targetBrandId || typeof targetBrandId !== "string") {
      return errorResponse("targetBrandId is required", 400);
    }

    if (sourceBrandId === targetBrandId) {
      return errorResponse("Cannot merge a brand into itself", 400);
    }

    // Verify both brands exist
    const [sourceBrand, targetBrand] = await Promise.all([
      prisma.brand.findUnique({ where: { id: sourceBrandId } }),
      prisma.brand.findUnique({ where: { id: targetBrandId } }),
    ]);

    if (!sourceBrand) return errorResponse("Source brand not found", 404);
    if (!targetBrand) return errorResponse("Target brand not found", 404);
    // Merging INTO a retired brand would hide every moved product behind an inactive row.
    if (!targetBrand.isActive) {
      log.warn("merge refused — target inactive", { sourceBrandId, targetBrandId });
      return errorResponse(`${targetBrand.name} is inactive. Activate it first, or pick another brand.`, 400);
    }

    // Move EVERYTHING the source holds, then delete it, in one transaction.
    //
    // This used to move products and vendor links only. Of the other seven relations on
    // Brand, three are Restrict (the delete threw a raw P2003 and the merge rolled back) and
    // four are SetNull (the merge SUCCEEDED and the ledger reconciliation's own rows quietly
    // lost their brand). Delete is gone now, so merge is the only way to fold a brand away —
    // it has to be at least as careful as the delete it replaces.
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.updateMany({
        where: { brandId: sourceBrandId },
        data: { brandId: targetBrandId },
      });

      // @@unique([brandId, brandName]): a mapping name the target already has cannot move.
      // Check by name first so the refusal is a sentence, not a P2002.
      const sourceMaps = await tx.brandSkuMapping.findMany({
        where: { brandId: sourceBrandId },
        select: { brandName: true },
      });
      if (sourceMaps.length > 0) {
        const clashes = await tx.brandSkuMapping.findMany({
          where: { brandId: targetBrandId, brandName: { in: sourceMaps.map((m) => m.brandName) } },
          select: { brandName: true },
        });
        if (clashes.length > 0) {
          throw new MergeRefused(
            `${targetBrand.name} already has SKU mapping(s) named ${clashes
              .map((c) => `"${c.brandName}"`)
              .join(", ")}. Remove the duplicate on one side, then merge.`
          );
        }
      }

      const moveTo = { data: { brandId: targetBrandId } };
      const where = { where: { brandId: sourceBrandId } };
      const relations = {
        inboundShipments: (await tx.inboundShipment.updateMany({ ...where, ...moveTo })).count,
        stockUploads: (await tx.brandStockUpload.updateMany({ ...where, ...moveTo })).count,
        skuMappings: (await tx.brandSkuMapping.updateMany({ ...where, ...moveTo })).count,
        preBookings: (await tx.preBooking.updateMany({ ...where, ...moveTo })).count,
        ledgerEntries: (await tx.brandLedgerEntry.updateMany({ ...where, ...moveTo })).count,
        ledgerGaps: (await tx.ledgerGap.updateMany({ ...where, ...moveTo })).count,
        discountTerms: (await tx.vendorDiscountTerm.updateMany({ ...where, ...moveTo })).count,
      };

      // ─── carry the vendor links across ────────────────────────────────────────────────
      //
      // BrandVendor.brandId is ON DELETE CASCADE, so deleting the source brand DESTROYS every
      // vendor link it had — silently, and with no way to tell afterwards that it happened.
      // That did not matter while the table was empty. From P10 it decides which vendor
      // supplies a product, so a merge would quietly un-resolve a whole brand's catalogue.
      //
      // Same shape as the category merge fixed in P1: move what the source held to the target
      // BEFORE deleting, and skip the ones the target already has, because
      // @@unique([brandId, vendorId]) would reject a duplicate.
      const sourceLinks = await tx.brandVendor.findMany({
        where: { brandId: sourceBrandId },
        select: { vendorId: true, isPrimary: true, note: true },
      });
      const targetLinks = await tx.brandVendor.findMany({
        where: { brandId: targetBrandId },
        select: { vendorId: true },
      });
      const targetVendorIds = new Set(targetLinks.map((l) => l.vendorId));
      const toMove = sourceLinks.filter((l) => !targetVendorIds.has(l.vendorId));

      if (toMove.length > 0) {
        await tx.brandVendor.createMany({
          data: toMove.map((l) => ({
            brandId: targetBrandId,
            vendorId: l.vendorId,
            // The target's own primary wins. Two primaries on one brand is the state
            // resolveVendors refuses to guess about, so a merge must not create one.
            isPrimary: targetLinks.length > 0 ? false : l.isPrimary,
            note: l.note,
          })),
        });
      }

      // The cascade removes the source's rows along with the brand.
      await tx.brand.delete({ where: { id: sourceBrandId } });

      return {
        moved: updated.count,
        deleted: sourceBrand.name,
        vendorLinksMoved: toMove.length,
        vendorLinksDropped: sourceLinks.length - toMove.length,
        relationsMoved: relations,
      };
    });

    log.info("brands merged", {
      sourceBrandId,
      targetBrandId,
      moved: result.moved,
      vendorLinksMoved: result.vendorLinksMoved,
      relationsMoved: result.relationsMoved,
    });

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError)
      return errorResponse(error.message, error.status);
    if (error instanceof MergeRefused) {
      log.warn("merge refused", { message: error.message });
      return errorResponse(error.message, 400);
    }
    const message = error instanceof Error ? error.message : "Failed to merge brand";
    log.error("brand merge failed", { message });
    return errorResponse(message, 500);
  }
}
