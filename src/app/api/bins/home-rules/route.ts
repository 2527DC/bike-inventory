export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("bins:home-rules");

/** "Cycles › Kids › 16 inch" — what the rules list prints instead of a bare leaf name. */
async function categoryPath(categoryId: string | null | undefined): Promise<string | null> {
  if (!categoryId) return null;
  const names: string[] = [];
  const seen = new Set<string>();
  let current: string | null = categoryId;
  // Bounded walk: `parentId` has no database constraint against a loop, so `seen` stops one.
  while (current && !seen.has(current)) {
    seen.add(current);
    const row: { name: string; parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: current },
      select: { name: true, parentId: true },
    });
    if (!row) break;
    names.unshift(row.name);
    current = row.parentId;
  }
  return names.length ? names.join(" › ") : null;
}

export async function GET(req: NextRequest) {
  try {
    await requireFeature("bins", "view");
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId");
    const brandId = searchParams.get("brandId");
    const categoryId = searchParams.get("categoryId");

    const where: Record<string, unknown> = {};
    if (warehouseId) where.warehouseId = warehouseId;
    if (brandId) where.brandId = brandId;
    if (categoryId) where.categoryId = categoryId;

    const rules = await prisma.homeBinRule.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true, code: true, kind: true } },
        brand: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, parentId: true } },
        product: { select: { id: true, sku: true, name: true } },
        bin: {
          select: {
            id: true,
            code: true,
            name: true,
            directions: true,
            isAssemblyArea: true,
            nonAssemblable: true,
          },
        },
      },
      orderBy: [{ warehouse: { name: "asc" } }, { createdAt: "desc" }],
    });

    // The rule names a LEAF (P13), so its own name is ambiguous on its own — two brands can
    // both have "16 inch". Each row carries the full path from the root.
    const paths = new Map<string, string | null>();
    for (const rule of rules) {
      if (rule.categoryId && !paths.has(rule.categoryId)) {
        paths.set(rule.categoryId, await categoryPath(rule.categoryId));
      }
    }

    return successResponse(
      rules.map((rule) => ({
        ...rule,
        categoryPath: rule.categoryId ? paths.get(rule.categoryId) ?? null : null,
        // Plan 2109-bin-audit-lists-rule-products (R5): a rule must name both a brand and a
        // category. One saved before that rule lists nothing in its bin's audit; flag it to fix.
        incomplete: !rule.brandId || !rule.categoryId || !!rule.productId,
      }))
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("home bin rules fetch failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch home bin rules", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("bins", "edit");
    const body = await req.json();
    const { warehouseId, brandId, binId } = body;
    // R39, P13: the form sends a root category and — when that root has children — the
    // subcategory under it. The SUBCATEGORY is what the rule stores; `categoryId` is only how
    // the user got there.
    const chosenCategoryId: string | null =
      (typeof body.subcategoryId === "string" && body.subcategoryId.trim()) ||
      (typeof body.categoryId === "string" && body.categoryId.trim()) ||
      null;

    if (!warehouseId || !binId) {
      return errorResponse("warehouseId and binId are required", 400);
    }

    // ── A RULE IS ALWAYS BRAND + CATEGORY (plan 2109-bin-audit-lists-rule-products, R5) ──
    //
    // A bin's audit lists the products matching BOTH the brand and the category of its rules
    // (R1). A brand-only, category-only or single-product rule would still place items at
    // inbound but list nothing, so those items would never be on a count list. The owner chose
    // to require both (Q6a). Old rules of other kinds are flagged by GET (`incomplete`).
    if (!brandId || !chosenCategoryId) {
      log.warn("home bin rule refused", { reason: "brand and category required", warehouseId, binId });
      return errorResponse("Choose a brand and a category", 400);
    }

    // ── A RULE ALWAYS NAMES A LEAF (P13) ──
    //
    // A rule on a parent would have to mean either "this category only" or "the whole
    // subtree", and nothing on the screen said which. So it is refused: choose the
    // subcategory. Only ACTIVE children count — a category whose children were all
    // deactivated is a leaf again, and blocking it would strand the rule.
    if (chosenCategoryId) {
      const category = await prisma.category.findUnique({
        where: { id: chosenCategoryId },
        select: { id: true, name: true, isActive: true },
      });
      if (!category) return errorResponse("That category does not exist", 400);

      const activeChildren = await prisma.category.count({
        where: { parentId: chosenCategoryId, isActive: true },
      });
      if (activeChildren > 0) {
        return errorResponse(`Choose a subcategory of ${category.name}`, 400);
      }
    }

    // Verify bin belongs to warehouse
    const bin = await prisma.bin.findUnique({
      where: { id: binId },
      select: { id: true, code: true, warehouseId: true, isActive: true },
    });

    if (!bin || bin.warehouseId !== warehouseId) {
      return errorResponse("Destination bin does not belong to the selected warehouse", 400);
    }
    if (!bin.isActive) {
      return errorResponse(`Bin ${bin.code} is not active — pick another`, 400);
    }

    const include = {
      warehouse: { select: { id: true, name: true, code: true } },
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, name: true, parentId: true } },
      bin: {
        select: {
          id: true,
          code: true,
          name: true,
          directions: true,
          isAssemblyArea: true,
          nonAssemblable: true,
        },
      },
    };

    // Check for existing rule with identical criteria in this warehouse
    const existing = await prisma.homeBinRule.findFirst({
      where: {
        warehouseId,
        brandId: brandId || null,
        categoryId: chosenCategoryId,
        productId: null,
      },
    });

    const rule = existing
      ? await prisma.homeBinRule.update({ where: { id: existing.id }, data: { binId }, include })
      : await prisma.homeBinRule.create({
          data: {
            warehouseId,
            brandId: brandId || null,
            categoryId: chosenCategoryId,
            productId: null,
            binId,
          },
          include,
        });

    log.info(existing ? "home bin rule updated" : "home bin rule created", {
      ruleId: rule.id,
      warehouseId,
      brandId: brandId || null,
      categoryId: chosenCategoryId,
      productId: null,
      binId,
    });

    return successResponse(
      { ...rule, categoryPath: await categoryPath(rule.categoryId) },
      201
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("home bin rule save failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to save home bin rule", 400);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireFeature("bins", "edit");
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return errorResponse("Rule id is required", 400);

    await prisma.homeBinRule.delete({ where: { id } });
    log.info("home bin rule deleted", { ruleId: id });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("home bin rule delete failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to delete home bin rule", 400);
  }
}
