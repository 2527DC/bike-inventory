export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createPurchaseOrder, PoCreateError } from "@/lib/purchase-orders/create";
import { resolveVendors } from "@/lib/purchase-orders/resolve-vendor";
import { createLogger } from "@/lib/logger";

const log = createLogger("brand-stock:generate-po");

/**
 * Turn the selected rows of a brand-stock sheet into a purchase order.
 *
 * ─── THIS ROUTE HAS NEVER WORKED ─────────────────────────────────────────────────────────
 *
 * Before P9 it built `hsnCode` from the product and passed it into a `PurchaseOrderItem`
 * create. That column does not exist on `PurchaseOrderItem` — only on `Product` — so every
 * valid request threw `PrismaClientValidationError: Unknown argument 'hsnCode'` and came back
 * as a 500. Every path that returned a 4xx returned it BEFORE the create, which is why the
 * failure only ever showed up on the happy path.
 *
 * It survived because the item objects came out of a `.map()` rather than a fresh object
 * literal, so TypeScript's excess-property check never fired: `tsc` clean, `next build` clean,
 * guaranteed failure at runtime. Nothing but running it would have found this.
 *
 * One upside: because it never created a row, there is no legacy 4-digit `PO-0001` data from
 * this path for `nextSequence` to trip over.
 *
 * ─── WHAT CHANGED ────────────────────────────────────────────────────────────────────────
 *
 * The whole write now goes through `createPurchaseOrder`, which is also what the manual
 * screen uses. That is not tidiness: this route had its OWN number generator that padded to
 * four digits and ordered by `poNumber` as a string, so once `PO-00010` existed it sorted
 * below `PO-0002` and this route would have handed out a number already taken. It also ran
 * outside any transaction. Sharing the creator brings the advisory lock, the duplicate check,
 * one number series and the activity row — and the `hsnCode` bug disappears by construction,
 * because the shared creator never builds that field.
 *
 * ─── PRICELESS ROWS ARE SKIPPED, NOT REFUSED (owner, 6 Sep) ──────────────────────────────
 *
 * `brandPrice || costPrice || 0` legitimately yields 0 when a sheet leaves a price cell blank
 * and the matched product has no cost price. On the manual screen a blank rate is a typo and
 * the creator refuses it; here it is missing DATA, and failing forty rows because three had no
 * price would make the screen unusable. So this caller passes `onPricelessLine: "skip"` and
 * reports what was left out.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // TWO gates, deliberately. The other four brand-stock routes moved onto `brand_stock`
    // when it became a module of its own; this one did not follow them, because the row it
    // writes is a PurchaseOrder. Gating it on `brand_stock.create` alone would make this a
    // second and weaker way to mint a PO — raise one here without holding
    // `purchase_orders.create`, bypassing the grant the manual screen requires.
    //
    // So: `brand_stock.view` to read the sheet, `purchase_orders.create` to write the order.
    // `requireFeature` takes exactly two arguments and has no OR form, so this is two calls.
    // The view check runs FIRST — someone who cannot open the sheet should be told that,
    // not told they cannot create purchase orders.
    await requireFeature("brand_stock", "view");
    const user = await requireFeature("purchase_orders", "create");
    const { id } = await params;

    const upload = await prisma.brandStockUpload.findUnique({
      where: { id },
      include: {
        brand: { select: { name: true } },
        items: {
          where: { selected: true, orderQty: { gt: 0 }, productId: { not: null } },
          include: { product: { select: { id: true, sku: true, name: true, costPrice: true, gstRate: true, brandId: true, reorderVendorId: true } } },
        },
      },
    });

    if (!upload) return errorResponse("Upload not found", 404);
    if (upload.items.length === 0) return errorResponse("No items selected for PO", 400);

    // ─── vendor resolution ────────────────────────────────────────────────────────────
    //
    // Was a fuzzy `vendor.name contains brand.name` match — the weakest link in this route,
    // and the reason the create-time vendor check has to stay OFF for this caller. P10 asks
    // the same resolver the rest of the purchasing loop uses, and only falls back to the name
    // match when it has no answer at all.
    //
    // Moved here from P11, which the owner dropped on 6 Sep: the check landing in P10 would
    // otherwise refuse every brand-stock order while this route still guessed by name.
    const resolutions = await resolveVendors(
      upload.items.map((i) => ({
        id: i.productId!,
        brandId: i.product?.brandId ?? null,
        reorderVendorId: i.product?.reorderVendorId ?? null,
      }))
    );

    const resolvedIds = [...resolutions.values()]
      .filter((r) => r.resolved)
      .map((r) => (r.resolved ? r.vendor.id : ""));
    const distinct = [...new Set(resolvedIds)];

    // One sheet, one purchase order — this route has no per-vendor UI. Two vendors across the
    // selected rows is a real answer, not an error, so it says which and points at the screen
    // that can split them.
    if (distinct.length > 1) {
      const names = [...new Set(
        [...resolutions.values()].filter((r) => r.resolved).map((r) => (r.resolved ? r.vendor.name : ""))
      )];
      return errorResponse(
        `These rows come from ${names.length} vendors (${names.join(", ")}). ` +
          `Order them from Purchase Orders → New, which can split by vendor.`,
        400
      );
    }

    const resolvedVendorId = distinct[0];
    const vendor = resolvedVendorId
      ? await prisma.vendor.findUnique({ where: { id: resolvedVendorId }, select: { id: true, name: true } })
      : await prisma.vendor.findFirst({
          where: { name: { contains: upload.brand.name, mode: "insensitive" }, isActive: true },
          select: { id: true, name: true },
        });

    if (!vendor) {
      return errorResponse(
        "No vendor could be worked out for this brand. Set a reorder vendor on the products, " +
          "or add this brand to a vendor on the vendor's page.",
        400
      );
    }

    const { po, skipped } = await createPurchaseOrder(
      {
        vendorId: vendor.id,
        // `submit` left at its default: this PO goes to PENDING_APPROVAL like every other one
        // (owner, 6 Sep). It used to land in DRAFT, so the approval gate could be sidestepped
        // by ordering from a brand sheet instead of the manual screen.
        items: upload.items.map((item) => ({
          productId: item.productId!,
          quantity: item.orderQty || 0,
          unitPrice: item.brandPrice || item.product?.costPrice || 0,
          gstRate: item.product?.gstRate ?? 18,
        })),
        // The ONLY thing linking this PO back to the upload — there is no foreign key in
        // either direction and no BrandStockUploadStatus value meaning "ordered". Losing this
        // string would lose the provenance entirely.
        notes: `Auto-generated from ${upload.brand.name} stock upload (${upload.fileName})`,
      },
      user,
      { onPricelessLine: "skip" }
    );

    log.info("po generated from brand stock", {
      uploadId: id,
      poId: po.id,
      poNumber: po.poNumber,
      vendorId: vendor.id,
      lines: po.items.length,
      skipped: skipped.length,
    });

    // `{ po, brandName }`, NOT the bare PO: brand-stock/[id]/page.tsx reads `json.data.po.id`
    // to redirect. Returning the creator's result directly would send it to
    // /purchase-orders/undefined.
    return successResponse({ po, brandName: upload.brand.name, skipped }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof PoCreateError) {
      return errorResponse(error.message, error.status, error.data);
    }
    const message = error instanceof Error ? error.message : "Failed to generate PO";
    log.error("po generation failed", { message });
    return errorResponse(message, 500);
  }
}
