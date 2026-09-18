export const dynamic = "force-dynamic";

export const runtime = "nodejs";
// nodejs, explicitly: receiving the last line finishes the shipment, which reaches SMTP and
// the FCM JWT signer through notify(), and Zoho Books through createBill(). None of that
// works on the edge runtime, and the failure there is not self-explanatory.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { isBinTrackingEnabled } from "@/lib/settings/bin-tracking";
import { resolveWarehouse, primaryFloorWarehouse } from "@/lib/warehouses";
import { adjustWarehouseQty, deductAnywhere } from "@/lib/stock-location";
import { inboundReceiveLineSchema, inboundCategorySchema } from "@/lib/validations";
import { BinMoveRefused, createUnits, placeUnitsInBin, retireUnits } from "@/lib/units";
import { matchHomeBin } from "@/lib/bins/rule-match";
import { recordApprovalEvent } from "@/lib/approvals/events";
import { logActivity } from "@/lib/activity-log";
import { finaliseDelivered, scheduleDeliveredSideEffects } from "@/lib/inbound/complete-shipment";
import { createLogger } from "@/lib/logger";

const log = createLogger("inbound:detail");

// GET: Shipment detail
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("inbound", "view");
    const { id } = await params;

    const shipment = await prisma.inboundShipment.findUnique({
      where: { id },
      include: {
        brand: { select: { name: true } },
        // The receiving gate: no line can be received until this is set (R3). `parent` so the
        // picker and the header can show "Spare Parts › Tyres" rather than a bare leaf name.
        category: { select: { id: true, name: true, parent: { select: { name: true } } } },
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        deliveredBy: { select: { name: true } },
        putawayBy: { select: { name: true } },
        lineItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                brandId: true,
                brand: { select: { id: true, name: true } },
                categoryId: true,
                category: { select: { id: true, name: true } },
              },
            },
            bin: { select: { id: true, code: true, name: true, location: true } },
            preBooking: { select: { id: true, customerName: true, status: true } },
          },
        },
        vendorBill: { select: { vendorId: true } },
        preBookings: {
          select: { id: true, customerName: true, customerPhone: true, status: true, productName: true },
        },
      },
    });

    if (!shipment) return errorResponse("Not found", 404);
    return successResponse(shipment);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// PUT: Update shipment (mark line items delivered, update notes)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("inbound", "edit");
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.inboundShipment.findUnique({ where: { id } });
    if (!existing) return errorResponse("Not found", 404);

    // ─── SET THE SHIPMENT CATEGORY (R3) ───────────────────────────────────────────────────
    //
    // Cycles / Spares / Accessories used to live in ONE phone's localStorage, so the shipment
    // read as uncategorised to everybody else and lost the value whenever that browser
    // cleared. It is a property of the shipment, so it is a column now (MIG-1a).
    if (body.categoryId !== undefined && body.lineItemId === undefined) {
      const parsed = inboundCategorySchema.safeParse(body);
      if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);

      const category = await prisma.category.findUnique({
        where: { id: parsed.data.categoryId },
        select: { id: true, name: true },
      });
      if (!category) return errorResponse("That category does not exist", 400);

      // Refused once anything has been received: the category decides how the lines are
      // handled, so changing it afterwards would re-interpret stock already in the building.
      const received = await prisma.inboundLineItem.count({
        where: { shipmentId: id, isDelivered: true },
      });
      if (received > 0) {
        return errorResponse(
          "Items have already been received on this shipment, so its category can no longer be changed.",
          400
        );
      }

      const previous = existing.categoryId
        ? await prisma.category.findUnique({ where: { id: existing.categoryId }, select: { name: true } })
        : null;

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.inboundShipment.update({
          where: { id },
          data: { categoryId: category.id },
          include: { category: { select: { id: true, name: true } } },
        });
        await logActivity(tx, {
          module: "inbound",
          action: "updated",
          entityType: "InboundShipment",
          entityId: id,
          entityRef: existing.shipmentNo,
          fromValue: previous?.name ?? null,
          toValue: category.name,
          details: "category",
          userId: user.id,
          userName: user.name,
        });
        return row;
      });

      log.info("shipment category set", { shipmentId: id, categoryId: category.id });
      return successResponse(updated);
    }

    // ─── RECEIVE ONE LINE (R3) ────────────────────────────────────────────────────────────
    //
    // Per LINE, and the shipment finishes itself: when the last outstanding line is received
    // the transition into DELIVERED is claimed here, so the Mark All / Partial / Undo buttons
    // and the whole [id]/status route are gone.
    if (body.lineItemId !== undefined) {
      const parsed = inboundReceiveLineSchema.safeParse(body);
      if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request", 400);
      const { lineItemId, deliveredQty: qty, warehouseId } = parsed.data;

      // ── Gates, all before the transaction ──
      //
      // The per-line route had NO approval gate at all: stock could be received into a
      // shipment nobody had approved.
      if (existing.status === "DELIVERED") {
        return errorResponse("This shipment is already fully received", 400);
      }
      if (!existing.approvedAt) {
        return errorResponse("This shipment has not been approved yet", 403);
      }
      const lineItem = await prisma.inboundLineItem.findUnique({
        where: { id: lineItemId },
        include: {
          shipment: { include: { brand: { select: { name: true } } } },
          product: { select: { id: true } },
          preBooking: true,
        },
      });
      if (!lineItem) return errorResponse("Line item not found", 404);
      if (lineItem.shipmentId !== id) {
        return errorResponse("That line item belongs to a different shipment", 400);
      }
      // D6: the blue button receives the FULL bill quantity. A shortage is a vendor issue,
      // not a smaller receipt — otherwise the shortfall silently becomes the new truth.
      if (qty !== lineItem.quantity) {
        return errorResponse(
          `Receive the full billed quantity (${lineItem.quantity}). For a short delivery, use Report Issue.`,
          400
        );
      }

      const resolved = await resolveWarehouse(warehouseId);
      if ("error" in resolved) return errorResponse(resolved.error, 400);

      // ── ONE BIN PER LINE (plan 1509-assembly-queue-single-bin-and-product-assembly-level, D2) ──
      //
      // Replaces `binAllocations` — a per-UNIT list of bins. The screen let one line be split
      // across several bins, but only the first was ever honoured: Product.binId, every
      // InventoryUnit and the whole BinStock increment went to it, so the other bins got an
      // InventoryTransaction and nothing on the shelf. A line now names exactly one bin.
      //
      // Read off the raw body because `inboundReceiveLineSchema` (validations.ts) carries no
      // bin field; the string check below is its validation. Ignored when bin tracking is off,
      // where stock is held per warehouse only and the line lands in "Unmatched Inbound".
      const binTrackingEnabled = await isBinTrackingEnabled();
      const binId =
        binTrackingEnabled && typeof body.binId === "string" && body.binId.trim() ? body.binId.trim() : null;
      if (binTrackingEnabled && !binId) {
        return errorResponse("Choose the bin this line goes into", 400);
      }

      // The bin decides the building. With bin tracking on the screen has no warehouse picker
      // and sends the default godown, so a Floor bin would otherwise leave its units recorded
      // in a warehouse that is not the one they are shelved in.
      let warehouse: { id: string; name: string } = resolved.warehouse;
      if (binId) {
        const bin = await prisma.bin.findUnique({
          where: { id: binId },
          select: {
            id: true,
            code: true,
            isActive: true,
            warehouse: { select: { id: true, name: true, isActive: true } },
          },
        });
        if (!bin || !bin.isActive) {
          return errorResponse("That bin does not exist or is not active — pick another", 400);
        }
        if (!bin.warehouse.isActive) {
          return errorResponse(`${bin.warehouse.name} is not active — pick a bin in an active warehouse`, 400);
        }
        if (bin.warehouse.id !== warehouse.id) {
          log.info("receive warehouse taken from bin", {
            shipmentId: id,
            lineItemId,
            binId,
            sentWarehouseId: warehouse.id,
            binWarehouseId: bin.warehouse.id,
          });
          warehouse = { id: bin.warehouse.id, name: bin.warehouse.name };
        }
      }

      // Set inside the transaction when the home-bin rules placed the units (P4); read after it
      // for the log line and the response, so the screen can say where they went.
      let ruleBinCode: string | null = null;

      const outcome = await prisma.$transaction(async (tx) => {
        // ── THE IDEMPOTENT CLAIM ──
        //
        // `isDelivered` used to be read OUTSIDE the transaction (`wasDelivered`), so two taps
        // in quick succession both saw false and both added the stock — a double-tap on a
        // phone silently doubled the received quantity. Letting the database decide makes
        // that impossible: exactly one caller gets count === 1.
        const claim = await tx.inboundLineItem.updateMany({
          where: { id: lineItemId, isDelivered: false },
          data: { isDelivered: true, deliveredQty: qty, ...(binId ? { binId } : {}) },
        });
        if (claim.count === 0) {
          return { updated: false, alreadyReceived: true, shipmentDelivered: false, snapshot: null };
        }

        {
          const searchName = lineItem.productName.substring(0, 20);
          const matchedProduct = lineItem.productId
            ? await tx.product.findUnique({ where: { id: lineItem.productId } })
            : await tx.product.findFirst({
                where: { name: { contains: searchName, mode: "insensitive" } },
              });

          if (!matchedProduct) {
            throw new Error(`Product not found for "${lineItem.productName}" — import it from Zoho Items first`);
          }

          // ── THE QUANTITY, IN BOTH MODES (plan 1709, P1) ──
          //
          // Bin mode used to write `Product.currentStock` and `BinStock` only, never a
          // `StockLevel` row — so the warehouse the bin stands in read 0 while units sat there,
          // and the next recompute of the total dropped the receipt. Both modes now add to the
          // warehouse (the bin's, resolved above) and let the total recompute from the rows.
          // Exactly one `adjustWarehouseQty` per line in either mode, so nothing is counted twice.
          const previousStock = matchedProduct.currentStock;
          const newStock = await adjustWarehouseQty(tx, matchedProduct.id, warehouse.id, qty);
          if (binId) {
            // One line, one bin (D2): the bin also becomes the product's home bin.
            await tx.product.update({ where: { id: matchedProduct.id }, data: { binId } });
          }
          const inward = await tx.inventoryTransaction.create({
            data: {
              type: "INWARD",
              productId: matchedProduct.id,
              quantity: qty,
              previousStock,
              newStock,
              referenceNo: lineItem.shipment.shipmentNo,
              notes: binId
                ? `[INBOUND] Brand: ${lineItem.shipment.brand.name} | Bill: ${lineItem.shipment.billNo} | ${lineItem.productName} x${qty} → Bin: ${binId.slice(-6)}`
                : `[INBOUND] Brand: ${lineItem.shipment.brand.name} | Bill: ${lineItem.shipment.billNo} | ${lineItem.productName} x${qty} → ${warehouse.name}`,
              userId: user.id,
            },
            select: { id: true },
          });

          // ── One unit per item, each its own code — for EVERY received product (R2, R6, R19) ──
          //
          // Everything this business inbounds is a bicycle (plan 1509-assembly-queue…, D1).
          // Unassembled, as every inward (P4). With a bin they are PUT_AWAY there — stamped
          // non-assemblable when the bin is (P6b) — and the bin's stock is recounted from its
          // units (P11); without one they are RECEIVED and wait in "Unmatched Inbound".
          // `sourceTransactionId` ties them to this INWARD row so a cleanup can find them (P4).
          const newUnitIds = await createUnits(tx, {
            productId: matchedProduct.id,
            warehouseId: warehouse.id,
            qty,
            binId,
            inboundShipmentId: id,
            sourceTransactionId: inward.id,
          });

          if (binId) {
            await tx.binMovementLog.create({
              data: {
                warehouseId: warehouse.id,
                productId: matchedProduct.id,
                quantity: qty,
                fromBinId: null,
                toBinId: binId,
                reason: "Inbound receiving put-away",
                movedById: user.id,
              },
            });
          } else if (binTrackingEnabled && newUnitIds.length > 0) {
            // ── RULE-BASED INWARD (plan 1709, P4 (2)) ──
            //
            // Nobody picked a bin, so the home-bin rules decide: brand · category · subcategory
            // for this warehouse. The point is R42 — an item whose rule bin needs no assembly is
            // non-assemblable FROM THE MOMENT IT ARRIVES, because `placeUnitsInBin` stamps it.
            // A hand-picked bin always wins; this branch only runs when there was none.
            //
            // Only while bin tracking is on. With it off the building holds stock per warehouse
            // and the line is meant to wait in "Unmatched Inbound" for a person to place it.
            const match = await matchHomeBin(tx, {
              productId: matchedProduct.id,
              warehouseId: warehouse.id,
            });
            if (match) {
              await placeUnitsInBin(tx, newUnitIds, match.bin.id);
              await tx.product.update({ where: { id: matchedProduct.id }, data: { binId: match.bin.id } });
              await tx.binMovementLog.create({
                data: {
                  warehouseId: warehouse.id,
                  productId: matchedProduct.id,
                  quantity: qty,
                  fromBinId: null,
                  toBinId: match.bin.id,
                  reason: `Inbound receiving — home bin rule (${match.label})`,
                  movedById: user.id,
                },
              });
              ruleBinCode = match.bin.code;
            }
          }

          // Auto-create delivery for pre-booked items so outwards clerk can see it
          if (lineItem.preBookedCustomerName) {
            const existingDelivery = await tx.delivery.findFirst({
              where: { invoiceNo: lineItem.preBookedInvoiceNo || `PB-${lineItem.id}` },
            });
            if (!existingDelivery) {
              // B1 (plan 1609-deliveries): the delivery sells from the PRIMARY FLOOR warehouse
              // of the store that received the cycle — not the receiving warehouse itself, which
              // is usually a godown. `warehouse` here carries no storeId (the bin branch above
              // narrows it to id + name), so read it. No floor → leave both null, a Dummy.
              const receiving = await tx.warehouse.findUnique({
                where: { id: warehouse.id },
                select: { storeId: true },
              });
              const floor = receiving ? await primaryFloorWarehouse(tx, receiving.storeId) : null;
              if (!floor) {
                log.warn("pre-booked delivery has no primary floor — created as Dummy", {
                  shipmentId: id,
                  lineItemId: lineItem.id,
                  receivingWarehouseId: warehouse.id,
                  storeId: receiving?.storeId ?? null,
                });
              }
              await tx.delivery.create({
                data: {
                  invoiceNo: lineItem.preBookedInvoiceNo || `PB-${lineItem.id}`,
                  invoiceDate: new Date(),
                  invoiceAmount: 0,
                  customerName: lineItem.preBookedCustomerName,
                  customerPhone: lineItem.preBookedCustomerPhone || null,
                  warehouseId: floor?.id ?? null,
                  storeId: floor?.storeId ?? null,
                  status: "PENDING",
                  prebookNotes: `Pre-booked item arrived: ${lineItem.productName} x${qty} | ${lineItem.shipment.brand.name} | ${lineItem.shipment.shipmentNo}`,
                  lineItems: [{ name: lineItem.productName, quantity: qty }],
                  verifiedById: user.id,
                },
              });
            }
          }

          // Fulfill the pre-booking if matched
          if (lineItem.preBooking) {
            await tx.preBooking.update({
              where: { id: lineItem.preBooking.id },
              data: { status: "FULFILLED", fulfilledAt: new Date() },
            });
          }
        }

        await logActivity(tx, {
          module: "inbound",
          action: "received",
          entityType: "InboundShipment",
          entityId: id,
          entityRef: existing.shipmentNo,
          details: `${lineItem.productName} ×${qty} → ${warehouse.name}`,
          userId: user.id,
          userName: user.name,
        });

        // ── DOES THIS FINISH THE SHIPMENT? ──
        //
        // Asked here, inside the transaction, off the row the claim just wrote — so the
        // count cannot race with another line being received at the same moment.
        const remaining = await tx.inboundLineItem.count({
          where: { shipmentId: id, isDelivered: false },
        });

        if (remaining === 0) {
          const snapshot = await finaliseDelivered(tx, id, user.id, user.name, existing.status);
          return { updated: true, alreadyReceived: false, shipmentDelivered: Boolean(snapshot), snapshot };
        }

        // The FIRST receipt is a real state change and used to be invisible: a partially
        // received shipment showed N receipts and no transition, so nothing distinguished
        // "nobody has started" from "half of it is in".
        if (existing.status === "IN_TRANSIT") {
          await tx.inboundShipment.update({
            where: { id },
            data: { status: "PARTIALLY_DELIVERED" },
          });
          await logActivity(tx, {
            module: "inbound",
            action: "status_changed",
            entityType: "InboundShipment",
            entityId: id,
            entityRef: existing.shipmentNo,
            fromValue: "IN_TRANSIT",
            toValue: "PARTIALLY_DELIVERED",
            details: `${remaining} line(s) still to receive`,
            userId: user.id,
            userName: user.name,
          });
        }

        return { updated: true, alreadyReceived: false, shipmentDelivered: false, snapshot: null };
        // One code allocation per item (row-locked counter): a 40-cycle line is 80+ statements,
        // past Prisma's 5 s default.
      }, { timeout: 30_000 });

      // AFTER the transaction resolved, never inside it. `after()` fires even when the
      // response throws, so registering the Zoho push inside would bill a shipment that then
      // rolled back — and a rollback cannot recall a bill from someone else's books.
      if (outcome.snapshot) {
        scheduleDeliveredSideEffects(outcome.snapshot, { id: user.id, name: user.name });
      }

      log.info("line received", {
        shipmentId: id,
        lineItemId,
        qty,
        warehouseId: warehouse.id,
        binId,
        ruleBinCode,
        unitsCreated: outcome.updated ? qty : 0,
        alreadyReceived: outcome.alreadyReceived,
        shipmentDelivered: outcome.shipmentDelivered,
      });

      return successResponse({
        updated: outcome.updated,
        alreadyReceived: outcome.alreadyReceived,
        shipmentDelivered: outcome.shipmentDelivered,
        ruleBinCode,
      });
    }

    // Update notes
    if (body.notes !== undefined) {
      const updated = await prisma.inboundShipment.update({
        where: { id },
        data: { notes: body.notes },
      });
      return successResponse(updated);
    }

    // Mark WhatsApp sent for a line item
    if (body.lineItemId && body.whatsAppSent) {
      await prisma.inboundLineItem.update({
        where: { id: body.lineItemId },
        data: { whatsAppSent: true },
      });
      return successResponse({ updated: true });
    }

    return errorResponse("No valid update fields", 400);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof BinMoveRefused) {
      log.warn("receive refused by the bin rules", { shipmentId: (await params).id, message: error.message });
      return errorResponse(error.message, 409);
    }
    log.error("shipment update failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}

// DELETE: Remove shipment (admin only, only if no stock was added)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("inbound", "delete");
    const { id } = await params;

    const shipment = await prisma.inboundShipment.findUnique({
      where: { id },
      include: { lineItems: true },
    });
    if (!shipment) return errorResponse("Not found", 404);

    const retired = await prisma.$transaction(async (tx) => {
      // ── DELETING AN APPROVED SHIPMENT IS AN APPROVAL BEING UNDONE (R26) ──
      //
      // Written FIRST, while the row still exists, and against the person who APPROVED it, not
      // the person deleting it: that is what the approver-error rate counts. An unapproved
      // shipment being deleted is ordinary tidying and records nothing.
      //
      // `recordApprovalEvent` throws on failure, so a shipment is never deleted with its
      // evidence missing. `recordId` outlives the row it names — the trail is the point.
      if (shipment.approvedAt && shipment.approvedById) {
        await recordApprovalEvent(tx, {
          activity: "INBOUND",
          event: "REVERSED",
          recordId: id,
          recordRef: shipment.shipmentNo,
          actorId: user.id,
          approverId: shipment.approvedById,
          note: "Shipment deleted; received stock reversed",
        });
      }

      // ── THE SHIPMENT'S UNITS GO WITH IT (plan 1709, P2) ──
      //
      // The stock is reversed below; its unit records used to stay behind, "unassembled" on
      // Awaiting for cycles that no longer exist. Every unit not already sold, lost or reset is
      // retired as LOST (history kept, P3), its open build tasks closed and its bin recounted.
      // Done before the shipment row goes, while `inboundShipmentId` still points at it.
      const unsold = await tx.inventoryUnit.findMany({
        where: { inboundShipmentId: id, status: { notIn: ["SOLD", "LOST", "RESET"] } },
        select: { id: true },
      });
      const retiredUnits = await retireUnits(tx, unsold.map((u) => u.id), "LOST");

      // Reverse stock for delivered items
      for (const li of shipment.lineItems) {
        if (li.isDelivered && li.productId) {
          const qty = li.deliveredQty ?? li.quantity;
          const product = await tx.product.findUnique({ where: { id: li.productId } });
          if (product && qty > 0) {
            // THE FIX (R12). Was `currentStock: Math.max(0, currentStock - qty)`, which moved
            // the cache and left StockLevel holding the units — so the next recompute undid
            // the undo and the deleted shipment's stock came straight back.
            //
            // `deductAnywhere` rather than a specific warehouse because the one the receipt
            // went into is not recorded: it arrives in the request body at receive time and
            // InboundLineItem has no column for it. See that helper's note.
            await deductAnywhere(tx, product.id, qty, `${li.productName} (${product.sku})`);
          }
          // Delete inventory transactions for this shipment
          await tx.inventoryTransaction.deleteMany({
            where: { productId: li.productId, referenceNo: shipment.shipmentNo, type: "INWARD" },
          });
        }
      }

      // Reset pre-bookings
      await tx.preBooking.updateMany({
        where: { matchedShipmentId: id },
        data: { status: "WAITING", matchedShipmentId: null, matchedLineItemId: null },
      });

      // Delete line items, then shipment
      await tx.inboundLineItem.deleteMany({ where: { shipmentId: id } });

      // Delete linked VendorBill (so it can be re-fetched from Zoho)
      if (shipment.vendorBillId) {
        // Only delete if no payments recorded against it
        const paymentCount = await tx.vendorPayment.count({ where: { billId: shipment.vendorBillId } });
        if (paymentCount === 0) {
          await tx.vendorBill.delete({ where: { id: shipment.vendorBillId } });
        } else {
          // Unlink but keep the VendorBill
          await tx.inboundShipment.update({ where: { id }, data: { vendorBillId: null } });
        }
      }

      await tx.inboundShipment.delete({ where: { id } });
      return retiredUnits;
    });

    log.info("shipment deleted", { shipmentId: id, shipmentNo: shipment.shipmentNo, unitsRetired: retired });
    return successResponse({ deleted: true, unitsRetired: retired });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("shipment delete failed", {
      shipmentId: (await params).id,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to delete", 400);
  }
}
