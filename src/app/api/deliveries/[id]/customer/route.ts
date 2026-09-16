export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { isDummy, TERMINAL_STATUSES } from "@/lib/deliveries/floor-stock";
import { findOrCreateCustomerByPhone } from "@/lib/customers/find-or-create-by-phone";
import { toPlus91 } from "@/lib/phone";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:customer");

const DUMMY_MESSAGE = "Dummy delivery: no warehouse matched this invoice number. No actions are allowed.";
const NO_PHONE_MESSAGE = "Enter the customer's phone number.";

/** B2: staff may type or correct the phone before saving; absent → the delivery's own phone. */
const bodySchema = z.object({
  phone: z.string().optional(),
});

/** A refusal raised inside the transaction that carries its own HTTP status. */
class SaveCustomerRefusal extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SaveCustomerRefusal";
    this.status = status;
  }
}

/**
 * Save Contact (plan 1609-deliveries, Phase 2 §2.3; A1, A2, A4, B2, B3).
 *
 * Writes the database only: finds the `Customer` by phone (`+91-` and bare 10-digit forms) or
 * creates one, links it through `Delivery.customerId`, and rewrites the delivery's
 * `customerPhone` as `+91-XXXXXXXXXX` (B3 — a row converts when it is touched). An existing
 * customer row is never changed. Re-saving an already-linked delivery is allowed and re-links
 * it to whichever customer owns the phone now given.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  try {
    await requireFeature("deliveries", "edit");
    const { id } = await params;
    deliveryId = id;

    let raw: unknown = {};
    try {
      raw = await req.json();
    } catch (err) {
      // An empty body is legitimate: "save with the delivery's own phone".
      log.debug("save customer: no JSON body, using the delivery's phone", {
        deliveryId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      raw = {};
    }
    const parsed = bodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      log.warn("save customer refused: invalid body", { deliveryId: id });
      return errorResponse(NO_PHONE_MESSAGE, 400);
    }
    const body = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { id },
        select: {
          id: true,
          invoiceNo: true,
          status: true,
          warehouseId: true,
          customerName: true,
          customerPhone: true,
          customerId: true,
        },
      });
      if (!delivery) throw new SaveCustomerRefusal("Delivery not found", 404);
      if (isDummy(delivery)) throw new SaveCustomerRefusal(DUMMY_MESSAGE, 409);
      if ((TERMINAL_STATUSES as readonly string[]).includes(delivery.status)) {
        throw new SaveCustomerRefusal("This delivery is already complete.", 409);
      }

      const phone = body.phone ?? delivery.customerPhone ?? "";
      const plus91 = toPlus91(phone);
      if (!plus91) throw new SaveCustomerRefusal(NO_PHONE_MESSAGE, 400);

      const customer = await findOrCreateCustomerByPhone(tx, {
        name: delivery.customerName,
        phone: plus91,
      });

      await tx.delivery.update({
        where: { id: delivery.id },
        data: { customerId: customer.id, customerPhone: plus91 },
      });

      return {
        customer,
        invoiceNo: delivery.invoiceNo,
        relinked: !!delivery.customerId && delivery.customerId !== customer.id,
      };
    });

    log.info("customer linked", {
      deliveryId,
      invoiceNo: result.invoiceNo,
      customerId: result.customer.id,
      alreadyExisted: result.customer.alreadyExisted,
      relinked: result.relinked,
    });

    return successResponse({
      customerId: result.customer.id,
      name: result.customer.name,
      phone: result.customer.phone,
      alreadyExisted: result.customer.alreadyExisted,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("save customer refused", { deliveryId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof SaveCustomerRefusal) {
      log.warn("save customer refused", { deliveryId, status: error.status, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    log.error("save customer failed", {
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to save the customer", 500);
  }
}
