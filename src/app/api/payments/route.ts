export const dynamic = "force-dynamic";

// Vendor payments (plan 1210 credit notes, Part 5 — R13, F4, X6, X7).
//
// Under Q1 = (b) with D18 a credit note is applied from the bill or the vendor's Credits tab
// (POST /api/vendor-credits/[id]/apply) and is NOT a payment, so this route no longer touches
// credits at all: a body still carrying `creditId` is refused with a sentence.
//
// POST is validate → read → guard-and-write:
//   1. The allocation bills are read once. Each must belong to the payment's vendor, and they
//      must all share one store (Q9) — `storeIdForPayment()`, the rule plan D also calls. No
//      bills → an advance, which needs a store picked by hand (Q9 = a; the form always said so).
//   2. Per allocation ONE conditional UPDATE: the guard and the write are the same statement, so
//      two payments at once cannot both settle the last ₹1,000 (Postgres re-checks the WHERE on
//      the newest row version). `settle` = the amount plus its cash discount, so a CD can no
//      longer over-settle a bill (X6).
//   3. The VendorPayment rows, with storeId, inside the same transaction.
//
// Q4 = (a): a cash discount arrives as a supplier CD credit note, so /payments/new sends no CD.
// `cdDiscountAmount` is still accepted from API callers, on a payment for exactly ONE bill — the
// old route silently dropped it on a multi-bill payment and booked it on an advance.
import { NextRequest } from "next/server";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { vendorPaymentSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { storeIdForPayment, StoreRuleError } from "@/lib/payables/store";
import { createLogger } from "@/lib/logger";

const log = createLogger("payables:payments");

const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const CREDIT_REFUSAL = "Credit notes are applied from the bill or the vendor's Credits tab, not as a payment.";

/** A refusal decided inside the transaction; thrown so it rolls back. */
class PaymentConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConflict";
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireFeature("bills", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    const vendorId = searchParams.get("vendorId") || undefined;
    // storeId=<id> for one store's payments, storeId=none for those recorded without one.
    const storeId = searchParams.get("storeId") || undefined;

    const where: Prisma.VendorPaymentWhereInput = {
      ...(vendorId && { vendorId }),
      ...(storeId === "none" ? { storeId: null } : storeId ? { storeId } : {}),
    };

    const [payments, total] = await Promise.all([
      prisma.vendorPayment.findMany({
        where,
        include: {
          vendor: { select: { name: true, code: true } },
          bill: { select: { billNo: true, amount: true } },
          recordedBy: { select: { name: true } },
          store: { select: { id: true, code: true, name: true } },
        },
        orderBy: { paymentDate: "desc" },
        skip,
        take: limit,
      }),
      prisma.vendorPayment.count({ where }),
    ]);

    log.debug("payments listed", { vendorId, storeId, rows: payments.length, total });
    return paginatedResponse(payments, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("payments list failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not load payments. Try again.", 500);
  }
}

export async function POST(req: NextRequest) {
  let vendorIdForLog: string | null = null;
  try {
    const user = await requireFeature("bills", "create");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      log.warn("payment refused", { reason: "body is not JSON" });
      return errorResponse("Send the payment details.", 400);
    }

    // Before zod: the schema has no creditId any more, and zod would strip it silently — the
    // caller must hear that credits do not travel through this route.
    const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    if ((raw.creditId !== undefined && raw.creditId !== null && raw.creditId !== "") || raw.paymentMode === "CREDIT_ADJUSTMENT") {
      log.warn("payment refused", { reason: "credit sent as a payment", vendorId: typeof raw.vendorId === "string" ? raw.vendorId : null });
      return errorResponse(CREDIT_REFUSAL, 400);
    }

    const data = vendorPaymentSchema.parse(body);
    vendorIdForLog = data.vendorId;
    const refuse = (message: string, reason: string, extra: Record<string, unknown> = {}) => {
      log.warn("payment refused", { vendorId: data.vendorId, reason, ...extra });
      return errorResponse(message, 400);
    };

    const paymentDate = new Date(data.paymentDate);
    if (Number.isNaN(paymentDate.getTime())) return refuse("The payment date is not a valid date.", "bad date");

    const amount = round2(data.amount);
    const cd = round2(data.cdDiscountAmount ?? 0);

    // Multi-bill, single-bill, or none (an advance).
    const allocations = (data.billAllocations && data.billAllocations.length > 0
      ? data.billAllocations
      : data.billId
        ? [{ billId: data.billId, amount: data.amount }]
        : []
    ).map((a) => ({ billId: a.billId, amount: round2(a.amount) }));
    const billIds = allocations.map((a) => a.billId);

    if (allocations.length > 0) {
      const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0));
      if (Math.abs(allocated - amount) > 0.01) {
        return refuse(
          `The ticked bills take ${inr(allocated)} but the payment is ${inr(amount)}. Make them equal — pay any extra as a separate advance.`,
          "allocations do not add up",
          { allocated, amount }
        );
      }
    }
    if (cd > 0 && allocations.length !== 1) {
      return refuse(
        allocations.length === 0
          ? "A cash discount belongs to a bill — tick the bill it was earned on."
          : "A cash discount can be recorded only on a payment for one bill. Pay that bill on its own.",
        "cd without exactly one bill"
      );
    }

    const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId }, select: { id: true, name: true } });
    if (!vendor) return refuse("Vendor not found. Reload.", "vendor not found");

    const bills = billIds.length
      ? await prisma.vendorBill.findMany({
          where: { id: { in: billIds } },
          select: {
            id: true, billNo: true, vendorId: true, amount: true, paidAmount: true, storeId: true,
            vendor: { select: { name: true } },
          },
        })
      : [];
    const byId = new Map(bills.map((b) => [b.id, b]));
    for (const a of allocations) {
      const bill = byId.get(a.billId);
      if (!bill) return refuse("A ticked bill no longer exists. Reload.", "bill not found", { billId: a.billId });
      if (bill.vendorId !== data.vendorId) {
        return refuse(`Bill ${bill.billNo} belongs to ${bill.vendor.name}, not ${vendor.name}.`, "bill of another vendor", { billId: bill.id });
      }
      const settle = round2(a.amount + (allocations.length === 1 ? cd : 0));
      const left = round2(bill.amount - bill.paidAmount);
      if (settle > left + 0.01) {
        return refuse(
          left <= 0.01
            ? `Bill ${bill.billNo} is already settled.`
            : `${inr(settle)} is more than the ${inr(left)} left on bill ${bill.billNo}.`,
          "more than bill left",
          { billId: bill.id, settle, left }
        );
      }
    }

    // One store per payment (Q9). Throws StoreRuleError with the sentence.
    const storeId = await storeIdForPayment({ billIds, explicitStoreId: data.storeId ?? null });
    if (storeId) {
      const store = await prisma.store.findUnique({ where: { id: storeId }, select: { isActive: true } });
      if (!store || !store.isActive) return refuse("That store does not exist or is switched off. Reload.", "store not found", { storeId });
    }

    const multi = allocations.length > 1;
    const notes = multi ? `${data.notes || ""} [Multi-bill payment: ₹${amount}]`.trim() : data.notes || null;
    const base = {
      vendorId: data.vendorId,
      paymentMode: data.paymentMode,
      paymentDate,
      referenceNo: data.referenceNo || null,
      notes,
      recordedById: user.id,
      storeId,
    };
    const include = { vendor: { select: { name: true } }, bill: { select: { billNo: true } }, store: { select: { name: true } } } as const;

    const payments = await prisma.$transaction(async (tx) => {
      const created = [];
      if (allocations.length === 0) {
        created.push(
          await tx.vendorPayment.create({
            data: { ...base, billId: null, amount, cdDiscountAmount: 0 },
            include,
          })
        );
        return created;
      }

      // Bill ids in a fixed order: two multi-bill payments touching the same bills lock them in
      // the same order and cannot deadlock.
      for (const a of [...allocations].sort((x, y) => x.billId.localeCompare(y.billId))) {
        const bill = byId.get(a.billId)!;
        const cdShare = allocations.length === 1 ? cd : 0;
        const settle = round2(a.amount + cdShare).toFixed(2);
        // The bill's store must be what it was when read — the payment's store came from it.
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE "VendorBill"
             SET "paidAmount" = round("paidAmount"::numeric + ${settle}::numeric, 2),
                 status = (CASE
                             WHEN status = 'DISPUTED'::"BillStatus" THEN 'DISPUTED'
                             WHEN "paidAmount" + ${settle}::numeric >= amount - 0.01 THEN 'PAID'
                             WHEN status = 'OVERDUE'::"BillStatus" THEN 'OVERDUE'
                             ELSE 'PARTIALLY_PAID'
                           END)::"BillStatus",
                 "updatedAt" = now()
           WHERE id = ${a.billId}
             AND "vendorId" = ${data.vendorId}
             AND "storeId" IS NOT DISTINCT FROM ${bill.storeId}::text
             AND amount - "paidAmount" + 0.01 >= ${settle}::numeric
          RETURNING id`;
        if (rows.length === 0) {
          const now = await tx.vendorBill.findUnique({ where: { id: a.billId }, select: { amount: true, paidAmount: true, storeId: true } });
          if (!now) throw new PaymentConflict(`Bill ${bill.billNo} was removed since you opened the form. Reload.`);
          if (now.storeId !== bill.storeId) throw new PaymentConflict(`Bill ${bill.billNo}'s store was changed since you opened the form. Reload.`);
          throw new PaymentConflict(
            `Bill ${bill.billNo} changed since you opened the form — it now has ${inr(Math.max(0, round2(now.amount - now.paidAmount)))} left. Reload.`
          );
        }
        created.push(
          await tx.vendorPayment.create({
            data: { ...base, billId: a.billId, amount: a.amount, cdDiscountAmount: cdShare },
            include,
          })
        );
      }
      return created;
    });

    log.info("vendor payment recorded", {
      paymentIds: payments.map((p) => p.id),
      vendorId: data.vendorId,
      billIds,
      storeId,
      total: amount,
      cd,
      advance: allocations.length === 0,
    });
    // Same shape as before: one payment object, or { payments, count } for a multi-bill payment.
    return successResponse(payments.length === 1 ? payments[0] : { payments, count: payments.length }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid payment details";
      log.warn("payment refused", { vendorId: vendorIdForLog, reason: message });
      return errorResponse(message, 400);
    }
    if (error instanceof StoreRuleError) {
      log.warn("payment refused", { vendorId: vendorIdForLog, reason: error.message });
      return errorResponse(error.message, 400);
    }
    if (error instanceof PaymentConflict) {
      log.warn("payment refused", { vendorId: vendorIdForLog, reason: error.message, status: 409 });
      return errorResponse(error.message, 409);
    }
    log.error("payment failed", { vendorId: vendorIdForLog, message: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not record the payment. Nothing was saved — try again.", 500);
  }
}
