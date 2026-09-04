export const dynamic = "force-dynamic";

export const runtime = "nodejs";
// nodejs, explicitly: this route reaches SMTP (a raw socket on 587) and the FCM JWT signer
// (node crypto) through notify(). Neither works on the edge runtime, and the failure there
// is not self-explanatory. Node is the default today; this stops a later change from
// silently breaking sends. See the notifications plan, Part C and D.1.
import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan, usersWithPermission } from "@/lib/rbac";
import { notify } from "@/lib/notify";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { resolveWarehouse } from "@/lib/warehouses";
import { adjustWarehouseQty } from "@/lib/stock-location";
import { createLogger } from "@/lib/logger";

const log = createLogger("inbound:status");

// PUT: Update shipment status (IN_TRANSIT ↔ PARTIALLY_DELIVERED → DELIVERED)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("inbound", "edit");
    const { id } = await params;
    const body = await req.json();
    const { status } = body;
    // Location mode (bins dormant): receive the whole shipment into one location.
    const resolved = await resolveWarehouse(body.warehouseId ?? body.location);
    if ("error" in resolved) return errorResponse(resolved.error, 400);
    const warehouse = resolved.warehouse;
    // Support both legacy {lineItemId, binId} and new {lineItemId, binAllocations: [{binId, qty}]}
    const rawAssignments: Array<{ lineItemId: string; binId?: string; binAllocations?: Array<{ binId: string; qty: number }> }> = body.binAssignments || [];
    const binAssignments = rawAssignments.map((ba) => ({
      lineItemId: ba.lineItemId,
      binId: ba.binId || ba.binAllocations?.[0]?.binId || "",
      binAllocations: ba.binAllocations || (ba.binId ? [{ binId: ba.binId, qty: 0 }] : []),
    }));

    if (!["DELIVERED", "PARTIALLY_DELIVERED", "IN_TRANSIT"].includes(status)) {
      return errorResponse("Invalid status", 400);
    }

    const existing = await prisma.inboundShipment.findUnique({
      where: { id },
      include: { lineItems: true, brand: { select: { name: true } } },
    });

    if (!existing) return errorResponse("Not found", 404);
    if (existing.status === "DELIVERED") return errorResponse("Already delivered", 400);

    // Approval gate: non-admin users need supervisor/accounts manager approval before delivery
    if (status !== "IN_TRANSIT" && !existing.approvedAt && !(await userCan(user.id, "inbound", "approve"))) {
      return errorResponse("Shipment must be approved by Supervisor or Accounts Manager before delivery", 403);
    }

    // Revert to IN_TRANSIT (only from PARTIALLY_DELIVERED, admin/supervisor only)
    if (status === "IN_TRANSIT") {
      if (existing.status !== "PARTIALLY_DELIVERED") {
        return errorResponse("Can only revert from Partially Delivered", 400);
      }
      const hasDeliveredItems = existing.lineItems.some((li) => li.isDelivered);
      if (hasDeliveredItems) {
        return errorResponse("Cannot revert — some items already marked delivered with stock added", 400);
      }
      const reverted = await prisma.inboundShipment.update({
        where: { id },
        data: { status: "IN_TRANSIT", deliveredAt: null, deliveredById: null },
        include: { brand: { select: { name: true } }, lineItems: true },
      });
      return successResponse(reverted);
    }

    // Validate: in bin mode, all undelivered items must have bin assignments first.
    if (BIN_TRACKING_ENABLED && (status === "DELIVERED" || status === "PARTIALLY_DELIVERED")) {
      const undeliveredItems = existing.lineItems.filter((li) => !li.isDelivered);
      for (const li of undeliveredItems) {
        const binAssign = binAssignments.find((ba) => ba.lineItemId === li.id);
        if (!binAssign || !binAssign.binId) {
          return errorResponse(`Bin assignment required for "${li.productName}" before marking delivered`, 400);
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Mark all line items as delivered if full delivery
      if (status === "DELIVERED") {
        await tx.inboundLineItem.updateMany({
          where: { shipmentId: id },
          data: { isDelivered: true },
        });

        // Set deliveredQty + bin for items not yet marked
        for (const li of existing.lineItems) {
          if (!li.isDelivered) {
            const binAssign = binAssignments.find((ba) => ba.lineItemId === li.id);
            await tx.inboundLineItem.update({
              where: { id: li.id },
              data: { deliveredQty: li.quantity, ...(binAssign ? { binId: binAssign.binId } : {}) },
            });
          }
        }
      }

      // Add stock for newly delivered line items (skip already-delivered ones)
      // PARTIALLY_DELIVERED: per-item handler already added stock — don't double-add
      const itemsToAddStock = status === "DELIVERED"
        ? existing.lineItems.filter((li) => !li.isDelivered)
        : [];

      for (const li of itemsToAddStock) {
        const qty = li.deliveredQty ?? li.quantity;
        if (qty <= 0) continue;
        const binAssign = binAssignments.find((ba) => ba.lineItemId === li.id);

        // Find product by name (fuzzy match using first 20 chars)
        const searchName = li.productName.substring(0, 20);
        const matchedProduct = li.productId
          ? await tx.product.findUnique({ where: { id: li.productId } })
          : await tx.product.findFirst({
              where: { name: { contains: searchName, mode: "insensitive" } },
            });

        if (!matchedProduct) {
          throw new Error(`Product not found for "${li.productName}" — import it from Zoho Items first`);
        }

        let runningStock = matchedProduct.currentStock;
        if (BIN_TRACKING_ENABLED) {
          const allocations = binAssign?.binAllocations?.length
            ? binAssign.binAllocations
            : [{ binId: binAssign?.binId || "", qty }];
          const primaryBinId = allocations[0]?.binId || null;

          // Create one inventory transaction per bin allocation
          for (const alloc of allocations) {
            const allocQty = alloc.qty || qty;
            const previousStock = runningStock;
            runningStock += allocQty;
            await tx.inventoryTransaction.create({
              data: {
                type: "INWARD",
                productId: matchedProduct.id,
                quantity: allocQty,
                previousStock,
                newStock: runningStock,
                referenceNo: existing.shipmentNo,
                notes: `[INBOUND] Brand: ${existing.brand.name} | Bill: ${existing.billNo} | ${li.productName} x${allocQty}${alloc.binId ? ` → Bin: ${alloc.binId.slice(-6)}` : ""}`,
                userId: user.id,
              },
            });
          }

          await tx.product.update({
            where: { id: matchedProduct.id },
            data: { currentStock: runningStock, ...(primaryBinId ? { binId: primaryBinId } : {}) },
          });
        } else {
          // Location mode: add qty to the chosen location; currentStock recomputes as the sum.
          const previousStock = runningStock;
          runningStock += qty;
          await tx.inventoryTransaction.create({
            data: {
              type: "INWARD",
              productId: matchedProduct.id,
              quantity: qty,
              previousStock,
              newStock: runningStock,
              referenceNo: existing.shipmentNo,
              notes: `[INBOUND] Brand: ${existing.brand.name} | Bill: ${existing.billNo} | ${li.productName} x${qty} → ${warehouse.name}`,
              userId: user.id,
            },
          });
          await adjustWarehouseQty(tx, matchedProduct.id, warehouse.id, qty);
        }
      }

      // Auto-create delivery records for pre-booked items (for outwards clerk)
      if (status === "DELIVERED") {
        const preBookedItems = existing.lineItems.filter((li) => li.preBookedCustomerName);
        for (const li of preBookedItems) {
          const invoiceRef = li.preBookedInvoiceNo || `PB-${li.id}`;
          const existingDelivery = await tx.delivery.findFirst({ where: { invoiceNo: invoiceRef } });
          if (!existingDelivery) {
            await tx.delivery.create({
              data: {
                invoiceNo: invoiceRef,
                invoiceDate: new Date(),
                invoiceAmount: 0,
                customerName: li.preBookedCustomerName!,
                customerPhone: li.preBookedCustomerPhone || null,
                status: "PENDING",
                prebookNotes: `Pre-booked item arrived: ${li.productName} x${li.deliveredQty ?? li.quantity} | ${existing.brand.name} | ${existing.shipmentNo}`,
                lineItems: [{ name: li.productName, quantity: li.deliveredQty ?? li.quantity }],
                verifiedById: user.id,
              },
            });
          }
        }
      }

      const result = await tx.inboundShipment.update({
        where: { id },
        data: {
          status,
          deliveredAt: new Date(),
          deliveredById: user.id,
        },
        include: {
          brand: { select: { name: true } },
          lineItems: true,
        },
      });

      // Fulfill matched pre-bookings
      if (status === "DELIVERED") {
        await tx.preBooking.updateMany({
          where: { matchedShipmentId: id, status: "MATCHED" },
          data: { status: "FULFILLED", fulfilledAt: new Date() },
        });
      }

      return result;
    });

    // inbound.delivered — only on the transition INTO DELIVERED. PARTIALLY_DELIVERED is a normal
    // mid-flight state (§F.3) and an already-DELIVERED shipment was rejected above, so this is
    // the one crossing. §F.0: the transaction has committed; after() sends once the response has
    // gone out. Placed BEFORE the Zoho push below, which has an early return of its own.
    if (status === "DELIVERED") {
      const actorId = user.id;
      const actorName = user.name;
      after(async () => {
        try {
          // Whoever can approve inbound shipments (§F.5), minus the person at the goods desk.
          const recipients = (await usersWithPermission("inbound", "approve")).filter((uid) => uid !== actorId);
          if (recipients.length === 0) {
            log.debug("shipment delivered but nobody to tell", { shipmentId: id });
            return;
          }
          await notify("inbound.delivered", {
            recipients,
            title: `Shipment ${existing.shipmentNo} delivered`,
            body: `${existing.brand.name} — bill ${existing.billNo}, ${existing.totalItems} item(s), received by ${actorName}`,
            refId: existing.id,
            link: `/inbound/${id}`,
            data: { shipmentId: id, shipmentNo: existing.shipmentNo },
          });
        } catch (err) {
          log.error("inbound.delivered notification failed", {
            shipmentId: id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }

    // Push purchase bill to Zoho Books on full delivery (best effort)
    if (status === "DELIVERED") {
      try {
        // getBooks(), which initialises. This used to be `new BooksClient()` with NO init()
        // call, so createBill threw "Zoho Books client not initialized" every time and the
        // catch swallowed it as best-effort. No vendor bill has ever reached Zoho from a
        // DELIVERED shipment.
        const { getBooks } = await import("@/lib/integrations");
        const zoho = await getBooks();
        if (!zoho) {
          log.info("Zoho Books not connected; no bill pushed", { shipmentId: id });
          return successResponse(updated);
        }
        const billDate = existing.billDate.toISOString().split("T")[0];
        const dueDate = new Date(existing.billDate);
        dueDate.setDate(dueDate.getDate() + 30);

        await zoho.createBill({
          vendorName: existing.brand.name,
          billNo: existing.billNo,
          billDate,
          dueDate: dueDate.toISOString().split("T")[0],
          amount: existing.totalAmount,
          lineItems: existing.lineItems.map((li) => ({
            name: li.productName,
            quantity: li.deliveredQty ?? li.quantity,
            rate: li.rate,
            gstPercent: li.gstPercent || 0,
            hsn: li.hsn || "",
          })),
        });
      } catch (zohoErr) {
        log.warn("Zoho bill push failed (non-critical)", {
          error: zohoErr instanceof Error ? zohoErr.message : String(zohoErr),
        });
      }
    }

    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
