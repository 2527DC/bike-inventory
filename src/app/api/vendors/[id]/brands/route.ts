export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendors:brands");

const vendorBrandsSchema = z.object({
  brands: z
    .array(
      z.object({
        brandId: z.string().min(1, "Brand is required"),
        isPrimary: z.boolean().default(false),
      })
    )
    .max(500, "Too many brands in one request"),
});

/**
 * Set which brands a vendor supplies, and which of them this vendor is the primary route for.
 *
 * ─── WHY THIS ROUTE HAD TO EXIST BEFORE ANYTHING ELSE IN P10 ─────────────────────────────
 *
 * `BrandVendor` has FOUR readers — both ledger routes and both ledger screens — and, until
 * now, ZERO writers. No seed, no import, no migration, no route, no screen has ever created a
 * row; the only DDL is the empty `CREATE TABLE` in `0_init`. `docs/dead-code.md` records it,
 * and `docs/code-review-2026-09-02.md` puts it plainly: "the brand→vendor mapping the whole
 * ledger module rests on, and it cannot be created."
 *
 * Vendor resolution tiers 2 and 3 read that table. Without this route they would answer
 * NO_VENDOR for every product forever, and the reorder flow would end up LESS usable than
 * before P10 rather than more.
 *
 * ─── THE PRIMARY FLAG IS BRAND-SCOPED, NOT VENDOR-SCOPED ─────────────────────────────────
 *
 * "Primary" means "the usual billing route for THIS BRAND" — so it is an invariant across
 * vendors, not within one. The plan described a vendor-scoped `deleteMany + createMany`, and
 * that cannot hold the invariant: marking brand X primary on vendor A has to CLEAR whatever
 * primary brand X already had on vendor B, and a transaction scoped to vendor A never sees
 * vendor B's row.
 *
 * Nothing in the database enforces it either — there is no partial unique index on
 * `(brandId) WHERE isPrimary` — so it is enforced here, in one transaction, by clearing the
 * flag across every other vendor for each brand being claimed. `resolveVendors` still refuses
 * to guess if it ever finds two, rather than trusting this route to have been the only writer.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("vendors", "edit");
    const { id: vendorId } = await params;

    const parsed = vendorBrandsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid brands", 400);
    }
    const { brands } = parsed.data;

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, name: true, isActive: true },
    });
    if (!vendor) return errorResponse("Vendor not found", 404);
    if (!vendor.isActive) {
      return errorResponse(`${vendor.name} is deactivated. Reactivate it before editing brands.`, 400);
    }

    // A brandId sent twice would make the createMany violate @@unique([brandId, vendorId]) and
    // surface as a raw P2002, so it is caught by name here instead.
    const seen = new Set<string>();
    for (const b of brands) {
      if (seen.has(b.brandId)) return errorResponse("The same brand is listed twice", 400);
      seen.add(b.brandId);
    }

    const brandIds = brands.map((b) => b.brandId);
    if (brandIds.length > 0) {
      const found = await prisma.brand.findMany({
        where: { id: { in: brandIds } },
        select: { id: true, name: true, isActive: true },
      });
      if (found.length !== brandIds.length) {
        return errorResponse("One or more of those brands no longer exists", 400);
      }
      // A retired brand cannot gain a supplier link (plan 0809-brand-category-inactive).
      const inactive = found.filter((b) => !b.isActive).map((b) => b.name);
      if (inactive.length > 0) {
        return errorResponse(
          `${inactive.join(", ")} ${inactive.length === 1 ? "is" : "are"} inactive. Activate on /more/brands before linking.`,
          400
        );
      }
    }

    const primaryBrandIds = brands.filter((b) => b.isPrimary).map((b) => b.brandId);

    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.brandVendor.findMany({
        where: { vendorId },
        select: { brandId: true, isPrimary: true },
      });

      // Replace this vendor's rows wholesale. The screen always submits the complete list, so
      // a diff would only be a slower way to reach the same state.
      await tx.brandVendor.deleteMany({ where: { vendorId } });

      // Clear the primary flag held by any OTHER vendor for the brands this vendor is now
      // claiming. This is the half a vendor-scoped write cannot do, and without it two vendors
      // both read as primary and resolveVendors answers AMBIGUOUS for the whole brand.
      let clearedElsewhere = 0;
      if (primaryBrandIds.length > 0) {
        const cleared = await tx.brandVendor.updateMany({
          where: { brandId: { in: primaryBrandIds }, vendorId: { not: vendorId }, isPrimary: true },
          data: { isPrimary: false },
        });
        clearedElsewhere = cleared.count;
      }

      if (brands.length > 0) {
        await tx.brandVendor.createMany({
          data: brands.map((b) => ({ vendorId, brandId: b.brandId, isPrimary: b.isPrimary })),
        });
      }

      const added = brandIds.filter((b) => !before.some((x) => x.brandId === b)).length;
      const removed = before.filter((x) => !brandIds.includes(x.brandId)).length;

      if (added > 0 || removed > 0 || clearedElsewhere > 0 || before.some((x) => x.isPrimary) !== primaryBrandIds.length > 0) {
        await logActivity(tx, {
          module: "vendors",
          action: "updated",
          entityType: "Vendor",
          entityId: vendorId,
          entityRef: vendor.name,
          details:
            `Brands supplied: ${brandIds.length} (${added} added, ${removed} removed` +
            `${primaryBrandIds.length > 0 ? `, ${primaryBrandIds.length} primary` : ""}` +
            `${clearedElsewhere > 0 ? `, ${clearedElsewhere} primary moved from another vendor` : ""})`,
          userId: user.id,
          userName: user.name,
        });
      }

      return { count: brandIds.length, added, removed, clearedElsewhere };
    });

    log.info("vendor brands saved", { vendorId, ...result });

    const brandsOut = await prisma.brandVendor.findMany({
      where: { vendorId },
      select: { isPrimary: true, brand: { select: { id: true, name: true } } },
      orderBy: { brand: { name: "asc" } },
    });

    return successResponse({
      brands: brandsOut.map((b) => ({ id: b.brand.id, name: b.brand.name, isPrimary: b.isPrimary })),
      clearedElsewhere: result.clearedElsewhere,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to save the vendor's brands";
    log.error("vendor brands save failed", { message });
    return errorResponse(message, 400);
  }
}
