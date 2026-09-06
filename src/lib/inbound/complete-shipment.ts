import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { usersWithPermission } from "@/lib/rbac";
import { notify } from "@/lib/notify";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("inbound:complete");

type Tx = Prisma.TransactionClient;

/**
 * Finishing a shipment: the transition into DELIVERED, and what follows it.
 *
 * ─── WHY A CLAIM, NOT A CHECK ─────────────────────────────────────────────────────────────
 *
 * Receiving is now per LINE, so "was that the last one?" is asked once per receipt — by
 * whoever happens to tap last, possibly two people at once on two phones. A read-then-write
 * ("is it DELIVERED? no → set DELIVERED") would let both pass the read and both run the side
 * effects: two notifications, and two purchase bills pushed to Zoho Books for one shipment.
 *
 * `updateMany({ where: { id, status: { not: "DELIVERED" } } })` makes the DATABASE decide.
 * Exactly one caller gets `count === 1`; everyone else gets 0 and returns null. That count is
 * the idempotency key, and it is why every side effect below is safe to fire.
 */

export interface DeliveredSnapshot {
  id: string;
  shipmentNo: string;
  billNo: string;
  billDate: Date;
  totalItems: number;
  totalAmount: number;
  brandName: string;
  /** Set only by the Zoho bill import. Non-null means this shipment CAME FROM a Books bill. */
  zohoBillId: string | null;
  lineItems: Array<{
    productName: string;
    quantity: number;
    deliveredQty: number | null;
    rate: number;
    gstPercent: number | null;
    hsn: string | null;
  }>;
}

/**
 * Claim the DELIVERED transition. Returns the snapshot for the side effects, or null when
 * somebody else already claimed it.
 *
 * MUST be called inside the caller's transaction, so the claim and the stock write commit or
 * roll back together.
 */
export async function finaliseDelivered(
  tx: Tx,
  shipmentId: string,
  userId: string,
  userName: string,
  fromStatus: string
): Promise<DeliveredSnapshot | null> {
  const claim = await tx.inboundShipment.updateMany({
    where: { id: shipmentId, status: { not: "DELIVERED" } },
    data: { status: "DELIVERED", deliveredAt: new Date(), deliveredById: userId },
  });

  // Somebody else got there first. Not an error — two people finishing the same shipment at
  // the same moment is exactly what the claim is for.
  if (claim.count !== 1) {
    log.info("delivered transition already claimed", { shipmentId });
    return null;
  }

  const shipment = await tx.inboundShipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true, shipmentNo: true, billNo: true, billDate: true,
      totalItems: true, totalAmount: true, zohoBillId: true,
      brand: { select: { name: true } },
      lineItems: {
        select: {
          productName: true, quantity: true, deliveredQty: true,
          rate: true, gstPercent: true, hsn: true,
        },
      },
    },
  });
  if (!shipment) return null;

  // MATCHED pre-bookings are fulfilled — the goods are physically in. Same statuses and
  // `fulfilledAt` as the status route this replaces.
  await tx.preBooking.updateMany({
    where: { matchedShipmentId: shipmentId, status: "MATCHED" },
    data: { status: "FULFILLED", fulfilledAt: new Date() },
  });

  await logActivity(tx, {
    module: "inbound",
    action: "delivered",
    entityType: "InboundShipment",
    entityId: shipmentId,
    entityRef: shipment.shipmentNo,
    fromValue: fromStatus,
    toValue: "DELIVERED",
    details: `${shipment.brand.name} — bill ${shipment.billNo}, ${shipment.totalItems} item(s)`,
    userId,
    userName,
  });

  return {
    id: shipment.id,
    shipmentNo: shipment.shipmentNo,
    billNo: shipment.billNo,
    billDate: shipment.billDate,
    totalItems: shipment.totalItems,
    totalAmount: shipment.totalAmount,
    brandName: shipment.brand.name,
    zohoBillId: shipment.zohoBillId,
    lineItems: shipment.lineItems,
  };
}

