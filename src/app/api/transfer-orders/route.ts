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
import { listWarehouses, type WarehouseRef } from "@/lib/warehouses";
import { nextSequence } from "@/lib/sequence";
import { trfSeedSql, trfSequenceKey, currentTransferYm, TRF_SEQUENCE_PAD } from "@/lib/transfers/sequence";
import { docTypeForMode, resolveStoreWarehouse } from "@/lib/transfers/mode";
import { tryGetStorage } from "@/lib/storage";
import { logActivity } from "@/lib/activity-log";
import { istDayBounds } from "@/lib/services/timezone";
import { createLogger } from "@/lib/logger";
import type { TransferOrderStatus } from "@prisma/client";

const log = createLogger("transfer-orders");

/** The key prefix every transfer document is filed under — see `ALLOWED_PREFIXES`. */
const TRANSFER_DOC_PREFIX = "transfers/";

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

/**
 * The document that travels with the transfer, attached AT CREATION (owner, 9 Sep 2026: the
 * file is required; the number and date are optional — "it's just we upload a file"). The
 * file has already been PUT to storage by the browser under `transfers/…`; `url` is what the
 * bucket answered. Its type is not chosen here: `docTypeForMode` decides it.
 */
const documentSchema = z.object({
  url: z.string().trim().min(1, "The document file is required"),
  number: z.string().trim().max(40, "The document number is at most 40 characters").optional(),
  date: z.string().trim().optional(),
});

// THE LANE IS ON THE HEADER. An order is dispatched and received as one thing — one van, one
// document, one e-way bill — so it has exactly one route. Per-item lanes made "dispatch this
// order" a question with several answers.
//
// The header is a DISCRIMINATED UNION on `mode`, not four optional ids, so the server cannot
// be handed a half-filled body (a `toStoreId` beside a `toWarehouseId`, or neither). The
// source is always a STORE — it resolves to that store's floor — and the destination is a
// store in one mode and any active warehouse in the other.
const commonSchema = {
  fromStoreId: z.string().min(1, "A source store is required"),
  items: z.array(itemSchema).min(1, "At least one item is required"),
  notes: z.string().max(1000).optional(),
  document: documentSchema,
};

const createSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("STORE_TO_STORE"),
    toStoreId: z.string().min(1, "A destination store is required"),
    ...commonSchema,
  }),
  z.object({
    mode: z.literal("STORE_TO_WAREHOUSE"),
    toWarehouseId: z.string().min(1, "A destination warehouse is required"),
    ...commonSchema,
  }),
  z.object({
    mode: z.literal("GODOWN_TO_FLOOR"),
    fromWarehouseId: z.string().min(1, "A source godown is required").optional(),
    toWarehouseId: z.string().min(1, "A destination floor is required"),
    ...commonSchema,
  }),
]);

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
 * 4. THE DOCUMENT IS CHOSEN BY THE MODE AND ATTACHED HERE. Store → Store carries a tax invoice,
 *    Store → Warehouse a delivery challan (`docTypeForMode`), and the file is required in the
 *    create body. The stores' GSTINs are NOT consulted — the rule that refused a transfer while
 *    a GSTIN was blank (`deriveTransferPolicy`) was deleted on the owner's instruction,
 *    9 Sep 2026. `requiredDocType` is still written, because the dispatch gate, the detail
 *    chip and the document card all read it.
 *
 * 5. A STORE IS PICKED, A WAREHOUSE IS STORED. Stock lives in warehouses, so the store on the
 *    form resolves to its floor (`resolveStoreWarehouse`) and the lane columns hold warehouse
 *    ids as before. `fromStoreId`/`toStoreId` are kept as a snapshot of what was chosen, so a
 *    store whose floor is re-pointed later still reads correctly in history.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("transfers", "create");
    const body = await req.json();
    const data = createSchema.parse(body);
    const { mode, fromStoreId } = data;
    const toStoreId = mode === "STORE_TO_STORE" ? data.toStoreId : null;

    // ── The lane ─────────────────────────────────────────────────────────────────────────
    // The source is always a store, resolved to its floor. The destination is a store in
    // STORE_TO_STORE (resolved the same way) and any active warehouse in STORE_TO_WAREHOUSE.
    // `listWarehouses()` membership is what proves an id names a real, ACTIVE warehouse — zod
    // can only assert that a string arrived.
    let fromWh: WarehouseRef | undefined;
    let toWh: WarehouseRef | undefined;

    if (mode === "GODOWN_TO_FLOOR") {
      const warehouses = await listWarehouses();
      if (data.fromWarehouseId) {
        fromWh = warehouses.find((w) => w.id === data.fromWarehouseId);
      } else {
        fromWh = warehouses.find((w) => w.storeId === fromStoreId && w.kind === "GODOWN");
      }
      if (!fromWh) {
        log.warn("transfer refused: godown warehouse", { mode, fromStoreId, fromWarehouseId: data.fromWarehouseId });
        return errorResponse("Source godown warehouse not found or not active", 400);
      }

      toWh = warehouses.find((w) => w.id === data.toWarehouseId);
      if (!toWh) {
        log.warn("transfer refused: destination floor", { mode, toWarehouseId: data.toWarehouseId });
        return errorResponse("Destination floor warehouse not found or not active", 400);
      }
    } else {
      const fromResolved = await resolveStoreWarehouse(fromStoreId);
      if ("error" in fromResolved) {
        log.warn("transfer refused: source store", { mode, fromStoreId });
        return errorResponse(fromResolved.error, 400);
      }
      fromWh = fromResolved.warehouse;

      if (mode === "STORE_TO_STORE") {
        const toResolved = await resolveStoreWarehouse(data.toStoreId);
        if ("error" in toResolved) {
          log.warn("transfer refused: destination store", { mode, toStoreId: data.toStoreId });
          return errorResponse(toResolved.error, 400);
        }
        toWh = toResolved.warehouse;
      } else {
        const warehouses = await listWarehouses();
        toWh = warehouses.find((w) => w.id === data.toWarehouseId);
        if (!toWh) {
          log.warn("transfer refused: destination warehouse", { mode, toWarehouseId: data.toWarehouseId });
          return errorResponse("Destination is not an active warehouse", 400);
        }
      }
    }

    // Two stores can resolve to one warehouse (a store with no floor falls back to its first
    // warehouse), and in STORE_TO_WAREHOUSE the picked warehouse may be the very floor the
    // source store resolved to. Either way the stock would move to itself.
    if (fromWh.id === toWh.id) {
      log.warn("transfer refused: same warehouse", { mode, fromStoreId, toStoreId, warehouseId: fromWh.id });
      return errorResponse(
        `Source and destination must be different: both resolve to ${fromWh.name} (${fromWh.code}).`,
        400
      );
    }

    // An item lane that disagrees with the header is a client that has not been updated, and
    // guessing which one it meant could move stock out of the wrong building.
    for (const item of data.items) {
      if (item.fromWarehouseId && item.fromWarehouseId !== fromWh.id) {
        return errorResponse("Every line moves along the order's route. Remove the per-line source warehouse.", 400);
      }
      if (item.toWarehouseId && item.toWarehouseId !== toWh.id) {
        return errorResponse("Every line moves along the order's route. Remove the per-line destination warehouse.", 400);
      }
    }

    // ── The document ─────────────────────────────────────────────────────────────────────
    // `document.url` is a client-supplied string the server never saw written. It must be a
    // URL the LIVE provider issued (`keyFromUrl` answers null for anything else) and the key
    // must sit under `transfers/` — the one prefix that accepts a PDF. Without this a caller
    // could point the record at any object in the bucket, or at a foreign host. The order
    // number does not exist yet, so the per-order folder check the replace route makes
    // (`transfers/<orderNo>/`) cannot apply here.
    const requiredDocType = docTypeForMode(mode);
    const storage = await tryGetStorage();
    if (!storage) {
      log.warn("transfer refused: storage not configured", { mode, fromStoreId });
      return errorResponse("Storage is not configured, so the document cannot be checked. Set it up in Settings → Storage.", 400);
    }
    const docKey = storage.keyFromUrl(data.document.url);
    if (!docKey || !docKey.startsWith(TRANSFER_DOC_PREFIX)) {
      log.warn("transfer refused: document url not a transfer upload", {
        mode,
        fromStoreId,
        provider: storage.key,
        keyPrefix: docKey ? docKey.split("/")[0] : null,
      });
      return errorResponse("That file was not uploaded as a transfer document.", 400);
    }

    let docDate: Date | null = null;
    if (data.document.date) {
      const parsed = new Date(data.document.date);
      if (Number.isNaN(parsed.getTime())) {
        log.warn("transfer refused: bad document date", { mode, fromStoreId });
        return errorResponse("That document date is not a valid date.", 400);
      }
      docDate = parsed;
    }
    const docNumber = data.document.number?.trim() || null;

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
          mode,
          fromStoreId,
          toStoreId,
          fromWarehouseId: fromWh.id,
          toWarehouseId: toWh.id,
          // `transferType` is no longer written; it is dropped a release after this (rule 7).
          requiredDocType,
          // The document, attached at creation. `docType` mirrors `requiredDocType` because the
          // mode decided both — the dispatch gate compares them and must find them equal.
          docType: requiredDocType,
          docUrl: data.document.url,
          docNumber,
          docDate,
          docUploadedById: user.id,
          docUploadedAt: new Date(),
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

    log.info("transfer created", {
      orderId: result.id,
      orderNo: result.orderNo,
      mode,
      status,
      requiredDocType,
      itemCount: data.items.length,
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
