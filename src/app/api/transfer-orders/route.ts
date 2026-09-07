export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  successResponse,
  errorResponse,
  paginatedResponse,
  parseSearchParams,
} from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { z } from "zod";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { getWarehouseBreakdown } from "@/lib/stock-location";
import { listWarehouses } from "@/lib/warehouses";
import { nextSequence } from "@/lib/sequence";
import { trfSeedSql, trfSequenceKey, currentTransferYm, TRF_SEQUENCE_PAD } from "@/lib/transfers/sequence";
import { deriveTransferPolicy } from "@/lib/transfers/policy";
import { logActivity } from "@/lib/activity-log";
import { istDayBounds } from "@/lib/services/timezone";
import { createLogger } from "@/lib/logger";
import type { TransferOrderStatus } from "@prisma/client";

const log = createLogger("transfer-orders");

const ALL_STATUSES: TransferOrderStatus[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "IN_TRANSIT",
  "RECEIVED",
];

const itemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1),
  fromBinId: z.string().optional(),
  toBinId: z.string().optional(),
  // The item lane is MIRRORED from the header, not chosen. These stay accepted so an older
  // client keeps working, and are refused below when they disagree with the header — silently
  // preferring one over the other is how a transfer would move stock out of a building nobody
  // named. The columns themselves are kept this release (CLAUDE.md rule 7: drop only after the
  // code stopped using them).
  fromWarehouseId: z.string().min(1).optional(),
  toWarehouseId: z.string().min(1).optional(),
});

const createSchema = z.object({
  // THE LANE IS ON THE HEADER NOW. An order is dispatched and received as one thing — one van,
  // one document, one e-way bill — so it has exactly one route. Per-item lanes made "dispatch
  // this order" a question with several answers.
  fromWarehouseId: z.string().min(1, "A source warehouse is required"),
  toWarehouseId: z.string().min(1, "A destination warehouse is required"),
  items: z.array(itemSchema).min(1, "At least one item is required"),
  notes: z.string().max(1000).optional(),
});