/**
 * The notification and the Zoho Books push, both deferred.
 *
 * ⚠ CALL THIS ONLY AFTER `await prisma.$transaction(...)` HAS RESOLVED.
 *
 * `after()` runs even when the response throws, so registering it inside the transaction
 * would push a bill to Zoho for a shipment that then rolled back — and a rollback cannot
 * recall a bill from someone else's accounting system.
 *
 * ─── A BEHAVIOUR CHANGE THE PR MUST NAME ──────────────────────────────────────────────────
 *
 * The Books push used to run INLINE in the request (api/inbound/[id]/status/route.ts). It is
 * deferred now, which means a push failure no longer fails the response — it is logged and
 * the receipt still succeeds. That is the right trade (the stock is physically in the
 * building either way) but it IS a change: nobody sees a Zoho error at the goods desk now.
 */
export function scheduleDeliveredSideEffects(
  snapshot: DeliveredSnapshot,
  actor: { id: string; name: string }
) {
  after(async () => {
    try {
      // Whoever can approve inbound shipments, minus the person at the goods desk.
      const recipients = (await usersWithPermission("inbound", "approve")).filter((uid) => uid !== actor.id);
      if (recipients.length === 0) {
        log.debug("shipment delivered but nobody to tell", { shipmentId: snapshot.id });
      } else {
        await notify("inbound.delivered", {
          recipients,
          title: `Shipment ${snapshot.shipmentNo} delivered`,
          body: `${snapshot.brandName} — bill ${snapshot.billNo}, ${snapshot.totalItems} item(s), received by ${actor.name}`,
          refId: snapshot.id,
          link: `/inbound/${snapshot.id}`,
          data: { shipmentId: snapshot.id, shipmentNo: snapshot.shipmentNo },
        });
      }
    } catch (err) {
      log.error("inbound.delivered notification failed", {
        shipmentId: snapshot.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Zoho Books purchase bill ──
    //
    // SKIPPED when the shipment came FROM a Books bill. `zohoBillId` is set only by the bill
    // import (zoho/pull-review/approve), so a non-null value means Books already has this
    // bill — pushing again would duplicate the vendor's invoice in the accounts. Manual
    // shipments have no zohoBillId and rely on the claim guard above, which is why this
    // function runs at most once per shipment.
    if (snapshot.zohoBillId) {
      log.info("shipment came from a Zoho bill; not pushing a second one", {
        shipmentId: snapshot.id,
        zohoBillId: snapshot.zohoBillId,
      });
      return;
    }

    try {
      // getBooks(), which initialises. This was `new BooksClient()` with NO init() call, so
      // createBill threw "Zoho Books client not initialized" every time and the catch
      // swallowed it as best-effort — no bill has ever actually reached Books this way.
      const { getBooks } = await import("@/lib/integrations");
      const zoho = await getBooks();
      if (!zoho) {
        log.info("Zoho Books not connected; no bill pushed", { shipmentId: snapshot.id });
        return;
      }

      const billDate = snapshot.billDate.toISOString().split("T")[0];
      const dueDate = new Date(snapshot.billDate);
      dueDate.setDate(dueDate.getDate() + 30);

      await zoho.createBill({
        vendorName: snapshot.brandName,
        billNo: snapshot.billNo,
        billDate,
        dueDate: dueDate.toISOString().split("T")[0],
        amount: snapshot.totalAmount,
        lineItems: snapshot.lineItems.map((li) => ({
          name: li.productName,
          quantity: li.deliveredQty ?? li.quantity,
          rate: li.rate,
          gstPercent: li.gstPercent || 0,
          hsn: li.hsn || "",
        })),
      });
      log.info("purchase bill pushed to Zoho Books", {
        shipmentId: snapshot.id,
        billNo: snapshot.billNo,
      });
    } catch (zohoErr) {
      log.warn("Zoho bill push failed (non-critical)", {
        shipmentId: snapshot.id,
        error: zohoErr instanceof Error ? zohoErr.message : String(zohoErr),
      });
    }
  });
}
