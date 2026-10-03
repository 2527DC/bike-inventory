export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { z } from "zod";
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

/**
 * The body of a rule save — plan 0310-bin-delete-multi-category-rules-and-transfer-directions, R5.
 *
 * `categoryIds` is the new shape: one brand, one bin, MANY categories, saved in one go (Q4). The
 * older single `categoryId` / `subcategoryId` pair is still accepted and becomes a one-item list,
 * so nothing that sends the old body breaks.
 */
const ruleSaveSchema = z.object({
  warehouseId: z.string({ error: "Choose the warehouse this rule is for" }).min(1, "Choose the warehouse this rule is for"),
  brandId: z.string({ error: "Choose a brand" }).min(1, "Choose a brand"),
  binId: z.string({ error: "Choose the home bin" }).min(1, "Choose the home bin"),
  categoryIds: z.array(z.string().min(1)).max(200, "At most 200 categories in one save").optional(),
  categoryId: z.string().optional(),
  subcategoryId: z.string().optional(),
});

/** "Cycles › Kids › 16 inch" from rows already in memory — no query per step (cf. `categoryPath`). */
function pathFrom(rows: Map<string, { name: string; parentId: string | null }>, id: string): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = rows.get(current);
    if (!row) break;
    names.unshift(row.name);
    current = row.parentId;
  }
  return names.join(" › ");
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("bins", "edit");
    const body = ruleSaveSchema.parse(await req.json());
    const { warehouseId, brandId, binId } = body;

    // R39, P13 kept: the legacy body sends a root and, when it has children, the subcategory —
    // the SUBCATEGORY is what the rule stores.
    const requested = body.categoryIds ?? [body.subcategoryId?.trim() || body.categoryId?.trim() || ""];
    const categoryIds = [...new Set(requested.map((c) => c.trim()).filter(Boolean))];

    // ── A RULE IS ALWAYS BRAND + CATEGORY (plan 2109-bin-audit-lists-rule-products, R5) ──
    //
    // A bin's audit lists the products matching BOTH the brand and the category of its rules
    // (R1). A brand-only, category-only or single-product rule would still place items at
    // inbound but list nothing, so those items would never be on a count list. The owner chose
    // to require both (Q6a). Old rules of other kinds are flagged by GET (`incomplete`).
    if (categoryIds.length === 0) {
      log.warn("home bin rule refused", { reason: "brand and category required", warehouseId, binId });
      return errorResponse("Choose a brand and at least one category", 400);
    }

    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true, isActive: true } });
    if (!brand) return errorResponse("That brand does not exist", 400);
    if (!brand.isActive) return errorResponse(`${brand.name} is inactive — activate it or choose another brand`, 400);

    // ── EVERY RULE NAMES A LEAF (P13) ──
    //
    // A rule on a parent would have to mean either "this category only" or "the whole
    // subtree", and nothing on the screen said which. So it is refused: choose the
    // subcategory. Only ACTIVE children count — a category whose children were all deactivated
    // is a leaf again, and blocking it would strand the rule. One read of the whole table
    // answers this for every chosen category AND builds their paths, instead of a query each.
    const all = await prisma.category.findMany({ select: { id: true, name: true, parentId: true, isActive: true } });
    const byId = new Map(all.map((c) => [c.id, c]));
    const withActiveChildren = new Set(all.filter((c) => c.isActive && c.parentId).map((c) => c.parentId as string));

    const problems: string[] = [];
    for (const id of categoryIds) {
      const c = byId.get(id);
      if (!c) problems.push("a category that no longer exists");
      else if (!c.isActive) problems.push(`${pathFrom(byId, id)} (inactive)`);
      else if (withActiveChildren.has(id)) problems.push(`${pathFrom(byId, id)} (choose a subcategory of it)`);
    }
    if (problems.length > 0) {
      log.warn("home bin rule refused", { reason: "category not a usable leaf", warehouseId, binId, problems: problems.length });
      return errorResponse(`These categories cannot take a rule: ${problems.join("; ")}`, 400);
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

    // ── ONE TRANSACTION FOR THE WHOLE SAVE (Q5) ──
    //
    // Each brand + category pair is one row per warehouse. A pair that already points to ANOTHER
    // bin is re-pointed — what a single save always did — and reported, so moving it is never
    // silent. `updateMany` over every row of the pair: there is no unique index, so an older
    // duplicate must move with it rather than keep firing to the old bin.
    const outcome = await prisma.$transaction(async (tx) => {
      const existing = await tx.homeBinRule.findMany({
        where: { warehouseId, brandId, categoryId: { in: categoryIds }, productId: null },
        select: { id: true, categoryId: true, binId: true, bin: { select: { code: true } } },
      });

      let created = 0;
      let unchanged = 0;
      const moved: { categoryPath: string; fromBinCode: string }[] = [];
      for (const categoryId of categoryIds) {
        const rows = existing.filter((r) => r.categoryId === categoryId);
        if (rows.length === 0) {
          await tx.homeBinRule.create({ data: { warehouseId, brandId, categoryId, productId: null, binId } });
          created += 1;
          continue;
        }
        const elsewhere = rows.find((r) => r.binId !== binId);
        if (!elsewhere) {
          unchanged += 1;
          continue;
        }
        await tx.homeBinRule.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { binId } });
        moved.push({ categoryPath: pathFrom(byId, categoryId), fromBinCode: elsewhere.bin.code });
      }
      return { created, unchanged, moved };
    });

    log.info("home bin rules saved", {
      warehouseId,
      brandId,
      binId,
      categories: categoryIds.length,
      created: outcome.created,
      moved: outcome.moved.length,
      unchanged: outcome.unchanged,
    });

    return successResponse({ binCode: bin.code, brandName: brand.name, ...outcome }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      log.warn("home bin rule refused: invalid body", { message: error.issues[0]?.message });
      return errorResponse(error.issues[0]?.message ?? "Invalid rule", 400);
    }
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
