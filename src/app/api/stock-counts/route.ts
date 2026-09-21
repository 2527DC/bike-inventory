export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { stockCountSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { getBinQtyMap } from "@/lib/units/bin-qty";
import { productIdsForBinRules } from "@/lib/bins/rule-products";
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
    // safeParse, not parse: a thrown ZodError used to reach the catch below and go back to the
    // screen as its raw JSON issue list ("expected string, received undefined" under a
    // "storeId" path). The person needs the sentence, and the log needs the field.
    const parsed = stockCountSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      log.warn("stock count refused", { field: issue?.path.join("."), code: issue?.code });
      return errorResponse(issue?.message ?? "Invalid stock count", 400);
    }
    const data = parsed.data;

    // Must assign to someone
    if (!data.assignedToId) return errorResponse("You must assign the stock count to a team member", 400);
    const isSelfCount = body.selfCount === true;
    if (data.assignedToId === user.id && !isSelfCount) return errorResponse("You cannot assign a stock count to yourself", 400);

    let productIds = data.productIds;
    const binId = data.binId;

    // ─── SCOPE (R2) ───────────────────────────────────────────────────────────────────────
    //
    // Replaces the free-text `location` string plus a product type. An audit used to be
    // scoped by a value nothing validated, which is why an assigned audit could open on an
    // empty page: the counter was told neither which store nor which building.
    //
    // Since plan 1509-stock-count-scope-by-warehouse (D1, D2) every new count is ONE warehouse
    // — a Floor or a Godown — of one store. There is no whole-store create any more, and the
    // store is never derived from a bin: the schema requires both ids, so a caller that sends
    // neither is refused with a sentence instead of guessed at. Since plan 2109 (R36) a bin is
    // required as well. Audits saved without one still approve through [id]/route.ts, as
    // verify-only.
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
    const scopedWarehouse = store.warehouses.find((w) => w.id === data.warehouseId);
    if (!scopedWarehouse) {
      log.warn("stock count refused", { reason: "warehouse not in store", storeId: store.id, warehouseId: data.warehouseId });
      return errorResponse(`That warehouse is not an active warehouse of ${store.name}`, 400);
    }

    // Bin scope: REQUIRED since plan 2109 (R36) — every new audit is one bin — and only inside
    // the chosen warehouse. Before 1509 a bin from another store was accepted and its warehouse
    // written under the wrong store.
    const scopedBin = await prisma.bin.findUnique({
      where: { id: binId },
      select: { id: true, code: true, name: true, warehouseId: true, isActive: true },
    });
    if (!scopedBin) return errorResponse("Bin not found", 400);
    if (scopedBin.warehouseId !== scopedWarehouse.id) {
      log.warn("stock count refused", { reason: "bin not in warehouse", binId, warehouseId: scopedWarehouse.id });
      return errorResponse(`Bin ${scopedBin.code} is not in ${scopedWarehouse.name}`, 400);
    }
    if (!scopedBin.isActive) {
      log.warn("stock count refused", { reason: "bin inactive", binId });
      return errorResponse(`Bin ${scopedBin.code} is not active — pick a bin that is in use`, 400);
    }

    // What the bin holds, per product — the SAME figure the approval compares against
    // (`getBinQtyMap`, R33). It used to be max(BinStock, units) here and the warehouse total at
    // approval, so the counter was shown one number and the approval applied another.
    const binQtyMap = await getBinQtyMap(scopedBin.id);

    // Which products the count starts with:
    //   - the caller's list (a brand count sends its brand's products, Q5), or
    //   - every active product matching BOTH the brand and the category of one of this bin's
    //     home-bin rules (plan 2109-bin-audit-lists-rule-products, R1, R2), on every count, or
    //   - NOTHING, for a bin with no such rules. The counter adds what they find by search
    //     (POST /api/stock-counts/[id]/items).
    // A rule product the bin does not hold starts at system 0 (`binQtyMap` below). An item the
    // bin holds that no rule covers is not listed; the owner's answer (Q2). An unlisted line is
    // never changed by the approval.
    // Replaced here: "every product recorded in this bin" (plan 2109 Q26), and before that the
    // fallback to EVERY active product (~5,745 lines).
    let fromRules = false;
    if (!productIds || productIds.length === 0) {
      productIds = await productIdsForBinRules(scopedBin.id);
      fromRules = true;
    }

    const products = productIds.length
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true },
        })
      : [];

    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

    // R15: Prepare items and order largest system quantity first
    const itemsToCreate = products.map((p) => ({
      productId: p.id,
      systemQty: binQtyMap.get(p.id) ?? 0,
    }));
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
          binId: scopedBin.id,
          storeId: store.id,
          warehouseId: scopedWarehouse.id,
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
        details: `${store.name} · ${scopedWarehouse.name} · Bin ${scopedBin.code} · ${products.length} products`,
        userId: user.id,
        userName: user.name,
      });

      return created;
    });

    log.info("stock count created", {
      countNo: stockCount.countNo,
      storeId: store.id,
      warehouseId: scopedWarehouse.id,
      binId: scopedBin.id,
      items: products.length,
      fromRules,
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
