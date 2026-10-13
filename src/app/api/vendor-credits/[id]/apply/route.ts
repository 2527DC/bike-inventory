export const dynamic = "force-dynamic";

// POST /api/vendor-credits/[id]/apply { billId, amount, note? } — Apply credit (plan 1210 credit
// notes, Part 4, 13 Oct 2026: Q1 = b, D18, D19).
//
// Uses part of a vendor credit against one bill of the same vendor. It is NOT a payment: no
// VendorPayment row is written (D18), and Zoho is never told (Q1 = b) — the credit stays open in
// Zoho and the bill stays unpaid there by this amount until someone applies it in Zoho too. That
// is the owner's accepted consequence, not a bug.
//
// Refused with a 400 before any write when the credit and the bill belong to different vendors,
// when both have a store and the stores differ, or when the amount is more than either side has
// left. Then ONE transaction of three statements. In both conditional UPDATEs the guard and the
// write are the same statement — Postgres re-checks the WHERE against the newest row version — so
// two people applying the last ₹500 at once cannot both pass; the loser gets a 409 sentence.
//
//   1. VendorCredit.usedAmount += amount   WHERE still OPEN, same vendor, same store, enough open
//   2. VendorBill.paidAmount and creditAppliedAmount += amount (one statement, so the credit sync's
//      invariant creditAppliedAmount = Σ applications holds)   WHERE same vendor, not disputed,
//      store compatible, enough left
//   3. INSERT VendorCreditApplication { source: APP, appliedById, appliedDate = today IST }
//
// Money columns: VendorCredit.amount/usedAmount and VendorBill.amount/paidAmount are Float (a
// known defect, never extended); creditAppliedAmount and the application amount are Decimal(12,2).
// The amount travels as a 2-decimal string cast to numeric, and the Float columns are written
// rounded to the paisa so repeated applies do not accumulate binary drift.
import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { vendorCreditApplySchema } from "@/lib/validations";
import { logActivity } from "@/lib/activity-log";
import { getStartOfTodayIST } from "@/lib/services/timezone";
import { createLogger } from "@/lib/logger";

const log = createLogger("payables:credit-apply");

