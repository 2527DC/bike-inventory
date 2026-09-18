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
import { listWarehouses, type WarehouseRef } from "@/lib/warehouses";
import { transferItemSchema, validateTransferItems, isRefusal } from "@/lib/transfers/items";
import { recordApprovalEvent } from "@/lib/approvals/events";
import { notifyTransferApprovalRequested } from "@/lib/approvals/actions/transfer";
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
  "RETURNED",
  "REJECTED",
  "CANCELLED",
  "IN_TRANSIT",
  "RECEIVED",
];

// The line shape and its four rules now live in `src/lib/transfers/items.ts`, because the
// PATCH that replaces a RETURNED order's lines (R25) must apply exactly the same ones.
const itemSchema = transferItemSchema;

/**
 * The document that travels with the transfer.
 *
 * ─── OPTIONAL AT CREATE SINCE P16 ─────────────────────────────────────────────────────────
 *
 * It used to be required here (owner, 9 Sep 2026: "it's just we upload a file"). R45 broke
 * that: Find stock raises a transfer request FROM AN OUTWARD, and the person standing at the
 * counter has neither the delivery challan nor the tax invoice — those are written when the van
 * is loaded. So the file is optional at create and REQUIRED BEFORE DISPATCH (P16 (a)); the
 * dispatch route refuses without it and `documentSatisfied` hides the button. The number and
 * date stay optional either way. The file has already been PUT to storage by the browser under
 * `transfers/…`; `url` is what the bucket answered. Its type is not chosen here:
 * `docTypeForMode` decides it.
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
  // P16: optional here, required before dispatch. See `documentSchema`.
  document: documentSchema.optional(),
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

    // ── The lines ────────────────────────────────────────────────────────────────────────
    // Lane agreement, product existence, source stock and the bin requirement — all four in
    // `src/lib/transfers/items.ts`, shared with the PATCH that replaces a RETURNED order's
    // lines so the two can never drift (R25).
    const lineCheck = await validateTransferItems({
      items: data.items,
      fromWh,
      toWh,
      context: {},
    });
    if (isRefusal(lineCheck)) return errorResponse(lineCheck.error, lineCheck.status);
    const { binTrackingEnabled } = lineCheck;

    // ── The document ─────────────────────────────────────────────────────────────────────
    // OPTIONAL since P16 — see `documentSchema`. When one IS supplied, `document.url` is a
    // client-supplied string the server never saw written: it must be a URL the LIVE provider
    // issued (`keyFromUrl` answers null for anything else) and the key must sit under
    // `transfers/` — the one prefix that accepts a PDF. Without this a caller could point the
    // record at any object in the bucket, or at a foreign host. The order number does not exist
    // yet, so the per-order folder check the replace route makes (`transfers/<orderNo>/`)
    // cannot apply here.
    const requiredDocType = docTypeForMode(mode);
    let docDate: Date | null = null;
    let docNumber: string | null = null;
    const docUrl = data.document?.url ?? null;

    if (data.document) {
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

      if (data.document.date) {
        const parsed = new Date(data.document.date);
        if (Number.isNaN(parsed.getTime())) {
          log.warn("transfer refused: bad document date", { mode, fromStoreId });
          return errorResponse("That document date is not a valid date.", 400);
        }
        docDate = parsed;
      }
      docNumber = data.document.number?.trim() || null;
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
          // The document, when one was attached at creation. `docType` mirrors
          // `requiredDocType` because the mode decided both — the dispatch gate compares them
          // and must find them equal. All five stay null when the file comes later (P16).
          docType: docUrl ? requiredDocType : null,
          docUrl,
          docNumber,
          docDate,
          docUploadedById: docUrl ? user.id : null,
          docUploadedAt: docUrl ? new Date() : null,
          items: {
            create: data.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              fromBinId: binTrackingEnabled ? item.fromBinId : null,
              toBinId: binTrackingEnabled ? item.toBinId : null,
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

      // Every controlled activity records that an approval was ASKED FOR (R22, R26). This is
      // what the Requests page's age column and the approver-error denominator are counted
      // from, so it is written inside the transaction that creates the order — an order with
      // no REQUESTED event would be invisible to both.
      await recordApprovalEvent(tx, {
        activity: "TRANSFER",
        event: "REQUESTED",
        recordId: order.id,
        recordRef: order.orderNo,
        actorId: user.id,
        // Nobody has approved anything yet.
        approverId: null,
      });

      // Auto-approve (Q15 keeps it) is still a real approval and is recorded as one, with the
      // creator as the approver — they are who a later correction counts against.
      if (isAutoApprove) {
        await recordApprovalEvent(tx, {
          activity: "TRANSFER",
          event: "APPROVED",
          recordId: order.id,
          recordRef: order.orderNo,
          actorId: user.id,
          approverId: user.id,
          note: "auto-approved: the creator holds transfers.approve",
        });
      }

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
      hasDocument: Boolean(docUrl),
      itemCount: data.items.length,
    });

    // AFTER the commit (notify/index.ts §F.0). Nothing to tell anyone when it approved itself.
    if (!isAutoApprove) {
      notifyTransferApprovalRequested({
        orderId: result.id,
        orderNo: result.orderNo,
        actorId: user.id,
        actorName: user.name,
        routeLabel: `${fromWh.name} → ${toWh.name}`,
        resubmitted: false,
      });
    }

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
