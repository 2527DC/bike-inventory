export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { categoryUpdateSchema } from "@/lib/validations";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:categories:id");

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("categories", "edit");
    const { id } = await params;

    const parsed = categoryUpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid category", 400);
    }
    const data = parsed.data;

    const existing = await prisma.category.findUnique({
      where: { id },
      select: { id: true, name: true, parentId: true },
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

    const category = await prisma.category.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId || null } : {}),
        ...(data.movingLevel !== undefined ? { movingLevel: data.movingLevel } : {}),
        ...(data.reorderLevel !== undefined ? { reorderLevel: data.reorderLevel } : {}),
      },
      include: { _count: { select: { products: true, children: true } } },
    });

    log.info("category updated", { categoryId: id, fields: Object.keys(data) });
    return successResponse(category);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to update the category";
    log.error("category update failed", { message });
    return errorResponse(message, 400);
  }
}

/**
 * Delete a category, but only when nothing points at it.
 *
 * Same rule as brands and as /team's user delete: count the references, remove the row only
 * when every count is zero, otherwise REFUSE and name what is holding it. `Product.categoryId`
 * is REQUIRED (schema.prisma:449), so a forced delete could not leave the products behind —
 * it would have to destroy them. Merge is the operation that actually cleans this data up,
 * and the refusal points there.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("categories", "delete");
    const { id } = await params;

    const category = await prisma.category.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: { select: { products: true, children: true } },
      },
    });
    if (!category) return errorResponse("Category not found", 404);

    const blockers: string[] = [];
    if (category._count.products) blockers.push(`${category._count.products} product(s)`);
    // A child left behind would point at a row that no longer exists. Prisma's referential
    // action would null it silently and quietly promote the child to a root — a structural
    // change nobody asked for, so refuse instead.
    if (category._count.children) blockers.push(`${category._count.children} sub-categor(ies)`);

    if (blockers.length) {
      log.info("category delete refused", { categoryId: id, blockers });
      return successResponse({
        deleted: false,
        name: category.name,
        blockers,
        message: `${category.name} still has ${blockers.join(" and ")}. Merge it into another category, or move those first.`,
      });
    }

    await prisma.category.delete({ where: { id } });
    log.info("category deleted", { categoryId: id, name: category.name });

    return successResponse({
      deleted: true,
      name: category.name,
      message: `${category.name} was deleted.`,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to delete the category";
    log.error("category delete failed", { message });
    return errorResponse(message, 400);
  }
}
