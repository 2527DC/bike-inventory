export const dynamic = "force-dynamic";

// One vendor bill (plan 1210 credit notes: Part 2.4, Part 4, Part 6.1, Q5).
//
// GET returns, beside the bill:
//   vendorBalance   what we owe this supplier now, from `vendorBalance()` — the one formula the
//                   ledger and the vendor page also use (§2.4: there used to be three)
//   creditApplications  every credit note applied to this bill, marked "here" (APP) or "in Zoho"
//   openCredits     the vendor's credits that could still be applied to THIS bill: OPEN, money
//                   left, and the same store or a store not known on either side. Under
//                   bills.view so /bills/[id] can offer Apply credit without vendors.view.
//
// PUT takes { status?, notes?, storeId? } through zod. Setting the store also stamps it on this
// bill's payments that were recorded without one (a payment belongs to its bill's store, Q9),
// and is refused when a payment or a credit on the bill already names another store.
import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { vendorBillUpdateSchema } from "@/lib/validations";
import { vendorBalance } from "@/lib/payables/ledger";
import { createLogger } from "@/lib/logger";

const log = createLogger("bills:detail");

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let billId: string | null = null;
  try {
    await requireFeature("bills", "view");
    const { id } = await params;
    billId = id;
    const bill = await prisma.vendorBill.findUnique({
      where: { id },
      include: {
        vendor: {
          select: {
            id: true, name: true, code: true, phone: true, whatsappNumber: true,
            paymentTermDays: true, cdTermsDays: true, cdPercentage: true,
          },
        },
        store: { select: { id: true, code: true, name: true } },
        purchaseOrder: { include: { items: { include: { product: { select: { name: true, sku: true } } } } } },
        payments: {
          orderBy: { paymentDate: "desc" },
          include: { recordedBy: { select: { name: true } }, store: { select: { name: true } } },
        },
        creditApplications: {
          orderBy: [{ appliedDate: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            source: true,
            amount: true,
            appliedDate: true,
            note: true,
            appliedBy: { select: { name: true } },
            vendorCredit: { select: { id: true, creditNoteNo: true, referenceNo: true } },
          },
        },
      },
    });

    if (!bill) return errorResponse("Bill not found", 404);

    const [balance, credits] = await Promise.all([
      // The header figure. A ledger fault must not take the whole bill down with it.
      vendorBalance(bill.vendorId).catch((e: unknown) => {
        log.error("vendor balance failed", { billId: id, vendorId: bill.vendorId, message: e instanceof Error ? e.message : String(e) });
        return null;
      }),
      prisma.vendorCredit.findMany({
        where: {
          vendorId: bill.vendorId,
          status: "OPEN",
          ...(bill.storeId ? { OR: [{ storeId: null }, { storeId: bill.storeId }] } : {}),
        },
        orderBy: [{ creditDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true, creditNoteNo: true, referenceNo: true, creditDate: true, amount: true, usedAmount: true,
          storeId: true, store: { select: { name: true } },
        },
      }),
    ]);

    const openCredits = credits
      .map((c) => ({
        id: c.id,
        creditNoteNo: c.creditNoteNo,
        referenceNo: c.referenceNo,
        creditDate: c.creditDate,
        open: round2(c.amount - c.usedAmount),
        storeId: c.storeId,
        storeName: c.store?.name ?? null,
      }))
      .filter((c) => c.open > 0.01);

    const { creditApplications, creditAppliedAmount, ...rest } = bill;
    return successResponse({
      ...rest,
      creditAppliedAmount: round2(Number(creditAppliedAmount)),
      creditApplications: creditApplications.map((a) => ({
        id: a.id,
        source: a.source,
        amount: round2(Number(a.amount)),
        appliedDate: a.appliedDate,
        note: a.note,
        appliedBy: a.appliedBy?.name ?? null,
        credit: a.vendorCredit,
      })),
      openCredits,
      openCreditTotal: round2(openCredits.reduce((s, c) => s + c.open, 0)),
      vendorBalance: balance,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("bill fetch failed", { billId, message: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not load this bill. Try again.", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let billId: string | null = null;
  try {
    const user = await requireFeature("bills", "edit");
    const { id } = await params;
    billId = id;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      log.warn("bill update refused", { billId: id, reason: "body is not JSON" });
      return errorResponse("Send the fields to change.", 400);
    }
    const data = vendorBillUpdateSchema.parse(body);

    const existing = await prisma.vendorBill.findUnique({
      where: { id },
      select: { id: true, billNo: true, storeId: true },
    });
    if (!existing) return errorResponse("Bill not found", 404);

    const storeChanging = data.storeId !== undefined && (data.storeId ?? null) !== (existing.storeId ?? null);
    if (storeChanging && data.storeId) {
      const store = await prisma.store.findUnique({ where: { id: data.storeId }, select: { isActive: true } });
      if (!store || !store.isActive) {
        log.warn("bill update refused", { billId: id, storeId: data.storeId, reason: "store not found or inactive" });
        return errorResponse("That store does not exist or is switched off. Reload.", 400);
      }
      // A bill, its payments and the credits applied to it share one store.
      const [otherPayment, otherCredit] = await Promise.all([
        prisma.vendorPayment.findFirst({
          where: { billId: id, storeId: { not: null, notIn: [data.storeId] } },
          select: { store: { select: { name: true } } },
        }),
        prisma.vendorCreditApplication.findFirst({
          where: { billId: id, vendorCredit: { storeId: { not: null, notIn: [data.storeId] } } },
          select: { vendorCredit: { select: { creditNoteNo: true, store: { select: { name: true } } } } },
        }),
      ]);
      if (otherPayment) {
        log.warn("bill update refused", { billId: id, storeId: data.storeId, reason: "payment of another store" });
        return errorResponse(
          `A payment on bill ${existing.billNo} was recorded for ${otherPayment.store?.name}. A bill and its payments share one store.`,
          400
        );
      }
      if (otherCredit?.vendorCredit) {
        log.warn("bill update refused", { billId: id, storeId: data.storeId, reason: "credit of another store" });
        return errorResponse(
          `Credit ${otherCredit.vendorCredit.creditNoteNo} applied to this bill is ${otherCredit.vendorCredit.store?.name}'s. A bill and its credits share one store.`,
          400
        );
      }
    }

    const { bill, paymentsStamped } = await prisma.$transaction(async (tx) => {
      const bill = await tx.vendorBill.update({
        where: { id },
        data: {
          ...(data.status !== undefined && { status: data.status }),
          ...(data.notes !== undefined && { notes: data.notes }),
          ...(data.storeId !== undefined && { storeId: data.storeId }),
        },
        include: { vendor: { select: { name: true } }, store: { select: { id: true, code: true, name: true } } },
      });
      // Payments recorded while the bill had no store take its store now.
      const stamped = storeChanging && data.storeId
        ? await tx.vendorPayment.updateMany({ where: { billId: id, storeId: null }, data: { storeId: data.storeId } })
        : { count: 0 };
      return { bill, paymentsStamped: stamped.count };
    });

    log.info("bill updated", {
      billId: id,
      fields: Object.keys(data),
      ...(storeChanging ? { storeId: data.storeId ?? null, previousStoreId: existing.storeId, paymentsStamped } : {}),
      userId: user.id,
    });
    const { creditAppliedAmount, ...rest } = bill;
    return successResponse({ ...rest, creditAppliedAmount: round2(Number(creditAppliedAmount)) });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid bill details";
      log.warn("bill update refused", { billId, reason: message });
      return errorResponse(message, 400);
    }
    log.error("bill update failed", { billId, message: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not update the bill. Try again.", 500);
  }
}
