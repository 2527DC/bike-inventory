export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, parseSearchParams } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { nextSequence } from "@/lib/sequence";
import { ibSeedSql } from "@/lib/inbound/sequence";
import { inboundShipmentSchema } from "@/lib/validations";
import { createLogger } from "@/lib/logger";

const log = createLogger("inbound");

// GET: List shipments
export async function GET(req: NextRequest) {
  try {
    await requireFeature("inbound", "view");
    const { limit, skip, searchParams } = parseSearchParams(req.url);
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;

    // "arriving_this_week" is a special filter
    const isArrivingThisWeek = status === "arriving_this_week";

    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (isArrivingThisWeek) {
      where.status = "IN_TRANSIT";
      where.expectedDeliveryDate = { lte: weekEnd };
    } else if (status && status !== "ALL") {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { billNo: { contains: search, mode: "insensitive" } },
        { shipmentNo: { contains: search, mode: "insensitive" } },
        { brand: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    if (dateFrom || dateTo) {
      where.billDate = {
        ...(dateFrom && { gte: new Date(dateFrom) }),
        ...(dateTo && { lte: new Date(dateTo + "T23:59:59.999Z") }),
      };
    }

    // Legacy mode: show old INWARD InventoryTransactions not linked to InboundShipments
    if (status === "LEGACY") {
      const legacyWhere: Record<string, unknown> = {
        type: "INWARD",
        NOT: { referenceNo: { startsWith: "IB-" } },
      };
      if (search) {
        legacyWhere.OR = [
          { referenceNo: { contains: search, mode: "insensitive" } },
          { notes: { contains: search, mode: "insensitive" } },
          { product: { name: { contains: search, mode: "insensitive" } } },
        ];
      }
      if (dateFrom || dateTo) {
        legacyWhere.createdAt = {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo + "T23:59:59.999Z") }),
        };
      }

      const [legacyTxns, legacyTotal] = await Promise.all([
        prisma.inventoryTransaction.findMany({
          where: legacyWhere,
          include: {
            product: { select: { name: true, sku: true, brand: { select: { name: true } } } },
            user: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.inventoryTransaction.count({ where: legacyWhere }),
      ]);

      // Group by referenceNo to look like shipments
      const grouped = new Map<string, {
        id: string; referenceNo: string; brandName: string; createdAt: string;
        createdBy: string; items: { productName: string; sku: string; quantity: number }[];
        totalQuantity: number;
      }>();
      for (const txn of legacyTxns) {
        const ref = txn.referenceNo || txn.id;
        if (!grouped.has(ref)) {
          grouped.set(ref, {
            id: txn.id,
            referenceNo: ref,
            brandName: txn.product.brand?.name || "Unknown",
            createdAt: txn.createdAt.toISOString(),
            createdBy: txn.user.name,
            items: [],
            totalQuantity: 0,
          });
        }
        const g = grouped.get(ref)!;
        g.items.push({ productName: txn.product.name, sku: txn.product.sku, quantity: txn.quantity });
        g.totalQuantity += txn.quantity;
      }

      return successResponse({ shipments: Array.from(grouped.values()), total: legacyTotal, isLegacy: true });
    }

    const [shipments, total] = await Promise.all([
      prisma.inboundShipment.findMany({
        where,
        include: {
          brand: { select: { name: true } },
          createdBy: { select: { name: true } },
          lineItems: { select: { productName: true, quantity: true, isDelivered: true } },
          _count: { select: { lineItems: true, preBookings: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.inboundShipment.count({ where }),
    ]);

    return successResponse({ shipments, total });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// POST: Create shipment from verified bill data
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("inbound", "create");
    const body = await req.json();
    const data = inboundShipmentSchema.parse(body);

    // Get brand lead time
    const brand = await prisma.brand.findUnique({
      where: { id: data.brandId },
      select: { leadDays: true },
    });
    // Still defaults to 7 for a brand that does not resolve — same behaviour as the old
    // `?? 7`, which fired when no BrandLeadTime row existed.
    const leadDays = brand?.leadDays ?? 7;

    const billDate = new Date(data.billDate);
    const expectedDeliveryDate = new Date(billDate);
    expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + leadDays);

    // Shipment number: IB-YYYYMM-0001, allocated atomically (§4 Counter).
    //
    // Was a read-then-write — findFirst ordered by shipmentNo desc, parse the tail, add one —
    // with two defects. Two people creating a shipment in the same month at the same moment
    // both read the same last number and both wrote it; `shipmentNo` is unique, so one of
    // them lost their work to a constraint error. And the ordering was a STRING sort, so
    // "IB-202609-0002" ranks above "IB-202609-00010" once the count passes four digits and
    // the allocator starts handing out numbers that already exist.
    //
    // `IB-` has two allocators — this one and the import loop in zoho/pull-review/approve —
    // and a unique series with two allocators is the real hazard, so both switch together.
    const now = new Date();
    const prefix = `IB-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const shipmentNo = `${prefix}-${await nextSequence(prisma, prefix, 4, ibSeedSql(prefix))}`;

    const totalAmount = data.lineItems.reduce((s, li) => s + li.amount, 0);

    // Fuzzy match product names to existing products
    const matchedItems = await Promise.all(
      data.lineItems.map(async (li) => {
        if (li.productId) return li; // already matched by user
        // Try exact SKU match first
        if (li.sku) {
          const bysku = await prisma.product.findUnique({
            where: { sku: li.sku },
            select: { id: true, sku: true },
          });
          if (bysku) return { ...li, productId: bysku.id, sku: bysku.sku };
        }
        // Try name search
        const matches = await prisma.product.findMany({
          where: { name: { contains: li.productName.substring(0, 20), mode: "insensitive" } },
          select: { id: true, sku: true, name: true },
          take: 1,
        });
        if (matches.length > 0) {
          return { ...li, productId: matches[0].id, sku: matches[0].sku };
        }
        return li;
      })
    );

    // Auto-match pre-booked customers
    const waitingPreBookings = await prisma.preBooking.findMany({
      where: { status: "WAITING" },
    });

    const shipment = await prisma.inboundShipment.create({
      data: {
        shipmentNo,
        brandId: data.brandId,
        billNo: data.billNo,
        billImageUrl: data.billImageUrl || "",
        billPdfUrl: data.billPdfUrl || null,
        billDate,
        expectedDeliveryDate,
        totalAmount,
        totalItems: data.lineItems.length,
        notes: data.notes,
        createdById: user.id,
        lineItems: {
          create: matchedItems.map((li) => {
            // Check for pre-booking match
            const preBookMatch = waitingPreBookings.find((pb) =>
              li.productName.toLowerCase().includes(pb.productName.toLowerCase().substring(0, 15))
              || pb.productName.toLowerCase().includes(li.productName.toLowerCase().substring(0, 15))
            );

            return {
              productName: li.productName,
              productId: li.productId || null,
              sku: li.sku || null,
              quantity: li.quantity,
              rate: li.rate,
              gstPercent: li.gstPercent || 0,
              gstAmount: li.gstAmount || 0,
              amount: li.amount,
              hsn: li.hsn || null,
              preBookedCustomerName: preBookMatch?.customerName || null,
              preBookedCustomerPhone: preBookMatch?.customerPhone || null,
              preBookedInvoiceNo: preBookMatch?.zohoInvoiceNo || null,
            };
          }),
        },
      },
      include: {
        brand: { select: { name: true } },
        lineItems: true,
        createdBy: { select: { name: true } },
      },
    });

    // Update matched pre-bookings
    for (const li of shipment.lineItems) {
      if (li.preBookedInvoiceNo) {
        const pb = waitingPreBookings.find((p) => p.zohoInvoiceNo === li.preBookedInvoiceNo);
        if (pb) {
          await prisma.preBooking.update({
            where: { id: pb.id },
            data: {
              status: "MATCHED",
              matchedShipmentId: shipment.id,
              matchedLineItemId: li.id,
              expectedDate: expectedDeliveryDate,
            },
          });
        }
      }
    }

    // Push draft bill to Zoho (best effort)
    try {
      // getInventory(), which initialises. This used to be `new InventoryClient()` with NO
      // init() call at all, so apiCall threw "Zoho Inventory client not initialized" on
      // every attempt and the catch below logged it as a non-critical warning. The draft
      // push has therefore never once succeeded — a silent failure that looked like a
      // working feature because the shipment itself was created fine.
      const { getInventory } = await import("@/lib/integrations");
      const zohoInv = await getInventory();
      if (!zohoInv) {
        log.info("Zoho Inventory not connected; skipping the draft push", { shipmentNo });
        return successResponse(shipment, 201);
      }

      const brand = await prisma.brand.findUnique({ where: { id: data.brandId }, select: { name: true } });
      await zohoInv.createItem({
        name: `Inbound: ${brand?.name || "Unknown"} - ${data.billNo}`,
        sku: shipmentNo,
        purchase_rate: totalAmount,
        item_type: "inventory",
        product_type: "goods",
      });
    } catch (zohoErr) {
      log.warn("Zoho draft push failed (non-critical)", {
        error: zohoErr instanceof Error ? zohoErr.message : String(zohoErr),
      });
    }

    return successResponse(shipment, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
