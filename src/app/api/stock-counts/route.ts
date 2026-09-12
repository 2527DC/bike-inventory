export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { stockCountSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { getWarehouseQtyMap, getStoreQtyMap } from "@/lib/stock-location";
import { nextSequence } from "@/lib/sequence";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";
import { Prisma } from "@prisma/client";

const log = createLogger("stock-counts");

export async function GET(req: NextRequest) {
  try {
    const user = await requireFeature("stock_audit", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    // Comma-separated, so the dashboard can ask for PENDING,IN_PROGRESS in one request
    // instead of two. A single value still works — `split` gives a one-element list.
    const statusParam = searchParams.get("status") || undefined;
    const statuses = statusParam?.split(",").map((s) => s.trim()).filter(Boolean);

    // `mine=1` forces "assigned to me" EVEN FOR APPROVERS. Without it an approver's dashboard
    // widget would show the whole team's audits under the heading "My stock audits", because
    // the isAdmin branch below widens the query for them.
    const mine = searchParams.get("mine") === "1";

    // Non-admins only see their own assigned stock counts
    const isAdmin = await userCan(user.id, "stock_audit", "approve");

    const where = {
      ...(statuses && statuses.length > 0 && { status: { in: statuses } }),
      ...((mine || !isAdmin) && { assignedToId: user.id }),
    };

    const [counts, total] = await Promise.all([
      prisma.stockCount.findMany({
        where,
        include: {
          assignedTo: { select: { name: true } },
          store: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          bin: { select: { id: true, code: true, name: true, directions: true, floor: true, zone: true } },
          _count: { select: { items: true } },
          items: { select: { countedQty: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.stockCount.count({ where }),
    ]);

    const data = counts.map((c) => {
      const countedItems = c.items.filter((i) => i.countedQty !== null).length;
      return {
        id: c.id,
        countNo: c.countNo,
        title: c.title,
        assignedTo: c.assignedTo,
        status: c.status,
        dueDate: c.dueDate,
        completedAt: c.completedAt,
        notes: c.notes,
        createdAt: c.createdAt,
        totalItems: c._count.items,
        countedItems,
        // The scope, so the list can say WHERE each audit is without a second request.
        // `assignedToId` is returned because the detail screen decides Start/Complete from
        // "am I the assignee", and it had no way to know.
        assignedToId: c.assignedToId,
        store: c.store,
        warehouse: c.warehouse,
        bin: c.bin,
        scopeLabel: c.bin
          ? `${c.warehouse?.name ?? c.store?.name ?? "Warehouse"} · Bin ${c.bin.code}${c.bin.floor ? ` (Fl ${c.bin.floor})` : ""}`
          : c.warehouse?.name ?? (c.store ? `${c.store.name} — whole store` : "Legacy audit — no location"),
      };
    });

    return paginatedResponse(data, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch stock counts", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("stock_audit", "create");
    const body = await req.json();
    const data = stockCountSchema.parse(body);

    // Must assign to someone
    if (!data.assignedToId) return errorResponse("You must assign the stock count to a team member", 400);
    const isSelfCount = body.selfCount === true;
    if (data.assignedToId === user.id && !isSelfCount) return errorResponse("You cannot assign a stock count to yourself", 400);

    let productIds = data.productIds;
    const binId = body.binId as string | undefined;

    // ─── SCOPE (R2) ───────────────────────────────────────────────────────────────────────
    //
    // Replaces the free-text `location` string plus a product type. An audit used to be
    // scoped by a value nothing validated, which is why an assigned audit could open on an
    // empty page: the counter was told neither which store nor which building.
    //
    // The store is loaded WITH its active warehouses so both checks below are one query.
    const store = await prisma.store.findUnique({
      where: { id: data.storeId },
      select: {
        id: true,
        name: true,
        isActive: true,
        warehouses: { where: { isActive: true }, select: { id: true, name: true } },
      },
    });
    if (!store) return errorResponse("That store does not exist", 400);
    if (!store.isActive) {
      return errorResponse(`${store.name} is not active — pick a store that is in use`, 400);
    }

    // A warehouse from another store would silently count the wrong building.
    let scopedWarehouse: { id: string; name: string } | null = null;
    if (data.warehouseId) {
      const match = store.warehouses.find((w) => w.id === data.warehouseId);
      if (!match) {
        return errorResponse(
          `That warehouse is not an active warehouse of ${store.name}`,
          400
        );
      }
      scopedWarehouse = match;
    }

    // Bin scope (R15): Validate bin and resolve its warehouse if not explicit
    let scopedBin: { id: string; code: string; name: string; warehouseId: string; directions: string | null; floor: string | null; zone: string | null } | null = null;
    if (binId) {
      scopedBin = await prisma.bin.findUnique({
        where: { id: binId },
        select: { id: true, code: true, name: true, warehouseId: true, directions: true, floor: true, zone: true },
      });
      if (!scopedBin) return errorResponse("Bin not found", 400);

      if (scopedWarehouse && scopedBin.warehouseId !== scopedWarehouse.id) {
        return errorResponse(`Bin ${scopedBin.code} does not belong to warehouse ${scopedWarehouse.name}`, 400);
      }
      if (!scopedWarehouse) {
        const binWarehouse = store.warehouses.find((w) => w.id === scopedBin!.warehouseId);
        if (binWarehouse) {
          scopedWarehouse = binWarehouse;
        }
      }
    }

    const binQtyMap = new Map<string, number>();
    if (scopedBin) {
      // 1. BinStock table quantities
      const binStocks = await prisma.binStock.findMany({
        where: { binId: scopedBin.id },
        select: { productId: true, quantity: true },
      });
      for (const bs of binStocks) {
        binQtyMap.set(bs.productId, (binQtyMap.get(bs.productId) ?? 0) + bs.quantity);
      }

      // 2. InventoryUnit counts (cycles assigned to this bin)
      const unitsInBin = await prisma.inventoryUnit.groupBy({
        by: ["productId"],
        where: { binId: scopedBin.id, status: { notIn: ["SOLD", "TRANSFERRED", "LOST"] } },
        _count: { id: true },
      });
      for (const u of unitsInBin) {
        const existingQty = binQtyMap.get(u.productId) ?? 0;
        binQtyMap.set(u.productId, Math.max(existingQty, u._count.id));
      }
    }

    let binIds: string[] | undefined;
    if (!productIds || productIds.length === 0) {
      if (scopedBin) {
        // Bin audit mode: include products present in this bin
        const binProductIds = Array.from(binQtyMap.keys());
        if (binProductIds.length > 0) {
          productIds = binProductIds;
        } else {
          // If no specific stock rows yet, find products mapped by binId or warehouse
          const productsInBin = await prisma.product.findMany({
            where: { status: "ACTIVE", binId: scopedBin.id },
            select: { id: true },
          });
          if (productsInBin.length > 0) {
            productIds = productsInBin.map((p) => p.id);
          }
        }
      }

      if (!productIds || productIds.length === 0) {
        // Baseline mode: include ALL active products
        const allProducts = await prisma.product.findMany({
          where: {
            status: "ACTIVE",
          },
          select: { id: true },
        });

        if (allProducts.length === 0) {
          return errorResponse("No active products found for this filter.", 400);
        }

        productIds = allProducts.map((p) => p.id);
      }
    }

    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, currentStock: true, binId: true },
    });

    const scopeQtyMap = scopedWarehouse
      ? await getWarehouseQtyMap(productIds, scopedWarehouse.id)
      : await getStoreQtyMap(productIds, store.id);

    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

    // R15: Prepare items and order largest system quantity first
    const itemsToCreate = products.map((p) => {
      const qty = scopedBin
        ? (binQtyMap.get(p.id) ?? 0)
        : (scopeQtyMap.get(p.id) ?? 0);
      return {
        productId: p.id,
        systemQty: qty,
      };
    });
    // Sort descending by system quantity so counter starts from largest stock
    itemsToCreate.sort((a, b) => b.systemQty - a.systemQty);

    const stockCount = await prisma.$transaction(async (tx) => {
      const countNo = `SC-${ym}-${await nextSequence(
        tx,
        `SC-${ym}`,
        4,
        Prisma.sql`SELECT COALESCE(MAX(NULLIF(regexp_replace(split_part("countNo", '-', 3), '\\D', '', 'g'), '')::int), 0) FROM "StockCount" WHERE "countNo" LIKE ${`SC-${ym}-%`}`
      )}`;

      const created = await tx.stockCount.create({
        data: {
          countNo,
          title: data.title,
          assignedToId: data.assignedToId || user.id,
          binId: scopedBin?.id ?? null,
          storeId: store.id,
          warehouseId: scopedWarehouse?.id ?? (scopedBin ? scopedBin.warehouseId : null),
          dueDate: new Date(data.dueDate),
          notes: data.notes,
          items: {
            create: itemsToCreate,
          },
        },
        include: {
          assignedTo: { select: { name: true } },
          store: { select: { name: true } },
          warehouse: { select: { name: true } },
          bin: { select: { id: true, code: true, name: true, directions: true, floor: true, zone: true } },
          _count: { select: { items: true } },
        },
      });

      // Inside the transaction: the log is part of the change
      await logActivity(tx, {
        module: "stock_audit",
        action: "created",
        entityType: "StockCount",
        entityId: created.id,
        entityRef: created.countNo,
        toValue: "PENDING",
        details: scopedBin
          ? `${store.name} · Bin ${scopedBin.code} · ${products.length} products`
          : scopedWarehouse
          ? `${store.name} · ${scopedWarehouse.name} · ${products.length} products`
          : `${store.name} · whole store (verify only) · ${products.length} products`,
        userId: user.id,
        userName: user.name,
      });

      return created;
    });

    log.info("stock count created", {
      countNo: stockCount.countNo,
      storeId: store.id,
      warehouseId: scopedWarehouse?.id ?? null,
      items: products.length,
      assignedToId: stockCount.assignedToId,
    });

    return successResponse(stockCount, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to create stock count";
    log.error("stock count create failed", { message });
    return errorResponse(message, 400);
  }
}
