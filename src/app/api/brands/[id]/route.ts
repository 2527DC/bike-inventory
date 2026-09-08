export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { logActivity } from "@/lib/activity-log";
import { isPlaceholderBrand } from "@/lib/import-placeholders";

const log = createLogger("api:brands:id");

// Every field optional: this screen edits one cell at a time (a rename, a lead time) and
// sending the whole brand back on every keystroke would be a worse API, not a stricter one.
const updateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  contactName: z.string().max(120).nullable().optional(),
  contactPhone: z.string().max(30).nullable().optional(),
  whatsappNumber: z.string().max(30).nullable().optional(),
  // Days this brand takes to deliver. Folded onto Brand from the old BrandLeadTime table.
  leadDays: z.number().int().min(1, "Lead time must be at least 1 day").max(365).optional(),
  // Active / inactive replaces delete (plan 0809-brand-category-inactive). Deactivating
  // also retires the brand's ACTIVE products; activating brings the brand back and, only
  // when `reactivateProducts` is sent, restores the products that are INACTIVE.
  isActive: z.boolean().optional(),
  reactivateProducts: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Resolved outside the try so the catch can name the brand in its log line.
  const { id } = await params;
  try {
    const user = await requireFeature("brands", "edit");

    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid brand", 400);
    }
    const data = parsed.data;

    const existing = await prisma.brand.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true },
    });
    if (!existing) return errorResponse("Brand not found", 404);

    // Brand.name is @unique. Catching the clash here turns a raw constraint violation into
    // a sentence that names the brand already holding it.
    if (data.name && data.name.trim() !== existing.name) {
      const clash = await prisma.brand.findFirst({
        where: { name: { equals: data.name.trim(), mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (clash && clash.id !== id) {
        return errorResponse(`"${clash.name}" already exists. Merge into it instead of renaming.`, 409);
      }
    }

    // ─── active / inactive ────────────────────────────────────────────────────────────────
    //
    // A flip is its own transaction: the brand row, its products and the activity entry
    // move together or not at all. The placeholder rows are refused outright — `Unbranded`
    // alone carries almost the whole catalog, and every import falls back to one of them,
    // so an inactive placeholder would file new products under a retired row.
    const flips = data.isActive !== undefined && data.isActive !== existing.isActive;
    if (flips && isPlaceholderBrand(existing.name)) {
      log.warn("deactivate refused — placeholder", { brandId: id });
      return errorResponse(`${existing.name} is the import fall-back and cannot be made inactive`, 400);
    }

    const fieldData = {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.contactName !== undefined ? { contactName: data.contactName?.trim() || null } : {}),
      ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone?.trim() || null } : {}),
      ...(data.whatsappNumber !== undefined ? { whatsappNumber: data.whatsappNumber?.trim() || null } : {}),
      ...(data.leadDays !== undefined ? { leadDays: data.leadDays } : {}),
    };

    if (!flips) {
      const brand = await prisma.brand.update({
        where: { id },
        data: fieldData,
        include: { _count: { select: { products: true } } },
      });
      log.info("brand updated", { brandId: id, fields: Object.keys(data) });
      return successResponse(brand);
    }

    const goingInactive = data.isActive === false;
    const result = await prisma.$transaction(async (tx) => {
      // `status: ACTIVE` on the way down and `status: INACTIVE` on the way back up are not
      // optional: ProductStatus also has DISCONTINUED, and a blind updateMany would rewrite
      // it with nothing to restore it.
      const touchProducts = goingInactive || data.reactivateProducts === true;
      const affected = touchProducts
        ? await tx.product.findMany({
            where: { brandId: id, status: goingInactive ? "ACTIVE" : "INACTIVE" },
            select: { id: true, currentStock: true },
          })
        : [];
      const unitsOnHand = affected.reduce((sum, p) => sum + (p.currentStock ?? 0), 0);

      const brand = await tx.brand.update({
        where: { id },
        data: { ...fieldData, isActive: data.isActive },
        include: { _count: { select: { products: true } } },
      });

      let productsChanged = 0;
      if (affected.length > 0) {
        const changed = await tx.product.updateMany({
          where: { id: { in: affected.map((p) => p.id) } },
          data: { status: goingInactive ? "INACTIVE" : "ACTIVE" },
        });
        productsChanged = changed.count;
      }

      await logActivity(tx, {
        module: "brands",
        action: goingInactive ? "deactivated" : "activated",
        entityType: "Brand",
        entityId: id,
        entityRef: brand.name,
        details: goingInactive
          ? `${productsChanged} products set inactive · ${unitsOnHand} units stay on the books`
          : data.reactivateProducts
            ? `${productsChanged} products restored`
            : "products untouched",
        userId: user.id,
        userName: user.name,
      });

      return { ...brand, productsChanged, unitsOnHand };
    });

    log.info(goingInactive ? "brand deactivated" : "brand activated", {
      brandId: id,
      productsChanged: result.productsChanged,
      unitsOnHand: result.unitsOnHand,
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    // The clash pre-check lost a race: another row took the name between the read and the
    // write, and the case-insensitive index refused the rename.
    if ((error as { code?: string } | null)?.code === "P2002") {
      log.warn("brand rename lost a race to a duplicate", { brandId: id });
      return errorResponse("A brand with that name already exists.", 409);
    }
    const message = error instanceof Error ? error.message : "Failed to update the brand";
    log.error("brand update failed", { brandId: id, message });
    return errorResponse(message, 400);
  }
}

// DELETE is gone on purpose (plan 0809-brand-category-inactive, R2). A brand is retired with
// PATCH { isActive: false } and nothing under it is destroyed. Merge is still the way to fold
// one brand into another.
