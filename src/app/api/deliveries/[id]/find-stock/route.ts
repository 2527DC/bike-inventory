export const dynamic = "force-dynamic";

export const runtime = "nodejs";
// nodejs, explicitly: POST raises `approval.requested` through notify(), which reaches SMTP (a
// raw socket on 587) and the FCM JWT signer (node crypto). Neither works on the edge runtime.

import { NextRequest, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { floorShortForDispatch, isDummy, stockLines, findDeliveryProduct } from "@/lib/deliveries/floor-stock";
import { AVAILABLE_UNIT_STATUSES, pickUnitsUpTo } from "@/lib/units";
import { docTypeForMode } from "@/lib/transfers/mode";
import { TRF_SEQUENCE_PAD, currentTransferYm, trfSeedSql, trfSequenceKey } from "@/lib/transfers/sequence";
import { nextSequence } from "@/lib/sequence";
import { recordApprovalEvent } from "@/lib/approvals/events";
import { usersWithPermission } from "@/lib/rbac";
import { notify } from "@/lib/notify";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";
import type { TransferMode, Prisma } from "@prisma/client";

const log = createLogger("deliveries:find-stock");

/**
 * Find stock for a short outward, and raise the transfer that brings it (plan 1709, R45, P15, P16).
 *
 * ─── GET ?storeId= — WHERE IS IT? ─────────────────────────────────────────────────────────
 *
 * The owner's shape (P16): pick a STORE first, then see that store's FLOOR and GODOWN warehouses
 * that actually hold each short product. Every store is selectable (P15) — the outward's own is
 * preselected by the screen — and the outward's own floor is excluded, because the whole reason
 * we are here is that it is empty. Quantities are USABLE (`quantity − reservedQuantity`), so a
 * cycle already promised to another outward is not offered twice. The unit breakdown beside each
 * quantity (assembled / unassembled / no assembly) tells the person whether the cycle can be
 * handed over on arrival or still needs a bench.
 *
 * ─── POST — RAISE THE TRANSFER ────────────────────────────────────────────────────────────
 *
 * One `TransferOrder` per SOURCE WAREHOUSE, to the outward's floor, `PENDING`, `deliveryId` set,
 * and **no document** (P16: finding needs no paper; the transfer does, and it is required before
 * dispatch — Part D's gate). It deliberately does NOT auto-approve for a holder of
 * `transfers.approve`, unlike `POST /api/transfer-orders`: R45's whole point is that the request
 * appears on the approver's Requests page, and a self-raised, self-approved transfer would skip
 * the step the requirement asks for.
 *
 * The units it picks in the source warehouse are reserved for this outward at once, so a starred
 * cycle can go on a bench before the transfer is approved (Q12) and arrives already spoken for.
 *
 * Numbering, mode and document type come from the same helpers `POST /api/transfer-orders` uses
 * (`nextSequence` + `trfSeedSql` inside the transaction, `docTypeForMode`) rather than a second
 * copy of the rules. Bin selection is the one thing not replicated: the create form asks for
 * source and destination bins when bin tracking is on, and this screen has no bin picker — the
 * lines are raised without bins and put away on receipt.
 */

const DUMMY_MESSAGE = "Dummy delivery: no warehouse matched this invoice number. No actions are allowed.";

const postSchema = z.object({
  sources: z
    .array(
      z.object({
        productId: z.string().min(1),
        warehouseId: z.string().min(1),
        qty: z.number().int().positive("Every line needs a quantity of at least 1."),
      })
    )
    .min(1, "Choose at least one source.")
    .max(50, "At most 50 lines in one request."),
});

class FindStockRefusal extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FindStockRefusal";
    this.status = status;
  }
}

/** The mode this lane travels on — the same three the create form offers. */
function modeFor(
  source: { storeId: string; kind: string },
  destination: { storeId: string }
): TransferMode {
  if (source.storeId !== destination.storeId) return "STORE_TO_STORE";
  return source.kind === "GODOWN" ? "GODOWN_TO_FLOOR" : "STORE_TO_WAREHOUSE";
}

