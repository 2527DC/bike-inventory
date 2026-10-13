export const dynamic = "force-dynamic";

// PUT /api/vendor-credits/[id] { storeId } — the one local field on a pulled credit note (plan
// 1210 credit notes, Part 2.2, third source: "set by hand on the Credits tab", bills.edit).
//
// Every financial field on a credit comes from Zoho and is overwritten by the next fetch
// (integration-architect principle 4); the store is local and is never overwritten by a fetch
// once set. A credit already applied to a bill of another store cannot be moved to this one —
// a credit applies only to its own store's bills (Part 4).
import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { vendorCreditUpdateSchema } from "@/lib/validations";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("payables:credits");

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let creditId: string | null = null;
  try {
    const user = await requireFeature("bills", "edit");
    const { id } = await params;
    creditId = id;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      log.warn("credit store refused", { vendorCreditId: id, reason: "body is not JSON" });
      return errorResponse("Send the store to set.", 400);
    }
    const data = vendorCreditUpdateSchema.parse(body);

    const credit = await prisma.vendorCredit.findUnique({
      where: { id },
      select: {
        id: true,
        creditNoteNo: true,
        storeId: true,
        store: { select: { name: true } },
        applications: {
          where: { bill: { storeId: { not: null } } },
          select: { bill: { select: { billNo: true, storeId: true, store: { select: { name: true } } } } },
        },
      },
    });
    if (!credit) {
      log.warn("credit store refused", { vendorCreditId: id, reason: "credit not found" });
      return errorResponse("Credit note not found. Reload.", 404);
    }

    let storeName: string | null = null;
    if (data.storeId) {
      const store = await prisma.store.findUnique({ where: { id: data.storeId }, select: { id: true, name: true, isActive: true } });
      if (!store || !store.isActive) {
        log.warn("credit store refused", { vendorCreditId: id, storeId: data.storeId, reason: "store not found or inactive" });
        return errorResponse("That store does not exist or is switched off. Reload.", 400);
      }
      storeName = store.name;
      const clash = credit.applications.find((a) => a.bill?.storeId && a.bill.storeId !== data.storeId);
      if (clash?.bill) {
        log.warn("credit store refused", { vendorCreditId: id, storeId: data.storeId, reason: "applied to another store's bill" });
        return errorResponse(
          `${credit.creditNoteNo} is applied to bill ${clash.bill.billNo}, which is ${clash.bill.store?.name}'s. A credit and the bills it is applied to share one store.`,
          400
        );
      }
    }

    if ((credit.storeId ?? null) === (data.storeId ?? null)) {
      return successResponse({ id, storeId: credit.storeId, store: credit.store, changed: false });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.vendorCredit.update({
        where: { id },
        data: { storeId: data.storeId },
        select: { id: true, storeId: true, store: { select: { id: true, code: true, name: true } } },
      });
      await logActivity(tx, {
        module: "bills",
        action: "credit_store_set",
        entityType: "VendorCredit",
        entityId: id,
        entityRef: credit.creditNoteNo,
        fromValue: credit.store?.name ?? null,
        toValue: storeName,
        userId: user.id,
        userName: user.name,
      });
      return row;
    });

    log.info("credit store set", { vendorCreditId: id, storeId: data.storeId, previousStoreId: credit.storeId, userId: user.id });
    return successResponse({ ...updated, changed: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid store";
      log.warn("credit store refused", { vendorCreditId: creditId, reason: message });
      return errorResponse(message, 400);
    }
    log.error("credit store update failed", { vendorCreditId: creditId, message: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not set the credit note's store. Try again.", 500);
  }
}
