export const dynamic = "force-dynamic";
export const maxDuration = 60; // Approve step now fetches bill details from Zoho

import { NextRequest } from "next/server";
import { Prisma, type VendorBill } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { PLACEHOLDER_CATEGORY } from "@/lib/import-placeholders";
import { zohoApproveSchema } from "@/lib/validations";
// Type-only. The clients themselves are still loaded through a dynamic import inside the
// handler, so importing the type here adds nothing to the module graph at runtime.
import type { BooksClient, IntegrationClient } from "@/lib/integrations";
import type { ZohoLocation } from "@/lib/integrations/books";
import { storeIdForLocation } from "@/lib/payables/store";
import { syncVendorCredit, toMoney, zohoDate, round2 } from "@/lib/payables/sync-vendor-credit";
import { syncCustomerCreditNote } from "@/lib/receivables/sync-credit-note";
import {
  floorWarehouseForInvoice,
  listFloorWarehousesWithPrefix,
  deliveryFieldsFromInvoiceDetail,
  type DeliveryFieldsFromInvoice,
} from "@/lib/deliveries/zoho-invoice";
import { logActivity } from "@/lib/activity-log";
import { toPlus91 } from "@/lib/phone";
import { nextSequence } from "@/lib/sequence";
import { ibSeedSql } from "@/lib/inbound/sequence";
import { resolveBillVendor } from "@/lib/vendors/resolve-zoho-vendor";

// This route had no logger at all — a 499-line import handler whose only record of what it
// did was the response body, which a 504 never delivers.
const log = createLogger("zoho:approve");

/**
 * Where a product goes when the bill's vendor name is not a brand we know (§6).
 *
 * NOT `PLACEHOLDER_BRAND` ("Imported"): that spelling belongs to the deleted Zoho item
 * import and nothing writes it any more. `Unbranded` is the spelling the catalog import
 * used for the 8,175 rows already in the table, and it is the one the plan seeds. Both are
 * in `PLACEHOLDER_BRAND_NAMES`, so `isPlaceholderBrand` and the "Needs details" filter treat
 * them alike either way — this picks the one a person will actually recognise on /stock.
 */
const FALLBACK_BRAND_NAME = "Unbranded";

/** The brand fields this route needs: the id for the FKs, the name for messages, leadDays
 *  for the shipment's expected delivery date. */
const BRAND_SELECT = { id: true, name: true, leadDays: true, isActive: true } as const;
type ResolvedBrand = { id: string; name: string; leadDays: number; isActive: boolean };

/**
 * Read the placeholder brand row, creating it ONCE if it is genuinely absent.
 *
 * This is the one brand write left in this file, and it is deliberate: a placeholder is not
 * taxonomy. It exists because `Product.brandId` is non-null, so an import that cannot name a
 * brand still has to write one. Everything else here resolves.
 */
async function resolvePlaceholderBrand(billNo: string): Promise<ResolvedBrand> {
  const existing = await prisma.brand.findFirst({
    where: { name: { equals: FALLBACK_BRAND_NAME, mode: "insensitive" } },
    select: BRAND_SELECT,
  });
  if (existing) return existing;

  log.warn("placeholder brand row absent — creating it once", { billNo, brand: FALLBACK_BRAND_NAME });
  try {
    return await prisma.brand.create({ data: { name: FALLBACK_BRAND_NAME }, select: BRAND_SELECT });
  } catch (e) {
    // `Brand.name` is unique, so the likely cause is a concurrent approve that won the race.
    // Re-read before giving up — a lost race must not fail somebody's bill.
    log.warn("placeholder brand create failed — re-reading", {
      billNo,
      error: e instanceof Error ? e.message : String(e),
    });
    const raced = await prisma.brand.findFirst({
      where: { name: { equals: FALLBACK_BRAND_NAME, mode: "insensitive" } },
      select: BRAND_SELECT,
    });
    if (raced) return raced;
    log.error("placeholder brand could not be resolved or created", { billNo });
    throw new Error(
      `Brand "${FALLBACK_BRAND_NAME}" is missing and could not be created — run \`npm run db:seed\` and approve this pull again`
    );
  }
}