/** Condition counts for the units that could actually be sent from one warehouse. */
async function unitBreakdown(db: Prisma.TransactionClient | typeof prisma, productId: string, warehouseId: string) {
  const rows = await db.inventoryUnit.findMany({
    where: {
      productId,
      warehouseId,
      status: { in: AVAILABLE_UNIT_STATUSES },
      reservedForDeliveryId: null,
    },
    select: { assembledAt: true, nonAssemblable: true },
  });
  let assembled = 0;
  let unassembled = 0;
  let noAssembly = 0;
  for (const u of rows) {
    if (u.nonAssemblable) noAssembly++;
    else if (u.assembledAt) assembled++;
    else unassembled++;
  }
  return { assembled, unassembled, noAssembly };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  try {
    await requireFeature("deliveries", "edit");
    const { id } = await params;
    deliveryId = id;

    const delivery = await prisma.delivery.findUnique({
      where: { id },
      select: {
        id: true,
        invoiceNo: true,
        status: true,
        warehouseId: true,
        lineItems: true,
        stockReservedAt: true,
        warehouse: { select: { id: true, name: true, storeId: true } },
      },
    });
    if (!delivery) return errorResponse("Delivery not found", 404);
    if (isDummy(delivery)) return errorResponse(DUMMY_MESSAGE, 409);

    const stores = await prisma.store.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    // The outward's own store is the default; an explicit ?storeId= wins (P15, P16).
    const askedStoreId = req.nextUrl.searchParams.get("storeId");
    const storeId = askedStoreId || delivery.warehouse?.storeId || stores[0]?.id || null;

    // Read outside a transaction on purpose: this is a browsing screen, and the POST re-checks
    // every quantity inside its own transaction, which is the only check that can be trusted.
    const short = await prisma.$transaction((tx) => floorShortForDispatch(tx, delivery));

    let lines: Array<Record<string, unknown>> = [];
    if (storeId) {
      const warehouses = await prisma.warehouse.findMany({
        where: { storeId, isActive: true, id: { not: delivery.warehouseId ?? undefined } },
        select: { id: true, name: true, kind: true },
        orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      });

      lines = await Promise.all(
        short.map(async (line) => {
          const levels = await prisma.stockLevel.findMany({
            where: { productId: line.productId, warehouseId: { in: warehouses.map((w) => w.id) } },
            select: { warehouseId: true, quantity: true, reservedQuantity: true },
          });
          const byWarehouse = new Map(levels.map((l) => [l.warehouseId, l]));
          const sources = [];
          for (const w of warehouses) {
            const level = byWarehouse.get(w.id);
            const quantity = Math.max(0, (level?.quantity ?? 0) - (level?.reservedQuantity ?? 0));
            if (quantity <= 0) continue;
            sources.push({
              warehouseId: w.id,
              warehouseName: w.name,
              kind: w.kind,
              quantity,
              units: await unitBreakdown(prisma, line.productId, w.id),
            });
          }
          return {
            productId: line.productId,
            name: line.name,
            sku: line.sku,
            needed: line.needed,
            onFloor: line.available,
            shortfall: Math.max(0, line.needed - line.available),
            sources,
          };
        })
      );
    }

    // The transfers already raised for this outward, so the card can show their status (R45).
    const transfers = await prisma.transferOrder.findMany({
      where: { deliveryId: id },
      select: {
        id: true,
        orderNo: true,
        status: true,
        createdAt: true,
        docUrl: true,
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    log.debug("find stock listed", { deliveryId: id, storeId, shortLines: short.length });
    return successResponse({
      deliveryId: id,
      invoiceNo: delivery.invoiceNo,
      floor: delivery.warehouse ? { id: delivery.warehouse.id, name: delivery.warehouse.name } : null,
      ownStoreId: delivery.warehouse?.storeId ?? null,
      storeId,
      stores,
      lines,
      transfers,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("find stock refused", { deliveryId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    log.error("find stock failed", {
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to find stock", 500);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  try {
    const user = await requireFeature("deliveries", "edit");
    const { id } = await params;
    deliveryId = id;
    const body = postSchema.parse(await req.json());

    // Filled INSIDE the transaction, sent AFTER it commits (notify §F.0).
    const raised: Array<{ id: string; orderNo: string; fromName: string; lines: number }> = [];

    const result = await prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { id },
        select: {
          id: true,
          invoiceNo: true,
          status: true,
          warehouseId: true,
          lineItems: true,
          warehouse: { select: { id: true, name: true, storeId: true, kind: true } },
        },
      });
      if (!delivery) throw new FindStockRefusal("Delivery not found", 404);
      if (isDummy(delivery) || !delivery.warehouse) throw new FindStockRefusal(DUMMY_MESSAGE, 409);
      if (["DELIVERED", "WALK_OUT"].includes(delivery.status)) {
        throw new FindStockRefusal("This outward is already closed.", 409);
      }

      // Only products this outward actually sells. Without this, the route would be a general
      // "raise a transfer" endpoint with `deliveries.edit` instead of `transfers.create`.
      const wanted = new Set<string>();
      for (const line of stockLines(delivery.lineItems)) {
        const product = await findDeliveryProduct(tx, line.sku);
        if (product) wanted.add(product.id);
      }

      // Group the chosen sources by warehouse: one order per source building (P16).
      const byWarehouse = new Map<string, Array<{ productId: string; qty: number }>>();
      for (const s of body.sources) {
        if (!wanted.has(s.productId)) {
          throw new FindStockRefusal("One of the chosen products is not on this outward.", 409);
        }
        if (s.warehouseId === delivery.warehouseId) {
          throw new FindStockRefusal("The outward's own floor cannot be its own source.", 409);
        }
        const list = byWarehouse.get(s.warehouseId) ?? [];
        const existing = list.find((l) => l.productId === s.productId);
        if (existing) existing.qty += s.qty;
        else list.push({ productId: s.productId, qty: s.qty });
        byWarehouse.set(s.warehouseId, list);
      }

      const ym = currentTransferYm();
      const prefix = `TRF-${ym}`;

      for (const [warehouseId, lines] of byWarehouse) {
        const source = await tx.warehouse.findUnique({
          where: { id: warehouseId },
          select: { id: true, name: true, kind: true, storeId: true, isActive: true },
        });
        if (!source || !source.isActive) {
          throw new FindStockRefusal("One of the chosen warehouses is not active.", 400);
        }

        // Re-check availability under the transaction's locks — the browsing GET read is stale
        // by definition, and two people can pick the same last cycle.
        for (const line of lines) {
          const level = await tx.stockLevel.findUnique({
            where: { productId_warehouseId: { productId: line.productId, warehouseId } },
            select: { quantity: true, reservedQuantity: true },
          });
          const usable = Math.max(0, (level?.quantity ?? 0) - (level?.reservedQuantity ?? 0));
          if (usable < line.qty) {
            const product = await tx.product.findUnique({
              where: { id: line.productId },
              select: { name: true },
            });
            throw new FindStockRefusal(
              `${product?.name ?? "That product"}: ${source.name} has ${usable} usable, ${line.qty} asked for. Reload and choose again.`,
              409
            );
          }
        }

        const mode = modeFor(source, { storeId: delivery.warehouse.storeId });
        const requiredDocType = docTypeForMode(mode);
        const seq = await nextSequence(tx, trfSequenceKey(ym), TRF_SEQUENCE_PAD, trfSeedSql(prefix));
        const orderNo = `${prefix}-${seq}`;

        const order = await tx.transferOrder.create({
          data: {
            orderNo,
            status: "PENDING",
            notes: `Raised from outward ${delivery.invoiceNo} (Find stock)`,
            createdById: user.id,
            mode,
            fromStoreId: source.storeId,
            toStoreId: mode === "STORE_TO_STORE" ? delivery.warehouse.storeId : null,
            fromWarehouseId: source.id,
            toWarehouseId: delivery.warehouse.id,
            requiredDocType,
            // No document (P16). `docType` stays null until one is attached, which dispatch
            // requires; `requiredDocType` above is what tells the screen which paper to bring.
            deliveryId: delivery.id,
            items: {
              create: lines.map((l) => ({
                productId: l.productId,
                quantity: l.qty,
                // Mirrored from the header, as the create route does, so anything still reading
                // the item lane sees the same answer. No bins: this screen has no bin picker.
                fromWarehouseId: source.id,
                toWarehouseId: delivery.warehouse!.id,
              })),
            },
          },
          select: { id: true, orderNo: true },
        });

        // Hold the actual cycles for this outward now (Q12, P19): they can go on a bench before
        // the transfer is approved, and they arrive already spoken for.
        let reserved = 0;
        for (const line of lines) {
          const held = await tx.inventoryUnit.count({
            where: { reservedForDeliveryId: delivery.id, productId: line.productId, warehouseId },
          });
          const picked = await pickUnitsUpTo(tx, {
            productId: line.productId,
            warehouseId,
            qty: Math.max(0, line.qty - held),
            order: "sale",
          });
          if (picked.length === 0) continue;
          const { count } = await tx.inventoryUnit.updateMany({
            where: { id: { in: picked } },
            data: { reservedForDeliveryId: delivery.id, reservedAt: new Date() },
          });
          reserved += count;
        }

        await recordApprovalEvent(tx, {
          activity: "TRANSFER",
          event: "REQUESTED",
          recordId: order.id,
          recordRef: order.orderNo,
          actorId: user.id,
          warehouseId: source.id,
          note: `Find stock for outward ${delivery.invoiceNo}`,
        });

        await logActivity(tx, {
          module: "transfers",
          action: "created",
          entityType: "TransferOrder",
          entityId: order.id,
          entityRef: order.orderNo,
          toValue: "PENDING",
          details: `${source.name} → ${delivery.warehouse.name}, ${lines.length} line${lines.length === 1 ? "" : "s"} for outward ${delivery.invoiceNo}; ${reserved} unit${reserved === 1 ? "" : "s"} held`,
          userId: user.id,
          userName: user.name,
        });

        raised.push({ id: order.id, orderNo: order.orderNo, fromName: source.name, lines: lines.length });
      }

      return { invoiceNo: delivery.invoiceNo, floorName: delivery.warehouse.name };
    });

    // Committed. Approvers are resolved from the GRANT at send time, never a role name.
    after(async () => {
      try {
        const approvers = (await usersWithPermission("transfers", "approve")).filter((uid) => uid !== user.id);
        if (approvers.length === 0) {
          log.info("transfer raised but nobody else holds transfers.approve", { deliveryId, orders: raised.length });
          return;
        }
        for (const order of raised) {
          await notify("approval.requested", {
            recipients: approvers,
            title: `Transfer ${order.orderNo} needs approval`,
            body: `${order.fromName} → ${result.floorName} for outward ${result.invoiceNo} (${order.lines} line${order.lines === 1 ? "" : "s"}).`,
            refId: order.id,
            link: `/transfers/${order.id}`,
            data: { transferOrderId: order.id, orderNo: order.orderNo, activity: "TRANSFER" },
          });
        }
      } catch (err) {
        // Never rethrow: the transfers are committed and the response has gone out.
        log.error("transfer approval notification failed", {
          deliveryId,
          orders: raised.length,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    log.info("find stock raised transfers", {
      deliveryId,
      invoiceNo: result.invoiceNo,
      orders: raised.length,
    });
    return successResponse({ transfers: raised.map((r) => ({ id: r.id, orderNo: r.orderNo })) }, 201);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("find stock request refused", { deliveryId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof FindStockRefusal) {
      log.warn("find stock request refused", { deliveryId, status: error.status, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof z.ZodError) {
      log.warn("find stock body rejected", { deliveryId });
      return errorResponse(error.issues[0]?.message ?? "Invalid request", 400);
    }
    log.error("find stock request failed", {
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to raise the transfer", 500);
  }
}
