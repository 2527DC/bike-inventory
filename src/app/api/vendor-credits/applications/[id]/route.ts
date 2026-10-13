export const dynamic = "force-dynamic";

// DELETE /api/vendor-credits/applications/[id] — remove a credit application made here (plan
// 1210 credit notes, Part 4, 13 Oct 2026: D19).
//
// Only `source = APP` rows. A ZOHO row is Zoho's fact: removing it here would be undone by the
// next fetch, so it is refused with a sentence that says where to remove it.
//
// One transaction, the apply route's three statements in reverse, each conditional:
//   1. DELETE the application WHERE id AND source = APP — 0 rows means someone removed it first
//   2. VendorCredit.usedAmount −= amount   (skipped if the credit is gone — SetNull left it null)
//   3. VendorBill.paidAmount and creditAppliedAmount −= amount, status recomputed  WHERE the bill
//      still carries at least that much credit — so paidAmount can never go below what was paid
// The bill and the credit come back by exactly the amount, and the activity log names who did it.
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("payables:credit-apply");

const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

class RemoveRefusal extends Error {
  status: 409;
  constructor(message: string) {
    super(message);
    this.name = "RemoveRefusal";
    this.status = 409;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let applicationId: string | null = null;
  try {
    const user = await requireFeature("bills", "edit");
    const { id } = await params;
    applicationId = id;

    const app = await prisma.vendorCreditApplication.findUnique({
      where: { id },
      select: {
        id: true,
        source: true,
        amount: true,
        vendorCreditId: true,
        billId: true,
        vendorCredit: { select: { creditNoteNo: true } },
        bill: { select: { billNo: true } },
      },
    });
    if (!app) {
      log.warn("remove refused", { applicationId: id, reason: "not found" });
      return errorResponse("This application was already removed. Reload.", 404);
    }
    if (app.source !== "APP") {
      log.warn("remove refused", { applicationId: id, vendorCreditId: app.vendorCreditId, billId: app.billId, reason: "applied in Zoho" });
      return errorResponse("Applied in Zoho — remove it there, then fetch credit notes.", 409);
    }

    const amount = round2(Number(app.amount));
    const amt = amount.toFixed(2);
    const creditNo = app.vendorCredit?.creditNoteNo ?? "(removed credit)";
    const billNo = app.bill?.billNo ?? null;

    const result = await prisma.$transaction(async (tx) => {
      // 1. The application row is the guard: whoever deletes it first wins.
      const gone = await tx.vendorCreditApplication.deleteMany({ where: { id, source: "APP" } });
      if (gone.count !== 1) throw new RemoveRefusal("Someone removed this application a moment ago. Reload.");

      // 2. The credit gets the amount back.
      let credit: { amount: number; usedAmount: number } | null = null;
      if (app.vendorCreditId) {
        const rows = await tx.$queryRaw<Array<{ amount: number; usedAmount: number }>>`
          UPDATE "VendorCredit"
             SET "usedAmount" = round("usedAmount"::numeric - ${amt}::numeric, 2),
                 "updatedAt" = now()
           WHERE id = ${app.vendorCreditId}
             AND "usedAmount" + 0.01 >= ${amt}::numeric
          RETURNING amount, "usedAmount"`;
        if (rows.length === 0) {
          // usedAmount always includes every APP application (the credit sync adds Σ APP back
          // in), so this means the row was changed by hand. Refuse rather than go negative.
          throw new RemoveRefusal(`Credit ${creditNo} no longer shows ${inr(amount)} as used. Reload, and fetch credit notes if it persists.`);
        }
        credit = rows[0];
      }

      // 3. The bill reopens by exactly the amount. DISPUTED stays (a person's flag); a hand-set
      // OVERDUE stays while money is owed; otherwise the status follows what is left.
      let bill: { amount: number; paidAmount: number; status: string } | null = null;
      if (app.billId) {
        const rows = await tx.$queryRaw<Array<{ amount: number; paidAmount: number; status: string }>>`
          UPDATE "VendorBill"
             SET "paidAmount" = round("paidAmount"::numeric - ${amt}::numeric, 2),
                 "creditAppliedAmount" = "creditAppliedAmount" - ${amt}::numeric,
                 status = (CASE
                             WHEN status = 'DISPUTED'::"BillStatus" THEN 'DISPUTED'
                             WHEN "paidAmount" - ${amt}::numeric >= amount - 0.01 THEN 'PAID'
                             WHEN status = 'OVERDUE'::"BillStatus" THEN 'OVERDUE'
                             WHEN "paidAmount" - ${amt}::numeric > 0.01 THEN 'PARTIALLY_PAID'
                             ELSE 'PENDING'
                           END)::"BillStatus",
                 "updatedAt" = now()
           WHERE id = ${app.billId}
             AND "creditAppliedAmount" + 0.005 >= ${amt}::numeric
             AND "paidAmount" + 0.01 >= ${amt}::numeric
          RETURNING amount, "paidAmount", status::text AS status`;
        if (rows.length === 0) {
          throw new RemoveRefusal(`Bill ${billNo} no longer carries ${inr(amount)} of credit. Reload, and fetch credit notes if it persists.`);
        }
        bill = rows[0];
      }

      await logActivity(tx, {
        module: "bills",
        action: "credit_application_removed",
        entityType: app.billId ? "VendorBill" : "VendorCreditApplication",
        entityId: app.billId ?? id,
        entityRef: billNo,
        fromValue: amt,
        details: `Credit ${creditNo} · ${inr(amount)} removed · application ${id}`,
        userId: user.id,
        userName: user.name,
      });

      return { credit, bill };
    });

    log.info("credit application removed", {
      applicationId: id,
      vendorCreditId: app.vendorCreditId,
      billId: app.billId,
      amount,
      userId: user.id,
    });
    return successResponse({
      removed: true,
      amount,
      credit: result.credit && app.vendorCreditId
        ? { id: app.vendorCreditId, open: round2(result.credit.amount - result.credit.usedAmount) }
        : null,
      bill: result.bill && app.billId
        ? { id: app.billId, remaining: round2(result.bill.amount - result.bill.paidAmount), status: result.bill.status }
        : null,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof RemoveRefusal) {
      log.warn("remove refused", { applicationId, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    log.error("remove failed", { applicationId, message: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not remove the application. Nothing was changed — try again.", 500);
  }
}
