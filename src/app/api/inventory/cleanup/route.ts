export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { deductAnywhere, addAnywhere } from "@/lib/stock-location";
import { retireUnits, FINAL_UNIT_STATUSES } from "@/lib/units";
import { createLogger } from "@/lib/logger";

const log = createLogger("inventory:cleanup");

/** Ledger rows reversed per transaction — small enough to stay well inside the 60 s budget. */
const CHUNK = 100;

const VERIFIED_ZOHO = { notes: { contains: "[ZOHO][VERIFIED]" } };

// DELETE — remove all Zoho-imported transactions + optionally reverse stock
// Query param: ?reverse=true (default) reverses stock, ?reverse=false keeps stock
export async function DELETE(req: NextRequest) {
  try {
    await requireFeature("stock", "delete");

    const reverseStock = req.nextUrl.searchParams.get("reverse") !== "false";
    let stockReversals = 0;
    let unitsRetired = 0;

    if (reverseStock) {
      // ── REVERSE IN CHUNKS, EACH ITS OWN TRANSACTION (plan 1709, P4) ──
      //
      // This ran on the root client with no transaction: a failure half-way left some
      // reversals applied and the rest not, and a re-run reversed the first half again.
      //
      // Now each chunk of 100 ledger rows is one transaction that (1) reverses the stock,
      // (2) retires the units those inwards created as RESET — history kept, bins recounted —
      // and (3) DELETES the rows it reversed. Because the delete commits with the reversal, a
      // failure rolls back only its own chunk and a re-run picks up exactly where it stopped:
      // a row is never reversed twice.
      //
      // Reversing an INWARD takes units out; reversing an OUTWARD puts them back. Neither
      // records the warehouse it touched, so both go through the "anywhere" helpers — see
      // their notes in stock-location.ts.
      for (;;) {
        const chunk = await prisma.inventoryTransaction.findMany({
          where: VERIFIED_ZOHO,
          select: { id: true, productId: true, quantity: true, type: true },
          orderBy: { createdAt: "asc" },
          take: CHUNK,
        });
        if (chunk.length === 0) break;

        const done = await prisma.$transaction(
          async (tx) => {
            let retired = 0;
            for (const txn of chunk) {
              if (txn.type === "INWARD") {
                await deductAnywhere(tx, txn.productId, txn.quantity);
                const units = await tx.inventoryUnit.findMany({
                  where: { sourceTransactionId: txn.id, status: { notIn: FINAL_UNIT_STATUSES } },
                  select: { id: true },
                });
                retired += await retireUnits(tx, units.map((u) => u.id), "RESET");
              } else {
                await addAnywhere(tx, txn.productId, txn.quantity);
              }
            }
            await tx.inventoryTransaction.deleteMany({ where: { id: { in: chunk.map((t) => t.id) } } });
            return retired;
          },
          { timeout: 45_000 }
        );

        stockReversals += chunk.length;
        unitsRetired += done;
        log.info("cleanup chunk reversed", { rows: chunk.length, unitsRetired: done, totalReversed: stockReversals });
      }
    }

    // Delete all Zoho transactions
    const zohoTransactions = await prisma.inventoryTransaction.deleteMany({
      where: { notes: { contains: "[ZOHO]" } },
    });

    // Delete vendor bills
    const zohoBills = await prisma.vendorBill.deleteMany({
      where: { billNo: { not: "" } },
    });

    // Clean up pull previews and logs
    const previews = await prisma.zohoPullPreview.deleteMany({});
    const pullLogs = await prisma.zohoPullLog.deleteMany({});

    log.info("zoho cleanup finished", {
      reversed: reverseStock,
      stockReversals,
      unitsRetired,
      transactionsDeleted: zohoTransactions.count + stockReversals,
      vendorBills: zohoBills.count,
    });

    return successResponse({
      deleted: {
        // The reversed rows were deleted chunk by chunk, with their reversal.
        transactions: zohoTransactions.count + stockReversals,
        vendorBills: zohoBills.count,
        previews: previews.count,
        pullLogs: pullLogs.count,
      },
      stockReversals,
      unitsRetired,
      reversed: reverseStock,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("zoho cleanup failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Cleanup failed", 500);
  }
}

// GET — preview what would be deleted (dry run)
export async function GET() {
  try {
    await requireFeature("stock", "view");

    const zohoTransactions = await prisma.inventoryTransaction.count({
      where: { notes: { contains: "[ZOHO]" } },
    });

    const verifiedTransactions = await prisma.inventoryTransaction.count({
      where: VERIFIED_ZOHO,
    });

    // The units a reversing cleanup would retire, and the bins whose stock it would recount.
    const unitScope = {
      status: { notIn: FINAL_UNIT_STATUSES },
      sourceTransaction: { type: "INWARD" as const, ...VERIFIED_ZOHO },
    };
    const [unitsAffected, binRows] = await Promise.all([
      prisma.inventoryUnit.count({ where: unitScope }),
      prisma.inventoryUnit.findMany({
        where: { ...unitScope, binId: { not: null } },
        select: { binId: true },
        distinct: ["binId"],
      }),
    ]);

    const vendorBills = await prisma.vendorBill.count();
    const previews = await prisma.zohoPullPreview.count();

    return successResponse({
      wouldDelete: {
        transactions: zohoTransactions,
        verifiedTransactions,
        vendorBills,
        previews,
        unitsAffected,
        binsAffected: binRows.length,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("zoho cleanup preview failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Preview failed", 500);
  }
}
