export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { ledgerProfileWriteSchema } from "@/lib/validations";
import { defaultLedgerCode } from "@/lib/brand-ledger/view";

const log = createLogger("ledger:profile");

// PUT — the ledger app's two header writes: "Update balances" (App.jsx:860-866, both objects
// replaced wholesale) and the "✓ Reviewed" button (App.jsx:237, lastReviewed = today).
//
// The profile row is created on first write, so a vendor that never went through the JSON
// import can still carry balances. `code` then defaults from the vendor code (Q8).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("brand_ledger", "edit");
    const { id } = await params;
    const data = ledgerProfileWriteSchema.parse(await req.json());

    const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true, code: true } });
    if (!vendor) return errorResponse("Vendor not found", 404);

    const patch = {
      ...(data.theirBal
        ? { theirBalAmount: data.theirBal.amount, theirBalLabel: data.theirBal.label }
        : {}),
      ...(data.ourBal ? { ourBalAmount: data.ourBal.amount, ourBalLabel: data.ourBal.label } : {}),
      ...(data.reviewed ? { lastReviewed: new Date() } : {}),
    };

    const profile = await prisma.vendorLedgerProfile.upsert({
      where: { vendorId: id },
      update: patch,
      create: { vendorId: id, code: defaultLedgerCode(vendor.code), ...patch },
      select: {
        vendorId: true,
        theirBalAmount: true,
        theirBalLabel: true,
        ourBalAmount: true,
        ourBalLabel: true,
        lastReviewed: true,
      },
    });

    log.info("profile updated", {
      vendorId: id,
      balances: Boolean(data.theirBal || data.ourBal),
      reviewed: Boolean(data.reviewed),
    });
    return successResponse(profile);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:profile", status: 400 });
  }
}
