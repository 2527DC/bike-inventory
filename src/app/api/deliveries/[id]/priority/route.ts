export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { floorShortForDispatch, isDummy } from "@/lib/deliveries/floor-stock";
import { pickUnitsUpTo } from "@/lib/units";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:priority");

/**
 * ★ priority on an outward (plan 1709, R16, R19, R21, Q35, Q12).
 *
 * ─── WHAT STARRING ACTUALLY DOES ──────────────────────────────────────────────────────────
 *
 * Starring is not a label. For every line the outward's FLOOR cannot cover, it picks real units
 * in the same store's GODOWN warehouses and stamps `reservedForDeliveryId` on them. That is what
 * makes an unassembled cycle appear with a ★ on the assembly Awaiting list IMMEDIATELY (Q12) —
 * before the transfer that will bring it to the floor has even been approved. The build starts
 * now; the paperwork catches up.
 *
 * Unstarring releases every unit held for this outward and clears the star. A build already in
 * progress carries on (R21) — the unit keeps its assembly task; it simply stops being spoken for.
 *
 * ─── WHY `pickUnitsUpTo`, NOT `pickUnits` ─────────────────────────────────────────────────
 *
 * Stock that predates unit records exists in quantity but not as rows (P8, P11). A godown holding
 * 10 by count and 3 by unit record must still star: it reserves the 3 that exist and says so. A
 * throwing pick would make ★ unusable on most of today's stock.
 *
 * ─── WHY IT PICKS ONLY UNRESERVED UNITS ───────────────────────────────────────────────────
 *
 * `pickUnitsUpTo` without `reservedForDeliveryId` matches only units held for nobody, so a second
 * star never steals the first outward's cycles, and re-starring never double-counts its own.
 */
const bodySchema = z.object({ starred: z.boolean() });

const DUMMY_MESSAGE = "Dummy delivery: no warehouse matched this invoice number. No actions are allowed.";

/** A refusal raised inside the transaction that carries its own HTTP status. */
class PriorityRefusal extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PriorityRefusal";
    this.status = status;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  let starred: boolean | undefined;
  try {
    // Its own module (R19, Q21): the star is grantable without `deliveries.edit`, because the
    // person who decides what gets built first is not always the person who edits the outward.
    const user = await requireFeature("delivery_priority", "edit");
    const { id } = await params;
    deliveryId = id;
    const body = bodySchema.parse(await req.json());
    starred = body.starred;

    const result = await prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { id },
        select: {
          id: true,
          invoiceNo: true,
          status: true,
          warehouseId: true,
          lineItems: true,
          stockReservedAt: true,
          priorityAt: true,
          warehouse: { select: { storeId: true, name: true } },
        },
      });
      if (!delivery) throw new PriorityRefusal("Delivery not found", 404);
      // Every new rule skips a Dummy (Q37).
      if (isDummy(delivery)) throw new PriorityRefusal(DUMMY_MESSAGE, 409);
      if (["DELIVERED", "WALK_OUT"].includes(delivery.status)) {
        throw new PriorityRefusal("This outward is already closed.", 409);
      }

      if (!body.starred) {
        // ── Unstar ────────────────────────────────────────────────────────────────────────
        const { count: released } = await tx.inventoryUnit.updateMany({
          where: { reservedForDeliveryId: id },
          data: { reservedForDeliveryId: null, reservedAt: null },
        });
        const updated = await tx.delivery.update({
          where: { id },
          data: { priorityAt: null, priorityById: null },
          select: { id: true, priorityAt: true },
        });
        await logActivity(tx, {
          module: "deliveries",
          action: "priority_cleared",
          entityType: "Delivery",
          entityId: id,
          entityRef: delivery.invoiceNo,
          fromValue: "PRIORITY",
          toValue: null,
          details: released > 0 ? `${released} reserved unit${released === 1 ? "" : "s"} released` : null,
          userId: user.id,
          userName: user.name,
        });
        return { starred: false, priorityAt: updated.priorityAt, reserved: 0, released, shortLines: 0 };
      }

      // ── Star ──────────────────────────────────────────────────────────────────────────
      // What the floor cannot cover. Returns [] when the outward is already held, in which case
      // starring is purely an ordering signal and nothing needs reserving.
      const short = await floorShortForDispatch(tx, delivery);

      let reserved = 0;
      if (short.length > 0 && delivery.warehouse?.storeId) {
        const godowns = await tx.warehouse.findMany({
          where: { storeId: delivery.warehouse.storeId, kind: "GODOWN", isActive: true },
          select: { id: true, name: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        });

        for (const line of short) {
          // Units already held for this outward count towards the shortfall.
          const held = await tx.inventoryUnit.count({
            where: { reservedForDeliveryId: id, productId: line.productId },
          });
          let remaining = Math.max(0, line.needed - line.available - held);

          for (const godown of godowns) {
            if (remaining <= 0) break;
            const picked = await pickUnitsUpTo(tx, {
              productId: line.productId,
              warehouseId: godown.id,
              qty: remaining,
              order: "sale",
            });
            if (picked.length === 0) continue;
            const { count } = await tx.inventoryUnit.updateMany({
              where: { id: { in: picked } },
              data: { reservedForDeliveryId: id, reservedAt: new Date() },
            });
            reserved += count;
            remaining -= count;
          }

          if (remaining > 0) {
            log.warn("star could not reserve every short unit", {
              deliveryId: id,
              productId: line.productId,
              stillShort: remaining,
            });
          }
        }
      }

      const updated = await tx.delivery.update({
        where: { id },
        data: { priorityAt: delivery.priorityAt ?? new Date(), priorityById: user.id },
        select: { id: true, priorityAt: true },
      });

      await logActivity(tx, {
        module: "deliveries",
        action: "priority_set",
        entityType: "Delivery",
        entityId: id,
        entityRef: delivery.invoiceNo,
        toValue: "PRIORITY",
        details:
          short.length > 0
            ? `${reserved} unit${reserved === 1 ? "" : "s"} reserved in the godown for ${short.length} short line${short.length === 1 ? "" : "s"}`
            : "Floor already holds the stock",
        userId: user.id,
        userName: user.name,
      });

      return { starred: true, priorityAt: updated.priorityAt, reserved, released: 0, shortLines: short.length };
    });

    log.info("outward priority updated", {
      deliveryId,
      starred: result.starred,
      unitsReserved: result.reserved,
      unitsReleased: result.released,
      shortLines: result.shortLines,
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("priority refused", { deliveryId, starred, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof PriorityRefusal) {
      log.warn("priority refused", { deliveryId, starred, status: error.status, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof z.ZodError) {
      log.warn("priority body rejected", { deliveryId });
      return errorResponse("Send { starred: true } or { starred: false }.", 400);
    }
    log.error("priority failed", {
      deliveryId,
      starred,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to update priority", 500);
  }
}
