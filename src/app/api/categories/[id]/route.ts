export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { categoryUpdateSchema } from "@/lib/validations";
import { createLogger } from "@/lib/logger";
import { logActivity } from "@/lib/activity-log";
import { isPlaceholderCategory } from "@/lib/import-placeholders";

const log = createLogger("api:categories:id");

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Resolved outside the try so the catch can name the category in its log line.
  const { id } = await params;
  try {
    const user = await requireFeature("categories", "edit");

    const parsed = categoryUpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid category", 400);
    }
    const data = parsed.data;

    const existing = await prisma.category.findUnique({
      where: { id },
      // description and reorderLevel are selected for the activity log: it records WHICH fields
      // moved, and that cannot be decided without the values they moved from.
      select: {
        id: true,
        name: true,
        parentId: true,
        description: true,
        reorderLevel: true,
        isActive: true,
        parent: { select: { name: true, isActive: true } },
      },
    });
    if (!existing) return errorResponse("Category not found", 404);

    // Category.name is @unique. Catching the clash here turns a raw constraint violation
    // into a sentence naming the category already holding it — and points at merge, which
    // is what someone renaming into an existing name actually wants.
    if (data.name && data.name.trim() !== existing.name) {
      const clash = await prisma.category.findFirst({
        where: { name: { equals: data.name.trim(), mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (clash && clash.id !== id) {
        return errorResponse(`"${clash.name}" already exists. Merge into it instead of renaming.`, 409);
      }
    }

    // The tree is exactly two deep by convention and nothing enforces it in the schema, so
    // both illegal shapes are rejected here: a category cannot parent itself, and it cannot
    // adopt one of its own children (which would make a cycle no query could terminate on).
    if (data.parentId) {
      if (data.parentId === id) {
        return errorResponse("A category cannot be its own parent", 400);
      }
      const parent = await prisma.category.findUnique({
        where: { id: data.parentId },
        select: { id: true, name: true, parentId: true },
      });
      if (!parent) return errorResponse("The chosen parent category does not exist", 404);
      if (parent.parentId === id) {
        return errorResponse(
          `"${parent.name}" is already a child of this category. Move it out first.`,
          400
        );
      }
    }

    // ─── active / inactive (plan 0809-brand-category-inactive) ────────────────────────────
    //
    // Deactivating takes the whole subtree: the row, every descendant category, and every
    // ACTIVE product filed under any of them, in one transaction. Activating is the row only
    // (a parent coming back does not silently resurrect children someone retired on
    // purpose), plus its own INACTIVE products when `reactivateProducts` is sent. The
    // placeholder is refused outright — every import falls back to it.
    const flips = data.isActive !== undefined && data.isActive !== existing.isActive;
    if (flips && isPlaceholderCategory(existing.name)) {
      log.warn("deactivate refused — placeholder", { categoryId: id });
      return errorResponse(`${existing.name} is the import fall-back and cannot be made inactive`, 400);
    }
    if (flips && data.isActive === true && existing.parent && !existing.parent.isActive) {
      return errorResponse(`Activate ${existing.parent.name} first`, 400);
    }

    const nextName = data.name !== undefined ? data.name.trim() : existing.name;
    const nextDescription =
      data.description !== undefined ? data.description?.trim() || null : existing.description;
    const nextParentId = data.parentId !== undefined ? data.parentId || null : existing.parentId;
    const nextReorderLevel =
      data.reorderLevel !== undefined ? data.reorderLevel : existing.reorderLevel;

    // Which fields actually MOVED, not which were present in the body. The edit sheet submits
    // every field it renders, so keying off `Object.keys(data)` would file "changed name,
    // description, parent" against a save where the person changed nothing.
    const changed: string[] = [];
    if (nextName !== existing.name) changed.push("name");
    if (nextDescription !== existing.description) changed.push("description");
    if (nextParentId !== existing.parentId) changed.push("parent");
    if (nextReorderLevel !== existing.reorderLevel) changed.push("reorder level");

    const goingInactive = flips && data.isActive === false;

    const category = await prisma.$transaction(async (tx) => {
      // The subtree, when deactivating: this id plus every descendant, level by level. The
      // tree is two deep by convention, but the loop costs nothing and does not rely on it.
      let subtree: string[] = [id];
      if (goingInactive) {
        let frontier = [id];
        while (frontier.length > 0) {
          const next = await tx.category.findMany({
            where: { parentId: { in: frontier }, isActive: true },
            select: { id: true },
          });
          frontier = next.map((c) => c.id).filter((cid) => !subtree.includes(cid));
          subtree = subtree.concat(frontier);
        }
      }

      // The walk follows ACTIVE children only. A child that was retired on its own earlier
      // is left exactly as it is — including any of its products someone restored by hand
      // since — because "activate is the row only" cuts both ways: this call owns the rows
      // it changes and nothing that was decided separately.
      //
      // `status: ACTIVE` on the way down and `status: INACTIVE` on the way back up are not
      // optional: ProductStatus also has DISCONTINUED, and a blind updateMany would rewrite
      // it with nothing to restore it.
      const touchProducts = goingInactive || (flips && data.reactivateProducts === true);
      const affected = touchProducts
        ? await tx.product.findMany({
            where: {
              categoryId: goingInactive ? { in: subtree } : id,
              status: goingInactive ? "ACTIVE" : "INACTIVE",
            },
            select: { id: true, currentStock: true },
          })
        : [];
      const unitsOnHand = affected.reduce((sum, p) => sum + (p.currentStock ?? 0), 0);

      const row = await tx.category.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: nextName } : {}),
          ...(data.description !== undefined ? { description: nextDescription } : {}),
          ...(data.parentId !== undefined ? { parentId: nextParentId } : {}),
          ...(data.reorderLevel !== undefined ? { reorderLevel: nextReorderLevel } : {}),
          ...(flips ? { isActive: data.isActive } : {}),
        },
        include: { _count: { select: { products: true, children: true } } },
      });

      let subcategoriesChanged = 0;
      if (goingInactive && subtree.length > 1) {
        const kids = await tx.category.updateMany({
          where: { id: { in: subtree.filter((cid) => cid !== id) } },
          data: { isActive: false },
        });
        subcategoriesChanged = kids.count;
      }

      let productsChanged = 0;
      if (affected.length > 0) {
        const changedProducts = await tx.product.updateMany({
          where: { id: { in: affected.map((p) => p.id) } },
          data: { status: goingInactive ? "INACTIVE" : "ACTIVE" },
        });
        productsChanged = changedProducts.count;
      }

      if (flips) {
        await logActivity(tx, {
          module: "categories",
          action: goingInactive ? "deactivated" : "activated",
          entityType: "Category",
          entityId: id,
          entityRef: nextName,
          details: goingInactive
            ? `${productsChanged} products and ${subcategoriesChanged} sub-categories set inactive · ${unitsOnHand} units stay on the books`
            : data.reactivateProducts
              ? `${productsChanged} products restored`
              : "products untouched",
          userId: user.id,
          userName: user.name,
        });
      }

      // An unchanged save writes no row. The feed is meant to show what happened, and
      // "opened the sheet and pressed Save" did not happen to the category.
      if (changed.length > 0) {
        await logActivity(tx, {
          module: "categories",
          action: "updated",
          entityType: "Category",
          entityId: id,
          entityRef: nextName,
          fromValue: changed.includes("name") ? existing.name : null,
          toValue: changed.includes("name") ? nextName : null,
          details: `Changed ${changed.join(", ")}`,
          userId: user.id,
          userName: user.name,
        });
      }

      return { ...row, productsChanged, unitsOnHand, subcategoriesChanged };
    });

    if (flips) {
      log.info(goingInactive ? "category deactivated" : "category activated", {
        categoryId: id,
        productsChanged: category.productsChanged,
        subcategoriesChanged: category.subcategoriesChanged,
        unitsOnHand: category.unitsOnHand,
      });
    } else {
      log.info("category updated", { categoryId: id, fields: changed });
    }
    return successResponse(category);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to update the category";
    log.error("category update failed", { categoryId: id, message });
    return errorResponse(message, 400);
  }
}

// DELETE is gone on purpose (plan 0809-brand-category-inactive, R2). A category is retired
// with PATCH { isActive: false } — subtree and all — and nothing under it is destroyed. Merge
// is still the way to fold one category into another.