const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** A refusal decided inside the transaction. Thrown to roll it back; answered as `status`. */
class ApplyRefusal extends Error {
  status: 400 | 409;
  constructor(message: string, status: 400 | 409) {
    super(message);
    this.name = "ApplyRefusal";
    this.status = status;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let creditId: string | null = null;
  let billId: string | null = null;
  try {
    const user = await requireFeature("bills", "create");
    const { id } = await params;
    creditId = id;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      log.warn("apply refused", { vendorCreditId: id, reason: "body is not JSON" });
      return errorResponse("Send the bill and the amount to apply.", 400);
    }
    const data = vendorCreditApplySchema.parse(body);
    billId = data.billId;
    const amount = round2(data.amount);
    if (amount <= 0) {
      log.warn("apply refused", { vendorCreditId: id, billId, reason: "amount not positive" });
      return errorResponse("The amount to apply must be more than zero.", 400);
    }

    const [credit, bill] = await Promise.all([
      prisma.vendorCredit.findUnique({
        where: { id },
        select: {
          id: true, vendorId: true, creditNoteNo: true, amount: true, usedAmount: true, status: true,
          storeId: true, store: { select: { name: true } }, vendor: { select: { name: true } },
        },
      }),
      prisma.vendorBill.findUnique({
        where: { id: data.billId },
        select: {
          id: true, vendorId: true, billNo: true, amount: true, paidAmount: true, status: true,
          storeId: true, store: { select: { name: true } }, vendor: { select: { name: true } },
        },
      }),
    ]);
    if (!credit) {
      log.warn("apply refused", { vendorCreditId: id, billId, reason: "credit not found" });
      return errorResponse("Credit note not found. Reload.", 404);
    }
    if (!bill) {
      log.warn("apply refused", { vendorCreditId: id, billId, reason: "bill not found" });
      return errorResponse("Bill not found. Reload.", 404);
    }

    // ── Refusals before any write ──
    const refuse = (message: string, status: 400 | 409, reason: string) => {
      log.warn("apply refused", { vendorCreditId: id, billId: bill.id, amount, reason });
      return errorResponse(message, status);
    };
    if (credit.vendorId !== bill.vendorId) {
      return refuse(
        `${credit.creditNoteNo} is ${credit.vendor.name}'s; bill ${bill.billNo} is ${bill.vendor.name}'s. A credit applies only to its own vendor's bills.`,
        400,
        "different vendors"
      );
    }
    if (credit.storeId && bill.storeId && credit.storeId !== bill.storeId) {
      return refuse(
        `${credit.creditNoteNo} is ${credit.store?.name}'s; bill ${bill.billNo} is ${bill.store?.name}'s. A credit applies only to bills of its own store.`,
        400,
        "different stores"
      );
    }
    if (credit.status !== "OPEN") {
      return refuse(
        `Credit ${credit.creditNoteNo} is ${credit.status === "VOID" ? "void" : "closed"} in Zoho — it cannot be applied.`,
        409,
        `credit ${credit.status}`
      );
    }
    if (bill.status === "DISPUTED") {
      return refuse(`Bill ${bill.billNo} is disputed — settle the dispute before applying a credit.`, 409, "bill disputed");
    }
    const creditOpen = round2(credit.amount - credit.usedAmount);
    const billLeft = round2(bill.amount - bill.paidAmount);
    if (creditOpen <= 0.01) {
      return refuse(`Credit ${credit.creditNoteNo} has nothing left to apply.`, 409, "credit fully used");
    }
    if (billLeft <= 0.01) {
      return refuse(`Bill ${bill.billNo} is already settled.`, 409, "bill settled");
    }
    if (amount > creditOpen + 0.01) {
      return refuse(`${inr(amount)} is more than the ${inr(creditOpen)} open on credit ${credit.creditNoteNo}.`, 400, "more than credit open");
    }
    if (amount > billLeft + 0.01) {
      return refuse(`${inr(amount)} is more than the ${inr(billLeft)} left on bill ${bill.billNo}.`, 400, "more than bill left");
    }

    // ── One transaction, three statements ──
    const amt = amount.toFixed(2);
    const vendorId = credit.vendorId;
    const creditStoreId = credit.storeId;
    const appliedDate = getStartOfTodayIST();

    const result = await prisma.$transaction(async (tx) => {
      // 1. The credit. Same store as when it was read, so the store check above still holds.
      const creditRows = await tx.$queryRaw<Array<{ amount: number; usedAmount: number }>>`
        UPDATE "VendorCredit"
           SET "usedAmount" = round("usedAmount"::numeric + ${amt}::numeric, 2),
               "updatedAt" = now()
         WHERE id = ${credit.id}
           AND "vendorId" = ${vendorId}
           AND status = 'OPEN'::"VendorCreditStatus"
           AND "storeId" IS NOT DISTINCT FROM ${creditStoreId}::text
           AND amount - "usedAmount" + 0.01 >= ${amt}::numeric
        RETURNING amount, "usedAmount"`;
      if (creditRows.length === 0) {
        const now = await tx.vendorCredit.findUnique({
          where: { id: credit.id },
          select: { amount: true, usedAmount: true, status: true, storeId: true },
        });
        if (!now) throw new ApplyRefusal("This credit note was removed a moment ago. Reload.", 409);
        if (now.status !== "OPEN") {
          throw new ApplyRefusal(`Credit ${credit.creditNoteNo} is now ${now.status === "VOID" ? "void" : "closed"} in Zoho. Reload.`, 409);
        }
        if (now.storeId !== creditStoreId) {
          throw new ApplyRefusal(`Credit ${credit.creditNoteNo}'s store was changed a moment ago. Reload.`, 409);
        }
        throw new ApplyRefusal(
          `Credit ${credit.creditNoteNo} has only ${inr(Math.max(0, round2(now.amount - now.usedAmount)))} open now. Reload.`,
          409
        );
      }

      // 2. The bill. paidAmount and creditAppliedAmount move together; a hand-set OVERDUE stays
      // OVERDUE while money is still owed. Store compatible with the credit's (null = not known).
      const billRows = await tx.$queryRaw<Array<{ amount: number; paidAmount: number; status: string }>>`
        UPDATE "VendorBill"
           SET "paidAmount" = round("paidAmount"::numeric + ${amt}::numeric, 2),
               "creditAppliedAmount" = "creditAppliedAmount" + ${amt}::numeric,
               status = (CASE
                           WHEN "paidAmount" + ${amt}::numeric >= amount - 0.01 THEN 'PAID'
                           WHEN status = 'OVERDUE'::"BillStatus" THEN 'OVERDUE'
                           ELSE 'PARTIALLY_PAID'
                         END)::"BillStatus",
               "updatedAt" = now()
         WHERE id = ${bill.id}
           AND "vendorId" = ${vendorId}
           AND status <> 'DISPUTED'::"BillStatus"
           AND (${creditStoreId}::text IS NULL OR "storeId" IS NULL OR "storeId" = ${creditStoreId}::text)
           AND amount - "paidAmount" + 0.01 >= ${amt}::numeric
        RETURNING amount, "paidAmount", status::text AS status`;
      if (billRows.length === 0) {
        const now = await tx.vendorBill.findUnique({
          where: { id: bill.id },
          select: { amount: true, paidAmount: true, status: true, storeId: true },
        });
        if (!now) throw new ApplyRefusal("This bill was removed a moment ago. Reload.", 409);
        if (now.status === "DISPUTED") {
          throw new ApplyRefusal(`Bill ${bill.billNo} is disputed — settle the dispute before applying a credit.`, 409);
        }
        if (creditStoreId && now.storeId && now.storeId !== creditStoreId) {
          throw new ApplyRefusal(`Bill ${bill.billNo}'s store was changed a moment ago. Reload.`, 409);
        }
        throw new ApplyRefusal(
          `Bill ${bill.billNo} has only ${inr(Math.max(0, round2(now.amount - now.paidAmount)))} left now. Reload.`,
          409
        );
      }

      // 3. The application — made here, by this person. No Zoho ids: Zoho is never told.
      const application = await tx.vendorCreditApplication.create({
        data: {
          source: "APP",
          vendorCreditId: credit.id,
          billId: bill.id,
          amount: amt,
          appliedDate,
          appliedById: user.id,
          note: data.note?.trim() || null,
        },
        select: { id: true },
      });

      // Inside the transaction: the log entry is evidence of who applied it (D19).
      await logActivity(tx, {
        module: "bills",
        action: "credit_applied",
        entityType: "VendorBill",
        entityId: bill.id,
        entityRef: bill.billNo,
        toValue: amt,
        details: `Credit ${credit.creditNoteNo} · ${inr(amount)} applied · application ${application.id}`,
        userId: user.id,
        userName: user.name,
      });

      return { application, credit: creditRows[0], bill: billRows[0] };
    });

    log.info("credit applied", {
      applicationId: result.application.id,
      vendorCreditId: credit.id,
      billId: bill.id,
      amount,
      userId: user.id,
    });
    return successResponse(
      {
        applicationId: result.application.id,
        credit: {
          id: credit.id,
          creditNoteNo: credit.creditNoteNo,
          open: round2(result.credit.amount - result.credit.usedAmount),
        },
        bill: {
          id: bill.id,
          billNo: bill.billNo,
          remaining: round2(result.bill.amount - result.bill.paidAmount),
          status: result.bill.status,
        },
        amount,
      },
      201
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid details";
      log.warn("apply refused", { vendorCreditId: creditId, billId, reason: message });
      return errorResponse(message, 400);
    }
    if (error instanceof ApplyRefusal) {
      log.warn("apply refused", { vendorCreditId: creditId, billId, reason: error.message, status: error.status });
      return errorResponse(error.message, error.status);
    }
    log.error("apply failed", {
      vendorCreditId: creditId,
      billId,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not apply the credit. Nothing was changed — try again.", 500);
  }
}
