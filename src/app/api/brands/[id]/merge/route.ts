export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

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

    // Move all products and delete source brand in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.updateMany({
        where: { brandId: sourceBrandId },
        data: { brandId: targetBrandId },
      });

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
      };
    });

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError)
      return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to merge brand",
      500
    );
  }
}
