export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { assessCoverage } from "@/lib/brand-ledger/reconcile";

// GET — every vendor that has ledger activity, with both sides of the balance side by side.
//
// "Their balance" is the sum of their own statement rows; "our balance" is derived from our
// books. Showing them together is the entire point — a vendor whose two numbers agree needs
// no attention, and the ones that disagree are the work.
export async function GET() {
  try {
    await requireFeature("brand_ledger", "view");

    const vendors = await prisma.vendor.findMany({
      where: {
        OR: [
          { ledgerEntries: { some: {} } },
          { statements: { some: {} } },
          { ledgerGaps: { some: {} } },
        ],
      },
      select: {
        id: true,
        name: true,
        code: true,
        gstin: true,
        openingBalance: true,
        brands: { select: { brand: { select: { id: true, name: true } }, isPrimary: true } },
        statements: {
          orderBy: { statementDate: "desc" },
          take: 1,
          select: {
            id: true,
            statementDate: true,
            claimedClosing: true,
            computedClosing: true,
            tiesOut: true,
          },
        },
        _count: { select: { ledgerEntries: true, bills: true, payments: true, credits: true } },
      },
      orderBy: { name: "asc" },
    });

    // Open-claim value per vendor, in one grouped query rather than N.
    const gapAgg = await prisma.ledgerGap.groupBy({
      by: ["vendorId"],
      where: { status: { in: ["OPEN", "PROMISED", "VERIFY"] } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const gapsByVendor = new Map(gapAgg.map((g) => [g.vendorId, g]));

    const rows = vendors.map((v) => {
      const gap = gapsByVendor.get(v.id);
      const ourRecordCount = v._count.bills + v._count.payments + v._count.credits;
      const latest = v.statements[0] ?? null;

      return {
        id: v.id,
        name: v.name,
        code: v.code,
        gstin: v.gstin,
        brands: v.brands.map((b) => ({ ...b.brand, isPrimary: b.isPrimary })),
        entryCount: v._count.ledgerEntries,
        latestStatement: latest,
        openClaims: gap?._count._all ?? 0,
        openClaimValue: gap?._sum.amount ?? 0,
        coverage: assessCoverage(ourRecordCount, v._count.ledgerEntries),
      };
    });

    return successResponse({ vendors: rows });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