// POST — approve or reject a pull
export async function POST(req: NextRequest) {
  // Wall-clock for the finish log. This route dies at maxDuration = 60 under load, so how
  // long a successful run took is the number that says how close to the cliff it is.
  const startedAt = Date.now();
  try {
    const user = await requireFeature("zoho", "approve");

    // ZOD AT THE BOUNDARY (plan 1210 credit notes, X11). This was a bare cast, so a misspelt
    // `entityType` matched no preview and the import "succeeded" having done nothing.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch (e) {
      log.warn("approve body is not JSON", { message: e instanceof Error ? e.message : String(e) });
      return errorResponse("The request body must be JSON.", 400);
    }
    const parsed = zohoApproveSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue ? `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}` : "Invalid request";
      log.warn("approve body refused", { message });
      return errorResponse(message, 400);
    }
    const { pullId, action, entityType, previewIds, source, storeId: pickedStoreId } = parsed.data;

    // The importer's store for bills whose Zoho location is not linked to a store (Part 2.2).
    // Checked once here so a stale pick is one clear 400, not a foreign-key error per bill.
    if (pickedStoreId) {
      const picked = await prisma.store.findUnique({ where: { id: pickedStoreId }, select: { id: true } });
      if (!picked) {
        log.warn("approve refused — picked store does not exist", { pullId, storeId: pickedStoreId });
        return errorResponse("The store picked for these bills no longer exists. Reload and pick again.", 400);
      }
    }

    // Find or auto-create pullLog (handles case where finalize step failed)
    let pullLog = await prisma.zohoPullLog.findUnique({ where: { pullId } });
    if (!pullLog) {
      // Check that previews exist for this pullId before creating log
      const byType = await prisma.zohoPullPreview.groupBy({
        by: ["entityType"],
        where: { pullId },
        _count: { _all: true },
      });
      const countOf = (t: string) => byType.find((g) => g.entityType === t)?._count._all ?? 0;
      const previewCount = byType.reduce((s, g) => s + g._count._all, 0);
      if (previewCount === 0) return errorResponse("Pull not found", 404);
      log.warn("pull log missing — created from its previews (finalize did not run)", { pullId, previews: previewCount });
      pullLog = await prisma.zohoPullLog.create({
        data: {
          pullId,
          // Credit previews are counted as what they are, not as bills (plan 1210).
          billsNew: previewCount - countOf("vendorcredit") - countOf("creditnote") - countOf("invoice"),
          invoicesNew: countOf("invoice"),
          vendorCreditsNew: countOf("vendorcredit"),
          creditNotesNew: countOf("creditnote"),
          apiCallsUsed: 0,
        },
      });
    }
    if (pullLog.status !== "PENDING_REVIEW" && pullLog.status !== "PARTIAL") {
      return errorResponse(`Pull already ${pullLog.status.toLowerCase()}`, 400);
    }

    // Filter: specific IDs and/or entity type, else all pending. When both are sent they must
    // BOTH hold — a credit-note import cannot approve a stray bill id, and vice versa.
    const previewFilter: Prisma.ZohoPullPreviewWhereInput = {
      pullId,
      status: "PENDING",
      ...(previewIds && previewIds.length > 0 ? { id: { in: previewIds } } : {}),
      ...(entityType ? { entityType } : {}),
    };

    const previews = await prisma.zohoPullPreview.findMany({ where: previewFilter });

    if (action === "reject") {
      await prisma.zohoPullPreview.updateMany({
        where: previewFilter,
        data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: user.id },
      });
      // Only mark pull as rejected if ALL previews are now rejected
      const remaining = await prisma.zohoPullPreview.count({ where: { pullId, status: "PENDING" } });
      if (remaining === 0) {
        await prisma.zohoPullLog.update({
          where: { pullId },
          data: { status: "REJECTED", approvedAt: new Date() },
        });
      }
      return successResponse({ action: "rejected", count: previews.length, entityType: entityType || "all" });
    }

    // ─── APPROVE: write to real tables ───
    // `contacts` and `items` are always 0 — those two branches were deleted with the Zoho
    // item import. The keys stay because four screens read this response shape, and a 0 is
    // the honest answer rather than a missing field they would have to guard against.
    //
    // Products ARE still created here, by the BILL branch, when a bill line names a SKU the
    // catalog does not have. That is deliberate and was decided explicitly: an inbound
    // shipment must be able to receive something the catalog has not met yet.
    // `skipped` is new: an already-imported record is a normal outcome, not an error and not a
    // silent nothing. Before this a re-import reported "0 imported" with no explanation.
    // `notices` is NOT a second error list (§6.1). It carries the things the import DID that
    // a person should know about — a product auto-created, a brand or category that did not
    // match and was filed under a placeholder. They used to be pushed into `errors`, where a
    // successful import read as a failed one and, worse, left the pull stuck at PARTIAL.
    // `errors` keeps its meaning exactly: the record did not import.
    // `vendorCredits` / `creditNotes`: notes written or updated by this approve (plan 1210).
    const results = {
      contacts: 0, items: 0, bills: 0, invoices: 0, vendorCredits: 0, creditNotes: 0,
      skipped: 0, errors: [] as string[], notices: [] as string[],
    };

    // ONE Books client and AT MOST ONE location list per approve run. The locations are needed
    // only to resolve a warehouse sub-location to its parent store (storeIdForLocation), so they
    // are read lazily, and a failure falls back to exact location matches — it never fails an
    // import. Zakya is reached only for a bill a Zakya fetch found.
    let booksPromise: Promise<BooksClient | null> | null = null;
    const books = () =>
      (booksPromise ??= import("@/lib/integrations").then((m) => m.getBooks()));
    let locationsPromise: Promise<ZohoLocation[] | undefined> | null = null;
    const zohoLocations = () =>
      (locationsPromise ??= (async () => {
        const client = await books();
        if (!client) return undefined;
        try {
          const res = await client.listLocations();
          log.debug("locations read for store resolution", { pullId, locations: res.locations?.length ?? 0 });
          return res.locations ?? [];
        } catch (e) {
          log.warn("Zoho locations unavailable — stores resolve by exact location only", {
            pullId,
            message: e instanceof Error ? e.message : String(e),
          });
          return undefined;
        }
      })());
    /** The store linked to a Zoho location, its parent's store, else null. */
    const storeForLocation = async (locationId: string | null): Promise<string | null> => {
      if (!locationId) return null;
      return (await storeIdForLocation(locationId)) ?? (await storeIdForLocation(locationId, await zohoLocations()));
    };

    // Every active FLOOR warehouse carrying a prefix, for invoice attribution (plan
    // 1609-deliveries, T1). Loaded once, not per record — and only when this batch holds an
    // invoice, because the bill branch never reads it.
    const floors = previews.some((p) => p.entityType === "invoice")
      ? await listFloorWarehousesWithPrefix(prisma)
      : [];

    // Imported records are attributed to a system-role account when one exists, so the audit
    // trail doesn't credit whoever happened to click Approve.
    const adminUser = await prisma.user.findFirst({
      where: { role: { isSystem: true }, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    const systemUserId = adminUser?.id || user.id;

    // Bills that came in with no store (Part 2.2), reported once after the loop rather than once
    // per bill: until a store is linked to its Zoho location on /stores, every bill would say it.
    const billsWithoutStore: string[] = [];
    const unlinkedLocations = new Set<string>();

    for (const preview of previews) {
      const d = preview.data as Record<string, unknown>;
      try {
        if (preview.entityType === "bill") {
          const billNo = String(d.billNumber);
          const zohoBillId = preview.zohoId || null;
          const zohoVendorId = typeof d.vendorId === "string" && d.vendorId ? d.vendorId : null;
          const vendorSource = typeof d.vendorSource === "string" ? d.vendorSource : null;

          // ── Dedup FIRST: an existing shipment (plan 1210 Part 1.2, X2) ──
          // Before the detail read and before the vendor is resolved, so an already-received bill
          // never costs a Zoho read or creates a vendor. Matched by Zoho's bill id — on the
          // shipment, or on its bill — else by bill number AND vendor, never by number alone: two
          // suppliers' bill "1024" are two bills. The vendor is only LOOKED UP here, not created.
          const knownVendor = zohoVendorId
            ? await prisma.vendor.findUnique({ where: { zohoVendorId }, select: { id: true } })
            : null;
          const shipmentMatch: Prisma.InboundShipmentWhereInput[] = [
            ...(zohoBillId ? [{ zohoBillId }, { vendorBill: { zohoBillId } }] : []),
            ...(knownVendor ? [{ billNo, vendorBill: { vendorId: knownVendor.id } }] : []),
          ];
          const existsShipment = shipmentMatch.length
            ? await prisma.inboundShipment.findFirst({ where: { OR: shipmentMatch }, select: { id: true, shipmentNo: true } })
            : null;
          if (existsShipment) {
            // Not an error — a re-fetched window whose bills are already in is normal.
            results.skipped++;
            log.debug("bill already has a shipment", { billNo, zohoBillId, shipmentNo: existsShipment.shipmentNo });
            await prisma.zohoPullPreview.update({ where: { id: preview.id }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: user.id } });
            continue;
          }

          // ── The bill's detail, ALWAYS (Part 1.2) ──
          // Line items, the credits Zoho applied to it, and where it was booked all come from
          // here. A bill is NOT imported without it: `paidAmount = total − balance` already holds
          // any credit applied in Zoho, and only the detail says how much of it was credit. Without
          // that, the first credit pull would subtract the same credit a second time. The
          // preview stays PENDING, so importing again retries. The same provider that found the
          // bill is asked — Books and Zakya ids are separate spaces.
          let billClient: IntegrationClient | null;
          if (vendorSource === "pos") {
            const { getZakya } = await import("@/lib/integrations");
            billClient = await getZakya();
          } else {
            billClient = await books();
          }
          if (!billClient || !zohoBillId) {
            throw new Error(
              `Bill ${billNo}: ${vendorSource === "pos" ? "Zakya POS" : "Zoho Books"} is not connected, so its details cannot be read. Reconnect it and import again.`
            );
          }
          let detail;
          try {
            detail = (await billClient.getBill(zohoBillId)).bill;
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            log.warn("bill detail fetch failed", { pullId, previewId: preview.id, zohoBillId, message });
            throw new Error(`Bill ${billNo}: could not read its details from Zoho (${message}). Import it again.`);
          }
          if (!detail) throw new Error(`Bill ${billNo}: Zoho returned no detail for it. Import it again.`);

          const lineItems = (detail.line_items || []).map((li) => ({
            name: li.name, sku: li.sku || "", quantity: li.quantity, rate: li.rate, itemTotal: li.item_total, item_id: li.item_id,
          }));
          const locationId =
            (typeof detail.location_id === "string" && detail.location_id) ||
            (typeof d.locationId === "string" && d.locationId) ||
            null;
          // Credits applied to this bill in Zoho. `null` = the detail carries no list at all.
          const detailApps = Array.isArray(detail.vendor_credits)
            ? detail.vendor_credits.filter((a) => a && a.vendor_credit_bill_id && a.vendor_credit_id)
            : null;

          // Vendor by Zoho vendor id, never by name (plan 2409). Created once, with its Zoho
          // details, the first time an id is seen; a throw lands in this bill's catch below.
          const { vendor, notice: vendorNotice } = await resolveBillVendor({
            billNo,
            vendorName: String(d.vendorName || ""),
            vendorId: zohoVendorId,
            vendorSource,
          });
          if (vendorNotice) results.notices.push(vendorNotice);

          // ── An existing bill (e.g. from an accounting import): by Zoho's bill id, else by the
          //    compound unique (vendor, bill number) — after the vendor is resolved (X2) ──
          let existingVB: VendorBill | null = zohoBillId
            ? await prisma.vendorBill.findUnique({ where: { zohoBillId } })
            : null;
          if (!existingVB) {
            const sameNumber = await prisma.vendorBill.findUnique({
              where: { vendorId_billNo: { vendorId: vendor.id, billNo } },
            });
            if (sameNumber?.zohoBillId && sameNumber.zohoBillId !== zohoBillId) {
              log.warn("bill number already linked to a different Zoho bill", {
                billNo, vendorId: vendor.id, vendorBillId: sameNumber.id, zohoBillId,
              });
              throw new Error(
                `Bill ${billNo} of ${vendor.name} is already in the app, linked to a different Zoho bill. Check both in Zoho before importing.`
              );
            }
            existingVB = sameNumber;
          }

          // Store (Part 2.2): the Zoho location's store → the importer's pick → not set.
          const storeId = (await storeForLocation(locationId)) ?? pickedStoreId ?? null;

          // Total and balance from the DETAIL, the same snapshot creditAppliedAmount is read from.
          // The preview's figures are from fetch time: a credit applied in Zoho in between would be
          // inside the detail's credit total but not inside a paidAmount built from the preview's
          // balance — and the bill would stay short-settled for ever. The preview stands in only
          // when the detail leaves a figure out.
          const fromDetail = (v: unknown, fallback: unknown) => {
            const n = v === null || v === undefined || v === "" ? NaN : Number(v);
            return Number.isFinite(n) ? n : Number(fallback || 0);
          };
          const total = fromDetail(detail.total, d.total);
          const balance = fromDetail(detail.balance, d.balance);

          // Match products for line items — auto-create if not found.
          // Accounting (Bills & Payments) imports are FINANCIAL-ONLY: they must never
          // create products or touch the stock chain, so the whole loop is skipped for them.
          const matchedProducts: Array<{ li: typeof lineItems[0]; product: { id: string; currentStock: number } }> = [];

          // The brand for this bill — for its new products AND, further down, for the
          // InboundShipment header. Declared out here because the shipment code sits outside
          // the non-accounting block below; there used to be a SECOND find-or-create there,
          // so one bill had two chances to invent the same brand. Stays null on the
          // accounting path, which returns before the shipment is ever built.
          let itemBrand: ResolvedBrand | null = null;

          if (source !== "accounting") {
          // ─── Brand: RESOLVE, never invent (§6) ────────────────────────────────────────
          // This used to `brand.create` the bill's vendor name on every miss, which is how
          // the brand list filled up with distributor names. A vendor is not a brand. On a
          // miss the product is filed under the placeholder and the operator is told which
          // vendor it was, so they can create the real brand on /more/brands and fix it.
          const billVendorName = String(d.vendorName).trim();
          itemBrand = await prisma.brand.findFirst({
            where: { name: { equals: billVendorName, mode: "insensitive" } },
            select: BRAND_SELECT,
          });
          if (itemBrand) {
            log.info("brand resolved from vendor name", {
              billNo: String(d.billNumber), brandId: itemBrand.id,
            });
            // An inactive match is still the brand (identity is identity); the product is
            // filed under it and the person is told, rather than the import inventing a
            // second row or silently un-retiring this one.
            if (!itemBrand.isActive) {
              log.warn("resolved brand is inactive", { billNo: String(d.billNumber), brandId: itemBrand.id });
              results.notices.push(
                `Brand "${itemBrand.name}" is inactive — product filed under it; re-activate on /more/brands`
              );
            }
          } else {
            itemBrand = await resolvePlaceholderBrand(String(d.billNumber));
            log.warn("vendor name matches no brand — filing under placeholder", {
              billNo: String(d.billNumber), vendorName: billVendorName, brandId: itemBrand.id,
            });
            results.notices.push(`Brand "${billVendorName}" not found — product filed under ${FALLBACK_BRAND_NAME}`);
          }

          // Default category fallback — the shared placeholder name. READ ONLY (§6): the
          // row is seeded, and an import is not the thing that should be creating taxonomy.
          // If it is genuinely gone, this bill fails with an instruction rather than
          // quietly re-creating a row somebody may have deliberately renamed.
          const defaultCategory = await prisma.category.findFirst({
            where: { name: { equals: PLACEHOLDER_CATEGORY, mode: "insensitive" } },
            select: { id: true, name: true },
          });
          if (!defaultCategory) {
            log.error("placeholder category row missing", {
              billNo: String(d.billNumber), category: PLACEHOLDER_CATEGORY,
            });
            throw new Error(
              `Category "${PLACEHOLDER_CATEGORY}" is missing — run \`npm run db:seed\` and approve this pull again`
            );
          }

          // The client for fetching item details (category, HSN, tax). Same shared,
          // request-scoped client as the getBill call above — asking twice in one request
          // returns the same instance, so this costs nothing after the first bill.
          //
          // `any` is gone with it: getBooks() returns a typed BooksClient | null, and the
          // eslint-disable that suppressed the complaint is no longer needed.
          let zohoForItems: BooksClient | null = null;
          try {
            zohoForItems = await books();
          } catch (e) {
            // Best effort — a missing item detail costs category and HSN, not the import.
            // But a swallowed error with no log is a bug, so say what was lost.
            log.warn("item detail client unavailable; importing without category/HSN", {
              pullId,
              error: e instanceof Error ? e.message : String(e),
            });
          }

          for (let liIdx = 0; liIdx < lineItems.length; liIdx++) {
            const li = lineItems[liIdx];
            const zohoItemId = (li as Record<string, unknown>).item_id as string | undefined;

            // Try to find existing product: by zohoItemId, then SKU, then name
            let product = zohoItemId
              ? await prisma.product.findFirst({ where: { zohoItemId }, select: { id: true, currentStock: true } })
              : null;
            if (!product && li.sku) {
              product = await prisma.product.findFirst({ where: { sku: li.sku }, select: { id: true, currentStock: true } });
            }
            if (!product) {
              product = await prisma.product.findFirst({
                where: { name: { contains: li.name.substring(0, 20), mode: "insensitive" } },
                select: { id: true, currentStock: true },
              });
            }

            if (!product) {
              // Fetch item details from Zoho for category, HSN, tax
              let zohoCategoryName = "";
              // Zoho's own `category_id`. The Category row now carries it (`zohoCategoryId`,
              // migration 20260908090622), so the item's category can be resolved by a
              // stable handle instead of by a string that either side may have renamed.
              let zohoCategoryId = "";
              let zohoHsn = "";
              let zohoTax = 18;
              if (zohoForItems && zohoItemId) {
                try {
                  const detail = await zohoForItems.getItem(zohoItemId);
                  const item = detail.item || {};
                  zohoCategoryName = String(item.category_name || "").trim();
                  zohoCategoryId = String(item.category_id || "").trim();
                  zohoHsn = String(item.hsn_or_sac || "").trim();
                  zohoTax = Number(item.tax_percentage || 18);
                } catch (e) {
                  // Best effort — this costs category, HSN and tax, not the import. But it
                  // was a bare `catch {}`, so the loss left no trace anywhere.
                  log.warn("item detail fetch failed; category/HSN unknown", {
                    billNo: String(d.billNumber),
                    zohoItemId,
                    error: e instanceof Error ? e.message : String(e),
                  });
                }
              }

              // ─── Category: RESOLVE, never invent (§6) ───────────────────────────────
              // By Zoho's id first, then by name CASE-INSENSITIVELY, else the placeholder.
              // The old code did a case-SENSITIVE findFirst on a `@unique` name and created
              // on a miss: Zoho answering "Tyres" against a row named "tyres" therefore threw
              // a unique-constraint error that failed the whole bill, not just the line.
              let productCategory: { id: string; name: string } = defaultCategory;
              if (zohoCategoryId || zohoCategoryName) {
                const cat =
                  (zohoCategoryId
                    ? await prisma.category.findFirst({
                        where: { zohoCategoryId },
                        select: { id: true, name: true, isActive: true },
                      })
                    : null) ??
                  (zohoCategoryName
                    ? await prisma.category.findFirst({
                        where: { name: { equals: zohoCategoryName, mode: "insensitive" } },
                        select: { id: true, name: true, isActive: true },
                      })
                    : null);
                if (cat) {
                  productCategory = cat;
                  log.info("category resolved", {
                    billNo: String(d.billNumber), zohoItemId, categoryId: cat.id,
                  });
                  // Same rule as the brand above: an inactive match is used and reported.
                  if (!cat.isActive) {
                    results.notices.push(
                      `Bill ${d.billNumber}: category "${cat.name}" is inactive — "${li.name}" filed under it; re-activate on /categories`
                    );
                  }
                } else {
                  log.warn("zoho category matches no row — using placeholder", {
                    billNo: String(d.billNumber), zohoItemId, zohoCategoryId, zohoCategoryName,
                  });
                  results.notices.push(
                    `Bill ${d.billNumber}: category "${zohoCategoryName || zohoCategoryId}" not found — "${li.name}" filed under ${defaultCategory.name}`
                  );
                }
              }

              // Generate unique SKU — check for conflicts
              let sku = li.sku || "";
              if (sku) {
                const skuExists = await prisma.product.findFirst({ where: { sku }, select: { id: true } });
                if (skuExists) sku = ""; // clear so we auto-generate
              }
              if (!sku) {
                sku = `AUTO-${Date.now().toString(36).toUpperCase()}${liIdx}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
              }

              // Ensure zohoItemId uniqueness
              const safeZohoItemId = zohoItemId
                ? (await prisma.product.findFirst({ where: { zohoItemId }, select: { id: true } })) ? null : zohoItemId
                : null;

              product = await prisma.product.create({
                data: {
                  name: li.name,
                  sku,
                  costPrice: li.rate,
                  sellingPrice: li.rate,
                  mrp: li.rate,
                  gstRate: zohoTax,
                  hsnCode: zohoHsn || null,
                  currentStock: 0,
                  brandId: itemBrand.id,
                  categoryId: productCategory.id,
                  zohoItemId: safeZohoItemId,
                },
                select: { id: true, currentStock: true },
              });
              // A NOTICE, not an error (§6.1): this line succeeded. Reporting it as a failure
              // is what made a clean import look broken and held the pull at PARTIAL.
              log.info("product auto-created from bill line", {
                billNo: String(d.billNumber), productId: product.id, sku, categoryId: productCategory.id,
              });
              results.notices.push(`Bill ${d.billNumber}: auto-created "${li.name}" (${sku}) in ${productCategory.name}`);
            }
            matchedProducts.push({ li, product });
          }
          } // end if (source !== "accounting") — accounting imports stay financial-only

          // Calculate due date: use Zoho's dueDate unless it equals billDate (missing), then use vendor's payment terms
          const billDate = new Date(String(d.date));
          let dueDate = new Date(String(d.dueDate));
          if (dueDate.toISOString().slice(0, 10) === billDate.toISOString().slice(0, 10)) {
            dueDate = new Date(billDate);
            dueDate.setDate(dueDate.getDate() + (vendor.paymentTermDays || 30));
          }

          let vendorBill: VendorBill;
          let reusedExisting = !!existingVB;
          if (existingVB) {
            // ── Already here: stamp only what is missing (Part 1.3). Never the money: a bill
            //    typed on /bills carries payments recorded here, and those are not in Zoho yet. ──
            vendorBill = await stampExistingBill(existingVB, { zohoBillId, locationId, storeId });
          } else {
            try {
              vendorBill = await createImportedBill({
                billNo, vendorId: vendor.id, billDate, dueDate, total, balance,
                zohoBillId, locationId, storeId, detailApps,
                vendorCreditsApplied: detail.vendor_credits_applied,
              });
            } catch (e) {
              // A second approve of the same bill won the race: use its row as the existing bill.
              if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
              const raced =
                (await prisma.vendorBill.findUnique({ where: { zohoBillId } })) ??
                (await prisma.vendorBill.findUnique({ where: { vendorId_billNo: { vendorId: vendor.id, billNo } } }));
              if (!raced) throw e;
              log.warn("bill create raced — using the row created concurrently", { billNo, zohoBillId, vendorBillId: raced.id });
              vendorBill = raced;
              reusedExisting = true;
            }
          }
          if (!storeId && !vendorBill.storeId) {
            billsWithoutStore.push(billNo);
            if (locationId) unlinkedLocations.add(String(detail.location_name || locationId));
          }

          // ─── Create InboundShipment (only from inventory/inbound flow, not accounting) ───
          if (source === "accounting") {
            // A bill already in Bills, approved from /bills, only got its Zoho link: a skip, not
            // an import (Part 1.3).
            if (reusedExisting) results.skipped++;
            else results.bills++;
            await prisma.zohoPullPreview.update({
              where: { id: preview.id },
              data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: user.id },
            });
            continue;
          }

          // The shipment header's brand is the brand already resolved for this bill (§6).
          // A second find-or-create used to sit right here — the same vendor name, looked up
          // again and created again, so closing only the first path would have left the
          // second one inventing brands on its own. `InboundShipment.brandId` is non-null
          // (schema.prisma:1819) and the resolved-or-placeholder brand satisfies it.
          //
          // `itemBrand` is set by the non-accounting block above, and the accounting path
          // already returned at the `continue` a few lines up, so it is non-null here. The
          // check is type narrowing; if it ever fires, the bill fails loudly instead of
          // writing a shipment against a brand nobody chose.
          if (!itemBrand) {
            log.error("brand unresolved at shipment create", { billNo: String(d.billNumber) });
            throw new Error(`Bill ${d.billNumber}: brand was not resolved — shipment not created`);
          }
          const shipmentBrandId = itemBrand.id;

          // Lead time comes off the brand row already fetched above — it used to be a
          // separate BrandLeadTime lookup, i.e. a whole extra round trip INSIDE the
          // per-record import loop for a value that was already in memory.
          const leadDays = itemBrand.leadDays || 7;
          const expectedDeliveryDate = new Date(billDate);
          expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + leadDays);

          // Shipment number: IB-YYYYMM-0001, allocated atomically (§4 Counter).
          //
          // This is the worse of the two IB- allocators it replaces: a read-then-write
          // running INSIDE a loop that imports a whole batch within one 60-second function.
          // Every bill in the batch re-read "the last shipment number", so two concurrent
          // imports — or one import racing a manual create on /inbound — collided on a
          // unique column. Both allocators switch in the same change.
          const now = new Date();
          const prefix = `IB-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
          const shipmentNo = `${prefix}-${await nextSequence(prisma, prefix, 4, ibSeedSql(prefix))}`;

          const totalAmount = matchedProducts.reduce((s, { li }) => s + (li.itemTotal || li.rate * li.quantity), 0);

          // Auto-match pre-booked customers
          const waitingPreBookings = await prisma.preBooking.findMany({
            where: { status: "WAITING" },
          });

          const shipment = await prisma.inboundShipment.create({
            data: {
              shipmentNo,
              brandId: shipmentBrandId,
              billNo: String(d.billNumber),
              billDate,
              expectedDeliveryDate,
              totalAmount,
              totalItems: matchedProducts.length,
              createdById: systemUserId,
              vendorBillId: vendorBill.id,
              zohoBillId,
              lineItems: {
                create: matchedProducts.map(({ li, product }) => {
                  const preBookMatch = waitingPreBookings.find((pb) =>
                    li.name.toLowerCase().includes(pb.productName.toLowerCase().substring(0, 15))
                    || pb.productName.toLowerCase().includes(li.name.toLowerCase().substring(0, 15))
                  );
                  return {
                    productName: li.name,
                    productId: product.id,
                    sku: li.sku || null,
                    quantity: li.quantity,
                    rate: li.rate,
                    amount: li.itemTotal || li.rate * li.quantity,
                    preBookedCustomerName: preBookMatch?.customerName || null,
                    preBookedCustomerPhone: preBookMatch?.customerPhone || null,
                    preBookedInvoiceNo: preBookMatch?.zohoInvoiceNo || null,
                  };
                }),
              },
            },
            include: { lineItems: true },
          });

          // Update matched pre-bookings to MATCHED
          for (const sli of shipment.lineItems) {
            if (sli.preBookedInvoiceNo) {
              const pb = waitingPreBookings.find((p) => p.zohoInvoiceNo === sli.preBookedInvoiceNo);
              if (pb) {
                await prisma.preBooking.update({
                  where: { id: pb.id },
                  data: {
                    status: "MATCHED",
                    matchedShipmentId: shipment.id,
                    matchedLineItemId: sli.id,
                    expectedDate: expectedDeliveryDate,
                  },
                });
              }
            }
          }

          results.bills++;
        } else if (preview.entityType === "invoice") {
          const invoiceNo = String(d.invoiceNumber);

          // DEDUP FIRST, and it is no longer silent.
          //
          // This used to be a bare `continue` AFTER the detail fetch, which had three
          // consequences: a wasted Zoho round trip per duplicate, `results.invoices` never
          // incremented so re-imports were under-reported as "0 imported", and — worst — the
          // `continue` skipped the `preview.update` below, so the preview stayed PENDING
          // FOREVER and the pull could never leave PARTIAL.
          const exists = await prisma.delivery.findFirst({ where: { invoiceNo } });
          if (exists) {
            results.skipped++;
            log.debug("invoice already imported", { invoiceNo, deliveryId: exists.id });
            await prisma.zohoPullPreview.update({
              where: { id: preview.id },
              data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: user.id },
            });
            continue;
          }

          let fields: DeliveryFieldsFromInvoice | null = null;

          // ALWAYS fetch the detail, and ask the SAME provider that found it.
          //
          // Only `getBooks()` was tried before, so on a Zakya-only setup the detail call
          // returned nothing and every imported delivery arrived with no line items, no
          // address, no area and no pincode — the dispatch clerk had nothing to route by.
          // `provider` is written into the preview by trigger-pull (named `provider`, not
          // `source`, because this route already has a `source` body field meaning something
          // else entirely).
          if (preview.zohoId) {
            try {
              const { getBooks, getZakya } = await import("@/lib/integrations");
              const provider = String(d.provider || "");
              const zoho =
                provider === "pos"
                  ? (await getZakya()) ?? (await getBooks())
                  : provider === "books"
                    ? (await getBooks()) ?? (await getZakya())
                    : (await getZakya()) ?? (await getBooks());
              if (zoho) {
                const detail = await zoho.getInvoice(preview.zohoId);
                if (detail.invoice) fields = deliveryFieldsFromInvoiceDetail(detail.invoice);
              } else {
                results.errors.push(`Invoice ${invoiceNo}: no Zoho client to fetch details`);
              }
            } catch (e) {
              log.warn("invoice detail fetch failed", {
                pullId, previewId: preview.id, invoiceNo,
                message: e instanceof Error ? e.message : String(e),
              });
              results.errors.push(`Invoice ${invoiceNo}: failed to fetch details — ${e instanceof Error ? e.message : "Unknown"}`);
            }
          }

          // WHICH FLOOR WAREHOUSE sold it (plan 1609-deliveries, R31, T1, T3). RE-RESOLVED here,
          // never read from the preview: the preview's `warehouseId`/`storeId` were computed at
          // fetch time, and a prefix typed or changed on /stores since then must decide. No
          // match is a Dummy — both null, and deliberately no fallback to any store (A41b).
          const match = floorWarehouseForInvoice(invoiceNo, floors);
          if (!match) {
            log.info("invoice imported as Dummy — no floor prefix matched", {
              pullId, previewId: preview.id, invoiceNo, floors: floors.length,
            });
          }

          const previewLineItems =
            (d.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number; itemTotal: number }>) || [];

          // The detail supplies the rich fields; the PREVIEW wins on the four it already knows
          // authoritatively, because those came from the listing this import is approving.
          await prisma.delivery.create({
            data: {
              ...(fields ?? {}),
              invoiceNo,
              zohoInvoiceId: preview.zohoId,
              invoiceDate: new Date(String(d.date)),
              invoiceAmount: Number(d.total || 0),
              customerName: String(d.customerName),
              // +91-XXXXXXXXXX, as every phone in the deliveries flow is written (B3b).
              customerPhone: toPlus91(fields?.customerPhone ?? String(d.phone || "")),
              salesPerson: fields?.salesPerson || String(d.salesPerson || "") || null,
              // Zoho's payment snapshot at import (A31). The detail is fresher; the preview's
              // listing values stand in when the detail fetch did not happen or said nothing.
              zohoPaymentStatus:
                fields?.zohoPaymentStatus ?? (typeof d.status === "string" && d.status.trim() ? d.status.trim() : null),
              zohoBalance:
                fields?.zohoBalance ??
                (d.balance !== null && d.balance !== undefined && d.balance !== "" && Number.isFinite(Number(d.balance))
                  ? Number(d.balance)
                  : null),
              warehouseId: match?.warehouseId ?? null,
              storeId: match?.storeId ?? null,
              status: "PENDING",
              lineItems:
                fields && fields.lineItems.length > 0
                  ? fields.lineItems
                  : previewLineItems.length > 0
                    ? previewLineItems
                    : undefined,
            },
          });
          results.invoices++;
        } else if (preview.entityType === "vendorcredit" || preview.entityType === "creditnote") {
          // ─── Vendor credit / customer credit note (plan 1210, Parts 3.4 and 8.2) ───
          // One detail read and one transaction per note, in the lib files: the rules there are
          // the part that must be exactly right (nothing subtracted twice from a bill).
          const client = await books();
          if (!client) {
            throw new Error("Zoho Books is not connected, so this credit note cannot be read. Reconnect it and import again.");
          }
          if (preview.entityType === "vendorcredit") {
            const r = await syncVendorCredit(preview.zohoId, { books: client, locations: await zohoLocations() });
            results.notices.push(...r.notices);
            if (r.outcome === "skipped") results.skipped++;
            else results.vendorCredits++;
          } else {
            const r = await syncCustomerCreditNote(preview.zohoId, { books: client, locations: await zohoLocations() });
            results.notices.push(...r.notices);
            if (r.outcome === "skipped") results.skipped++;
            else results.creditNotes++;
          }
        } else {
          // zod admits only the four types above, but a preview row can carry an old type
          // ("contact", "item") from before those imports were removed. Say so rather than
          // marking it approved having done nothing.
          log.warn("preview of an unsupported type", { pullId, previewId: preview.id, entityType: preview.entityType });
          results.errors.push(`${preview.entityType} ${preview.zohoId}: this kind of record is no longer imported — reject it.`);
          continue;
        }

        await prisma.zohoPullPreview.update({
          where: { id: preview.id },
          data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: user.id },
        });
      } catch (e) {
        log.error("preview import failed", {
          pullId, previewId: preview.id, entityType: preview.entityType, zohoId: preview.zohoId,
          message: e instanceof Error ? e.message : String(e),
        });
        results.errors.push(`${preview.entityType} ${preview.zohoId}: ${e instanceof Error ? e.message : "Unknown"}`);
      }
    }

    if (billsWithoutStore.length > 0) {
      const shown = billsWithoutStore.slice(0, 5).join(", ") + (billsWithoutStore.length > 5 ? ` and ${billsWithoutStore.length - 5} more` : "");
      results.notices.push(
        `${billsWithoutStore.length} bill${billsWithoutStore.length === 1 ? " has" : "s have"} no store (${shown}). ` +
          (unlinkedLocations.size > 0
            ? `Link the Zoho location${unlinkedLocations.size === 1 ? "" : "s"} ${Array.from(unlinkedLocations).join(", ")} to a store on /stores, or pick the store when importing.`
            : "Pick the store when importing, or set it on each bill.")
      );
    }

    // Check if any previews are still pending (partial approval by entity type)
    const remainingPending = await prisma.zohoPullPreview.count({ where: { pullId, status: "PENDING" } });
    const newStatus = remainingPending > 0 ? "PARTIAL" : (results.errors.length > 0 ? "PARTIAL" : "APPROVED");

    await prisma.zohoPullLog.update({
      where: { pullId },
      data: { status: newStatus, approvedAt: remainingPending === 0 ? new Date() : undefined },
    });

    // The one durable record of what an approve actually did. Identifiers and counts only —
    // never the records themselves. This matters most in the case where the response never
    // arrives: if the function is killed at maxDuration the client sees a 504 with no body,
    // and without this line there is no way afterwards to tell what got in before the kill.
    log.info("approve finished", {
      pullId,
      requestedBy: user.id,
      entityType: entityType || "all",
      contacts: results.contacts,
      items: results.items,
      bills: results.bills,
      invoices: results.invoices,
      vendorCredits: results.vendorCredits,
      creditNotes: results.creditNotes,
      skipped: results.skipped,
      errors: results.errors.length,
      notices: results.notices.length,
      remainingPending,
      status: newStatus,
      ms: Date.now() - startedAt,
    });

    await logActivity(prisma, {
      module: "zoho", action: "imported", entityType: "ZohoPull", entityId: pullId, entityRef: pullId,
      details:
        `${results.invoices} deliveries, ${results.bills} bills, ${results.skipped} skipped` +
        (results.vendorCredits > 0 ? `, ${results.vendorCredits} vendor credits` : "") +
        (results.creditNotes > 0 ? `, ${results.creditNotes} customer credit notes` : ""),
      userId: user.id, userName: user.name,
    });

    return successResponse({
      action: "approved",
      entityType: entityType || "all",
      remainingPending,
      ...results,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Approval failed";
    log.error("approve failed", { message });
    return errorResponse(message, 500);
  }
}

// ─── The bill writes (plan 1210 credit notes, Parts 1.2 and 1.3) ───────────────────────────

type DetailCredit = { vendor_credit_id: string; vendor_credit_bill_id: string; date: string; amount: number };

/**
 * A bill already in the app, met again by an import: fill in only what it is missing — Zoho's
 * bill id, its location, its store. Money is never touched here (Part 1.3): a bill typed on /bills
 * carries payments recorded here that Zoho has not seen, so "correcting" it to Zoho's balance would
 * erase them.
 */
async function stampExistingBill(
  bill: VendorBill,
  { zohoBillId, locationId, storeId }: { zohoBillId: string | null; locationId: string | null; storeId: string | null },
): Promise<VendorBill> {
  const data: Prisma.VendorBillUncheckedUpdateInput = {};
  if (!bill.zohoBillId && zohoBillId) data.zohoBillId = zohoBillId;
  if (!bill.zohoLocationId && locationId) data.zohoLocationId = locationId;
  if (!bill.storeId && storeId) data.storeId = storeId;
  if (Object.keys(data).length === 0) return bill;
  const updated = await prisma.vendorBill.update({ where: { id: bill.id }, data });
  log.info("existing bill linked to Zoho", {
    vendorBillId: bill.id,
    zohoBillId,
    stampedId: "zohoBillId" in data,
    stampedLocation: "zohoLocationId" in data,
    stampedStore: "storeId" in data,
  });
  return updated;
}

/**
 * Create a bill from Zoho, in one transaction with the credit applications Zoho shows on it.
 *
 * `paidAmount = total − balance` already holds every credit applied in Zoho before this import,
 * and `creditAppliedAmount` records how much of it that is. Both come from the SAME bill detail,
 * so they agree, and the first credit sync afterwards moves `paidAmount` by zero (Part 3.4).
 */
async function createImportedBill(input: {
  billNo: string;
  vendorId: string;
  billDate: Date;
  dueDate: Date;
  total: number;
  balance: number;
  zohoBillId: string | null;
  locationId: string | null;
  storeId: string | null;
  detailApps: DetailCredit[] | null;
  vendorCreditsApplied: unknown;
}): Promise<VendorBill> {
  const { billNo, vendorId, billDate, dueDate, total, balance, zohoBillId, locationId, storeId, detailApps } = input;

  return prisma.$transaction(
    async (tx) => {
      // Applications a credit pull left waiting for this bill (Part 1.2). When the detail lists
      // the bill's credits, the upsert below links exactly those by Zoho's application id; a
      // waiting row NOT in the list was removed in Zoho since that pull, is not inside Zoho's
      // balance, and is left for the next credit fetch to prune — linking it would make the
      // bill's credit total disagree with paidAmount. Only when the detail carries no list at
      // all are the waiting rows the best record there is, and they are adopted.
      const waiting = zohoBillId
        ? await tx.vendorCreditApplication.findMany({
            where: { zohoBillId, billId: null },
            select: { id: true, zohoVendorCreditBillId: true, amount: true },
          })
        : [];
      const listed = new Set((detailApps ?? []).map((a) => a.vendor_credit_bill_id));
      const adopt = detailApps === null ? waiting : [];
      const stale = detailApps === null ? [] : waiting.filter((w) => !w.zohoVendorCreditBillId || !listed.has(w.zohoVendorCreditBillId));

      const rowsTotal = round2(
        detailApps !== null
          ? detailApps.reduce((s, a) => s + (Number(a.amount) || 0), 0)
          : adopt.reduce((s, a) => s + Number(a.amount), 0),
      );
      const zohoApplied = Number(input.vendorCreditsApplied);
      const creditApplied = Number.isFinite(zohoApplied) && input.vendorCreditsApplied !== null && input.vendorCreditsApplied !== undefined
        ? round2(zohoApplied)
        : rowsTotal;
      if (Math.abs(creditApplied - rowsTotal) > 0.01) {
        log.warn("bill's applied-credit total disagrees with its applications", {
          billNo, zohoBillId, vendorCreditsApplied: creditApplied, applications: rowsTotal,
        });
      }

      const created = await tx.vendorBill.create({
        data: {
          billNo,
          vendorId,
          billDate,
          dueDate,
          amount: total,
          paidAmount: total - balance,
          status: balance === 0 ? "PAID" : balance < total ? "PARTIALLY_PAID" : "PENDING",
          zohoBillId,
          zohoLocationId: locationId,
          storeId,
          creditAppliedAmount: toMoney(creditApplied),
        },
      });

      if (detailApps && detailApps.length > 0) {
        // The credit rows already here, in one read — a credit pulled before its bill.
        const credits = await tx.vendorCredit.findMany({
          where: { zohoVendorCreditId: { in: Array.from(new Set(detailApps.map((a) => a.vendor_credit_id))) } },
          select: { id: true, zohoVendorCreditId: true },
        });
        const creditByZohoId = new Map(credits.map((c) => [c.zohoVendorCreditId as string, c.id]));
        for (const a of detailApps) {
          const vendorCreditId = creditByZohoId.get(a.vendor_credit_id) ?? null;
          const row = {
            zohoVendorCreditId: a.vendor_credit_id,
            zohoBillId,
            billId: created.id,
            amount: toMoney(a.amount),
            appliedDate: zohoDate(a.date, `Bill ${billNo}'s credit application`),
          };
          await tx.vendorCreditApplication.upsert({
            where: { zohoVendorCreditBillId: a.vendor_credit_bill_id },
            create: { ...row, source: "ZOHO", vendorCreditId, zohoVendorCreditBillId: a.vendor_credit_bill_id },
            // A credit sync may have linked the credit already; never unlink it here.
            update: { ...row, ...(vendorCreditId ? { vendorCreditId } : {}) },
          });
        }
      }
      if (adopt.length > 0) {
        await tx.vendorCreditApplication.updateMany({
          where: { id: { in: adopt.map((a) => a.id) }, billId: null },
          data: { billId: created.id },
        });
      }
      if (stale.length > 0) {
        log.warn("waiting credit applications not on Zoho's bill — left for the next credit fetch", {
          billNo, zohoBillId, count: stale.length,
        });
      }

      log.info("bill imported from Zoho", {
        vendorBillId: created.id,
        zohoBillId,
        storeId,
        creditApplied,
        applications: detailApps?.length ?? adopt.length,
      });
      return created;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}