// GET: List transfer orders
export async function GET(req: NextRequest) {
  try {
    const user = await requireFeature("transfers", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    const status = searchParams.get("status");
    const toWarehouseId = searchParams.get("toWarehouseId") || undefined;

    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;

    // Scope: creators see their own; anyone who can approve OR act on a transfer sees all.
    //
    // `edit` is in here deliberately. Scoping on `approve` alone was the old rule, and under
    // P14 it strands the person the flow depends on: a receiving clerk holds `transfers.edit`
    // (that is what dispatch and receive require) but not `approve`, so they would have seen
    // only transfers they raised themselves — never the incoming van they are meant to receive.
    const [canApprove, canEdit] = await Promise.all([
      userCan(user.id, "transfers", "approve"),
      userCan(user.id, "transfers", "edit"),
    ]);
    const canSeeAll = canApprove || canEdit;

    // An unrecognised ?status= is ignored rather than cast. The old code asserted
    // `status as "PENDING" | "APPROVED" | "REJECTED"` — a lie once IN_TRANSIT existed, and one
    // that would have handed Prisma an invalid enum value straight from the query string.
    const statusFilter = ALL_STATUSES.find((s) => s === status);

    const where = {
      ...(!canSeeAll && { createdById: user.id }),
      ...(statusFilter && { status: statusFilter }),
      // The receiving clerk's "incoming to me" view, served by the [toWarehouseId] index.
      ...(toWarehouseId && { toWarehouseId }),
      // IST day bounds, not UTC ones.
      //
      // `new Date("2026-09-07")` is midnight UTC, which is 05:30 IST — so a transfer raised
      // at 07:00 IST fell OUTSIDE "today" and the dashboard EOD summary silently dropped
      // every transfer created before half past five in the morning. The `+"T23:59:59.999Z"`
      // on the other end had the mirror-image fault, pulling in the first five and a half
      // hours of the following day.
      //
      // The shop opens well before 05:30 during a delivery week, so this was not theoretical.
      ...((dateFrom || dateTo) && {
        createdAt: {
          ...(dateFrom && { gte: istDayBounds(dateFrom).start }),
          ...(dateTo && { lte: istDayBounds(dateTo).end }),
        },
      }),
    };

    const [orders, total] = await Promise.all([
      prisma.transferOrder.findMany({
        where,
        include: {
          createdBy: { select: { name: true } },
          reviewedBy: { select: { name: true } },
          // The header lane is what the list renders now — one route per card instead of one
          // per line. The store name rides along so the card can say "BCH Godown → BCC Godown"
          // and the detail screen can show the type chip without a second query.
          fromWarehouse: { select: { id: true, code: true, name: true, store: { select: { name: true } } } },
          toWarehouse: { select: { id: true, code: true, name: true, store: { select: { name: true } } } },
          items: {
            include: {
              product: { select: { name: true, sku: true, currentStock: true } },
              fromBin: { select: { code: true, name: true, location: true } },
              toBin: { select: { code: true, name: true, location: true } },
              // Still selected: an order raised before MIG-2, or one whose items genuinely
              // disagreed about the lane, has a null header and falls back to these.
              fromWarehouse: { select: { id: true, code: true, name: true } },
              toWarehouse: { select: { id: true, code: true, name: true } },
            },
          },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.transferOrder.count({ where }),
    ]);

    return paginatedResponse(orders, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to fetch transfer orders";
    log.error("transfer list failed", { message });
    return errorResponse(message, 500);
  }
}

/**
 * POST: raise a transfer order.
 *
 * ─── WHAT CHANGED IN P14, AND WHY EACH PIECE MOVED ────────────────────────────────────────
 *
 * 1. THE LANE IS ON THE HEADER. See `createSchema`.
 *
 * 2. NO STOCK MOVES HERE. The old route auto-approved for anyone holding `transfers.approve`
 *    and then moved the stock in the same breath — source down, destination up, at CREATE
 *    time. Under P14, approval agrees to a movement and dispatch performs it, because between
 *    two buildings there is a van and the units are in neither for an hour. Auto-approve still
 *    happens; it just lands in APPROVED with nothing moved.
 *
 * 3. THE ORDER NUMBER COMES FROM `nextSequence`, INSIDE THE TRANSACTION. It was a
 *    read-then-write ordered by `orderNo` as a STRING, running BEFORE the transaction opened —
 *    both halves of the bug P9 fixed for purchase orders. Two people pressing Create at the
 *    same moment both read TRF-202609-0006 and both tried to write 0007; `orderNo` is unique,
 *    so one of them lost their work to a raw P2002. And "TRF-202609-0002" sorts above
 *    "TRF-202609-00010", so past nine-hundred-odd transfers in a month it would have started
 *    handing out numbers that already existed.
 *
 * 4. THE DOCUMENT POLICY IS DERIVED AND STORED. A missing GSTIN refuses rather than defaulting
 *    to a delivery challan — see `deriveTransferPolicy`.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("transfers", "create");
    const body = await req.json();
    const data = createSchema.parse(body);

    if (data.fromWarehouseId === data.toWarehouseId) {
      return errorResponse("Source and destination must be different warehouses", 400);
    }

    // One query for the whole request. Membership in this list is what proves an id names a
    // real, ACTIVE warehouse — zod can only assert that a string arrived.
    const warehouses = await listWarehouses();
    const byId = new Map(warehouses.map((w) => [w.id, w]));
    const fromWh = byId.get(data.fromWarehouseId);
    const toWh = byId.get(data.toWarehouseId);
    if (!fromWh) return errorResponse("Source is not an active warehouse", 400);
    if (!toWh) return errorResponse("Destination is not an active warehouse", 400);

    // An item lane that disagrees with the header is a client that has not been updated, and
    // guessing which one it meant could move stock out of the wrong building.
    for (const item of data.items) {
      if (item.fromWarehouseId && item.fromWarehouseId !== data.fromWarehouseId) {
        return errorResponse("Every line moves along the order's route. Remove the per-line source warehouse.", 400);
      }
      if (item.toWarehouseId && item.toWarehouseId !== data.toWarehouseId) {
        return errorResponse("Every line moves along the order's route. Remove the per-line destination warehouse.", 400);
      }
    }

    const policyResult = deriveTransferPolicy(fromWh, toWh);
    if ("error" in policyResult) return errorResponse(policyResult.error, 400);
    const { transferType, requiredDocType } = policyResult.policy;

    const productIds = [...new Set(data.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, currentStock: true, name: true, costPrice: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    // A friendly up-front check so the person is told at the point of typing rather than at
    // dispatch. It is NOT the safety net — dispatch rechecks inside its own transaction, which
    // is the only check that can be trusted, because this one is read before any lock is held.
    const breakdown = await getWarehouseBreakdown(productIds);
    for (const item of data.items) {
      const product = productMap.get(item.productId);
      if (!product) return errorResponse(`Product not found: ${item.productId}`, 404);
      const available = breakdown.get(product.id)?.[fromWh.code] ?? 0;
      if (available < item.quantity) {
        return errorResponse(
          `Insufficient stock for ${product.name} at ${fromWh.name}. Available: ${available}`,
          400
        );
      }
    }

    if (BIN_TRACKING_ENABLED) {
      for (const item of data.items) {
        if (!item.fromBinId || !item.toBinId) {
          return errorResponse("Source and destination bins are required", 400);
        }
      }
    }

    // Auto-approve for anyone who could have approved it anyway — it saves a round trip and
    // records the same authoriser. It does NOT move stock; the receipt copy says so.
    const isAutoApprove = await userCan(user.id, "transfers", "approve");
    const status: TransferOrderStatus = isAutoApprove ? "APPROVED" : "PENDING";

    const result = await prisma.$transaction(async (tx) => {
      const ym = currentTransferYm();
      const prefix = `TRF-${ym}`;
      const seq = await nextSequence(tx, trfSequenceKey(ym), TRF_SEQUENCE_PAD, trfSeedSql(prefix));
      const orderNo = `${prefix}-${seq}`;

      const order = await tx.transferOrder.create({
        data: {
          orderNo,
          status,
          notes: data.notes || null,
          createdById: user.id,
          reviewedById: isAutoApprove ? user.id : null,
          reviewedAt: isAutoApprove ? new Date() : null,
          fromWarehouseId: fromWh.id,
          toWarehouseId: toWh.id,
          transferType,
          requiredDocType,
          items: {
            create: data.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              fromBinId: BIN_TRACKING_ENABLED ? item.fromBinId : null,
              toBinId: BIN_TRACKING_ENABLED ? item.toBinId : null,
              // Mirrored from the header. Kept so the item columns stay readable this release
              // and so anything still reading the item lane sees the same answer.
              fromWarehouseId: fromWh.id,
              toWarehouseId: toWh.id,
            })),
          },
        },
        include: {
          createdBy: { select: { name: true } },
          fromWarehouse: { select: { id: true, code: true, name: true } },
          toWarehouse: { select: { id: true, code: true, name: true } },
          items: {
            include: { product: { select: { name: true, sku: true } } },
          },
        },
      });

      await logActivity(tx, {
        module: "transfers",
        action: "created",
        entityType: "TransferOrder",
        entityId: order.id,
        entityRef: order.orderNo,
        toValue: status,
        details: `${fromWh.name} → ${toWh.name}, ${data.items.length} line${data.items.length === 1 ? "" : "s"}`,
        userId: user.id,
        userName: user.name,
      });

      return order;
    });

    log.info("transfer order created", {
      orderId: result.id,
      orderNo: result.orderNo,
      status,
      transferType,
      requiredDocType,
      lines: data.items.length,
    });

    return successResponse(result, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid transfer order", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to create transfer order";
    log.error("transfer create failed", { message });
    return errorResponse(message, 400);
  }
}
