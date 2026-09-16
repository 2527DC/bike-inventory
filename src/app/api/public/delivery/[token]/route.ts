export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { createLogger } from "@/lib/logger";
import { toPlus91, isValidMobile, samePhone } from "@/lib/phone";
import { slotRefusal, SLOT_REFUSAL_MESSAGE, istDayBounds, isDateString } from "@/lib/deliveries/slots";
import { holdDeliveryStock, isDummy } from "@/lib/deliveries/floor-stock";

/**
 * The customer's delivery form, reached from a WhatsApp link. PUBLIC BY DESIGN — no session and
 * no permission check (CLAUDE.md "Routes that must stay public"). The token is the only key.
 *
 * Plan 1609-deliveries §2.6: once submitted the link is locked (A7); the main phone is read-only
 * and a `customerPhone` in the body is ignored (A10); the alternate is mandatory and must differ
 * from the main number (A11, A12); the submit moves PENDING/VERIFIED straight to SCHEDULED
 * (R25, A17) — Bangalore on the chosen slot day, outstation with no date (A27) — and tries to
 * hold stock without ever failing on a shortage (A26).
 *
 * Logging: the delivery id and the outcome only. Never the token, a phone or the address.
 */
const log = createLogger("public:self-fill");

const GENERIC_ERROR = "Something went wrong. Please try again.";
const NOT_FOUND = "Invalid link. Please contact the store.";
const EXPIRED = "This link has expired. Please contact the store for a new link.";
const LOCKED = "These delivery details were already submitted. Please contact the store to change them.";
const NOT_CHANGEABLE = "This delivery can no longer be changed online. Please contact the store.";
const BAD_ALTERNATE = "Enter a valid 10-digit alternate number.";
const SAME_ALTERNATE = "The alternate number must be different from your main number.";
const NEED_DATE = "Please choose a delivery date.";

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} is too long (${max} characters at most).`).optional();

// Unknown keys (customerPhone among them) are stripped by z.object — A10.
const selfFillSchema = z.object({
  isOutstation: z.boolean({ error: "Choose whether the delivery is inside or outside Bangalore." }),
  customerAddress: z
    .string({ error: "Please enter your full address." })
    .trim()
    .min(5, "Please enter a valid address (at least 5 characters).")
    .max(500, "The address is too long (500 characters at most)."),
  customerArea: optionalText(100, "The area"),
  customerPincode: z
    .string({ error: "Enter a valid 6-digit pincode." })
    .trim()
    .regex(/^\d{6}$/, "Enter a valid 6-digit pincode."),
  mapsLink: optionalText(500, "The maps link"),
  alternatePhone: z.string({ error: BAD_ALTERNATE }).trim().min(1, BAD_ALTERNATE),
  deliveryNotes: optionalText(500, "The delivery instructions"),
  requestedDate: z.string().trim().nullish(),
});

/** A refusal decided inside the transaction; rolls it back and becomes a customer message. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly outcome: string
  ) {
    super(message);
    this.name = "Refusal";
  }
}

/**
 * What of a caught error is safe to log. A Prisma validation error prints the whole call,
 * arguments included — the token, the phone and the address — so its message is dropped.
 */
function safeErrorContext(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: "non-Error thrown" };
  const code = (error as { code?: unknown }).code;
  return {
    name: error.name,
    ...(typeof code === "string" ? { code } : {}),
    ...(error.name === "PrismaClientValidationError" ? {} : { error: error.message }),
  };
}

// GET — public: the delivery the link points at
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  let deliveryId: string | undefined;
  try {
    const { token } = await params;

    const delivery = await prisma.delivery.findUnique({
      where: { selfFillToken: token },
      select: {
        id: true,
        invoiceNo: true,
        customerName: true,
        customerPhone: true,
        alternatePhone: true,
        customerAddress: true,
        customerArea: true,
        customerPincode: true,
        lineItems: true,
        isOutstation: true,
        scheduledDate: true,
        selfFillTokenExpiry: true,
        selfFillCompletedAt: true,
      },
    });

    if (!delivery) {
      log.info("self-fill link not found");
      return errorResponse(NOT_FOUND, 404);
    }
    deliveryId = delivery.id;

    if (delivery.selfFillTokenExpiry && new Date() > delivery.selfFillTokenExpiry) {
      log.info("self-fill link expired", { deliveryId });
      return errorResponse(EXPIRED, 410);
    }

    log.debug("self-fill link opened", { deliveryId, locked: !!delivery.selfFillCompletedAt });
    return successResponse({
      invoiceNo: delivery.invoiceNo,
      customerName: delivery.customerName,
      customerPhone: toPlus91(delivery.customerPhone),
      alternatePhone: delivery.alternatePhone,
      // Prefill for the address fields, as before this plan (§2.6 "GET adds …").
      customerAddress: delivery.customerAddress,
      customerArea: delivery.customerArea,
      customerPincode: delivery.customerPincode,
      lineItems: delivery.lineItems,
      isOutstation: delivery.isOutstation,
      scheduledDate: delivery.scheduledDate,
      selfFillCompletedAt: delivery.selfFillCompletedAt,
      locked: !!delivery.selfFillCompletedAt,
    });
  } catch (error) {
    log.error("self-fill GET failed", { deliveryId, ...safeErrorContext(error) });
    return errorResponse(GENERIC_ERROR, 500);
  }
}

// PUT — public: the customer submits their delivery details (no auth)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  let deliveryId: string | undefined;
  try {
    const { token } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch (e) {
      log.warn("self-fill PUT body is not JSON", { error: e instanceof Error ? e.message : String(e) });
      return errorResponse("Please fill in the form and try again.", 400);
    }

    const parsed = selfFillSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      log.info("self-fill refused: invalid body", { field: issue?.path.join("."), code: issue?.code });
      return errorResponse(issue?.message ?? "Please check the form and try again.", 400);
    }
    const input = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { selfFillToken: token },
        select: {
          id: true,
          status: true,
          warehouseId: true,
          customerPhone: true,
          selfFillTokenExpiry: true,
          selfFillCompletedAt: true,
        },
      });

      if (!delivery) throw new Refusal(404, NOT_FOUND, "not found");
      deliveryId = delivery.id;

      if (delivery.selfFillTokenExpiry && new Date() > delivery.selfFillTokenExpiry) {
        throw new Refusal(410, EXPIRED, "expired");
      }
      if (delivery.selfFillCompletedAt) throw new Refusal(409, LOCKED, "locked");
      if ((delivery.status !== "PENDING" && delivery.status !== "VERIFIED") || isDummy(delivery)) {
        throw new Refusal(409, NOT_CHANGEABLE, isDummy(delivery) ? "dummy" : `status ${delivery.status}`);
      }

      if (!isValidMobile(input.alternatePhone)) throw new Refusal(400, BAD_ALTERNATE, "bad alternate");
      if (samePhone(input.alternatePhone, delivery.customerPhone)) {
        throw new Refusal(400, SAME_ALTERNATE, "alternate equals main");
      }

      let scheduledDate: Date | undefined;
      if (!input.isOutstation) {
        const day = input.requestedDate ?? "";
        if (!isDateString(day)) throw new Refusal(400, NEED_DATE, "no date");
        const refusal = await slotRefusal(tx, day, delivery.id);
        if (refusal) throw new Refusal(409, SLOT_REFUSAL_MESSAGE[refusal], `slot ${refusal}`);
        scheduledDate = istDayBounds(day).start;
      }

      // Conditional write: a second submit racing this one re-checks the lock on the row it
      // waited for and matches nothing, instead of scheduling (and holding stock) twice.
      const written = await tx.delivery.updateMany({
        where: { id: delivery.id, selfFillCompletedAt: null, status: { in: ["PENDING", "VERIFIED"] } },
        data: {
          customerAddress: input.customerAddress,
          ...(input.customerArea !== undefined ? { customerArea: input.customerArea || null } : {}),
          customerPincode: input.customerPincode,
          ...(input.mapsLink !== undefined ? { mapsLink: input.mapsLink || null } : {}),
          ...(input.deliveryNotes !== undefined ? { deliveryNotes: input.deliveryNotes || null } : {}),
          alternatePhone: toPlus91(input.alternatePhone),
          isOutstation: input.isOutstation,
          // Outstation: no date (A27) — whatever the row had is left as it was.
          ...(scheduledDate ? { scheduledDate } : {}),
          selfFillCompletedAt: new Date(),
          status: "SCHEDULED",
        },
      });
      if (written.count !== 1) throw new Refusal(409, LOCKED, "lost race");

      const updated = await tx.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        select: {
          id: true,
          invoiceNo: true,
          warehouseId: true,
          lineItems: true,
          stockReservedAt: true,
          scheduledDate: true,
          isOutstation: true,
        },
      });

      // Never fails on a shortage (A26); the outcome is for staff screens, not the customer.
      const hold = await holdDeliveryStock(tx, updated);
      return { updated, held: hold.held, shortLines: hold.short.length };
    });

    log.info("self-fill submitted: scheduled", {
      deliveryId: result.updated.id,
      outstation: result.updated.isOutstation,
      stockHeld: result.held,
      shortLines: result.shortLines,
    });
    return successResponse({ saved: true, scheduledDate: result.updated.scheduledDate });
  } catch (error) {
    if (error instanceof Refusal) {
      log.info("self-fill refused", { deliveryId, outcome: error.outcome, status: error.status });
      return errorResponse(error.message, error.status);
    }
    log.error("self-fill PUT failed", { deliveryId, ...safeErrorContext(error) });
    return errorResponse(GENERIC_ERROR, 500);
  }
}
