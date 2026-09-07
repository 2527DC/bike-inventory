export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { reorderSettingsSchema } from "@/lib/validations";
import { validateReorderVendor } from "@/lib/vendors/validate";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("products:reorder");

/**
 * Set one product's reorder level, quantity and vendor. Nothing else.
 *
 * ─── WHY A SEPARATE ROUTE ────────────────────────────────────────────────────────────────
 *
 * The obvious wiring for a "reorder" sheet is the product PUT. That route is
 * `api/products/[id]/route.ts:60`: it guards on `stock.edit`, parses the whole
 * `productUpdateSchema` and spreads the result into `prisma.product.update` with no per-field
 * check. So posting a sheet to it would give every `stock.edit` holder a write on `costPrice`,
 * `sellingPrice` and `sku` — while merely READING cost price is gated behind its own
 * `cost_price` module. A sheet that says "reorder level" must not be a price editor.
 *
 * ─── WHY `reorder.edit` AND NOT `stock.edit` (owner, 6 Sep) ──────────────────────────────
 *
 * These same three columns are already written by `api/reorder/update-levels/route.ts`, which
 * guards on `reorder.edit`. Two routes writing one column behind two different permissions is
 * how a grant stops meaning anything: revoking `reorder.edit` would look like it stopped
 * someone setting reorder levels while the sheet carried on working.
 *
 * The consequence is deliberate and has to be granted: the button on `/stock` is gated on
 * `canEdit("reorder")`, NOT `stock.edit`. A role holding `stock.edit` alone does not see it.
 * Gating the button and the route differently is exactly the bug P7 had to fix on inbound —
 * the button was shown to `inbound.edit` and the endpoint demanded `vendor_issues.create`, so
 * every click was a silent 403.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("reorder", "edit");
    const { id } = await params;

    const parsed = reorderSettingsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid reorder settings", 400);
    }
    const data = parsed.data;

    const existing = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true, name: true, sku: true,
        reorderLevel: true, reorderQty: true, reorderVendorId: true,
      },
    });
    if (!existing) return errorResponse("Product not found", 404);

    // Checked BEFORE the write, and by name, so a deactivated vendor is refused with a
    // sentence instead of succeeding here and surfacing as a dead vendor on a purchase order
    // once P10 derives from this column.
    const vendorError = await validateReorderVendor(data.reorderVendorId);
    if (vendorError) return errorResponse(vendorError, 400);

    const nextVendorId = data.reorderVendorId ?? null;

    // Which fields actually moved. The sheet submits all three every time, so keying off the
    // body would log "changed reorder level, quantity, vendor" for a save that changed one.
    const changed: string[] = [];
    if (data.reorderLevel !== existing.reorderLevel) changed.push("reorder level");
    if (data.reorderQty !== existing.reorderQty) changed.push("reorder quantity");
    if (nextVendorId !== existing.reorderVendorId) changed.push("vendor");

    const product = await prisma.$transaction(async (tx) => {
      const row = await tx.product.update({
        where: { id },
        data: {
          reorderLevel: data.reorderLevel,
          reorderQty: data.reorderQty,
          reorderVendorId: nextVendorId,
        },
        select: {
          id: true, sku: true, name: true, currentStock: true,
          reorderLevel: true, reorderQty: true, reorderVendorId: true,
          reorderVendor: { select: { id: true, name: true } },
        },
      });

      if (changed.length > 0) {
        await logActivity(tx, {
          module: "stock",
          action: "updated",
          entityType: "Product",
          entityId: id,
          entityRef: existing.sku,
          // The level is the number people argue about, so it is worth the from -> to.
          fromValue: changed.includes("reorder level") ? String(existing.reorderLevel) : null,
          toValue: changed.includes("reorder level") ? String(data.reorderLevel) : null,
          details: `Reorder settings — changed ${changed.join(", ")}`,
          userId: user.id,
          userName: user.name,
        });
      }

      return row;
    });

    log.info("reorder settings saved", { productId: id, sku: existing.sku, changed });
    return successResponse(product);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid reorder settings", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to save reorder settings";
    log.error("reorder settings save failed", { message });
    return errorResponse(message, 400);
  }
}
