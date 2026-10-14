export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { logActivity } from "@/lib/activity-log";
import { adjustWarehouseQty } from "@/lib/stock-location";
import { createUnits } from "@/lib/units/create";
import { LIVE_UNIT_STATUSES } from "@/lib/units/constants";
import { resolveAddStockBin } from "@/lib/stock/add-stock-bin";
import { quickAddStockSchema } from "@/lib/validations";

// ─── Quick add to stock from /stock (plan 1410-stock-quick-add) ──────────────────────────
//
// The owner's ask (14 Oct 2026): add stock to a product directly, without a stock audit —
// "GT lock has 599, add 5". Guarded by its own permission (Q1), recorded as an ADJUSTMENT with
// a required reason (Q4), and placed in a bin, which decides the warehouse.
//
//   - A product that already has unit codes gets one code per item, split assembled / not
//     assembled by number (Q3). Not-assembled units appear in the assembly queue by query.
//   - A product with NO unit codes anywhere gets the quantity without codes (Q2): coding only
//     the new items would make its bin count those alone (units are the truth for a tracked
//     product — src/lib/units/bin-stock.ts), so its 599 would read 5.
//   - A non-assemblable bin asks no assembled question (R4): the units are stamped by the bin.
//
// Stock changes only through adjustWarehouseQty (StockLevel is the truth; currentStock its
// cache — writing the cache directly was the R12 bug). Never an ApprovalEvent (a CORRECTED
// event counts against the last inbound approver), never an AssemblyLog (it feeds mechanic pay).

const log = createLogger("stock:quick-add");

/** Thrown inside the transaction to roll it back; the route answers with its status. */
class QuickAddRefused extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "QuickAddRefused";
  }
}

const MODULE = "inventory_adjustments";

/** Does the product have unit records anywhere? The same test syncBinStock uses for "tracked". */
async function isUnitTracked(db: Pick<typeof prisma, "inventoryUnit">, productId: string): Promise<boolean> {
  const unit = await db.inventoryUnit.findFirst({ where: { productId }, select: { id: true } });
  return unit !== null;
}

// GET — what the add sheet needs: the product, whether it is unit-tracked, and THE bin it goes
// into — one bin, shown read-only (owner, 14 Oct 2026). `bin` is null when the product has none,
// and `noBinReason` then says why Add stock cannot happen. Served here so adding stock does not
// also need Bins › View.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature(MODULE, "create");
    const { id } = await params;

    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true, name: true, sku: true, currentStock: true, binId: true, status: true,
        brandId: true, categoryId: true,
      },
    });
    if (!product) return errorResponse("Product not found", 404);

    const [tracked, liveUnits, placement] = await Promise.all([
      isUnitTracked(prisma, id),
      prisma.inventoryUnit.count({
        where: { productId: id, status: { in: LIVE_UNIT_STATUSES } },
      }),
      resolveAddStockBin(prisma, product),
    ]);
    if (!placement.ok) log.info("add-stock context: product has no usable bin", { productId: id, homeBinId: product.binId });

    return successResponse({
      product: {
        id: product.id, name: product.name, sku: product.sku, currentStock: product.currentStock,
        binId: product.binId, status: product.status,
      },
      tracked,
      withoutCodes: Math.max(0, product.currentStock - liveUnits),
      bin: placement.ok ? placement.bin : null,
      binSource: placement.ok ? placement.source : null,
      binRule: placement.ok ? placement.rule : null,
      noBinReason: placement.ok ? null : placement.reason,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "stock:quick-add", step: "context" });
  }
}

// POST { binId, assembled, unassembled, reason, requestId } — add the stock.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let step = "auth";
  const { id: productId } = await params;
  try {
    const user = await requireFeature(MODULE, "create");

    step = "parse";
    const body = await req.json().catch((e: unknown) => {
      log.warn("add-stock body is not JSON", { productId, reason: e instanceof Error ? e.message : String(e) });
      return null;
    });
    const input = quickAddStockSchema.parse(body ?? {});
    const qty = input.assembled + input.unassembled;

    step = "check";
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, sku: true, status: true, binId: true, brandId: true, categoryId: true },
    });
    if (!product) return errorResponse("Product not found", 404);
    if (product.status !== "ACTIVE") return errorResponse(`${product.name} is not active — restore it before adding stock`, 400);

    // THE product's bin, decided here and nowhere else (owner, 14 Oct 2026): the rule's bin in
    // its warehouse, else its home bin. No bin → no Add stock. The body's binId is only the bin
    // the sheet showed — any other is refused, so a stale sheet cannot put stock elsewhere.
    const placement = await resolveAddStockBin(prisma, product);
    if (!placement.ok) {
      log.warn("add-stock refused: no bin", { productId, homeBinId: product.binId });
      return errorResponse(placement.reason, 409);
    }
    const bin = {
      id: placement.bin.id,
      code: placement.bin.code,
      nonAssemblable: placement.bin.nonAssemblable,
      warehouse: { id: placement.bin.warehouseId, name: placement.bin.warehouseName },
    };
    if (input.binId !== bin.id) {
      log.warn("add-stock refused: not the product's bin", { productId, sentBinId: input.binId, binId: bin.id, source: placement.source });
      return errorResponse(`${product.name} goes into bin ${bin.code} (${bin.warehouse.name}) — reload and add again`, 409);
    }
    if (bin.nonAssemblable && input.assembled > 0) {
      return errorResponse(`Bin ${bin.code} holds items that are never assembled — add them without the assembled figure`, 400);
    }

    step = "write";
    const referenceNo = `QA-${input.requestId}`;
    const result = await prisma.$transaction(
      async (tx) => {
        // ── Lock, then dedupe ──
        // adjustWarehouseQty reads and writes an absolute value, so two adds at once could lose
        // one. Locking this product's row for this warehouse makes the second wait for the
        // first; the reference then turns a double tap into a no-op.
        await tx.stockLevel.upsert({
          where: { productId_warehouseId: { productId, warehouseId: bin.warehouse.id } },
          update: {},
          create: { productId, warehouseId: bin.warehouse.id, quantity: 0 },
        });
        await tx.$queryRaw`SELECT id FROM "StockLevel" WHERE "productId" = ${productId} AND "warehouseId" = ${bin.warehouse.id} FOR UPDATE`;

        const already = await tx.inventoryTransaction.findFirst({
          where: { productId, referenceNo },
          select: { id: true, newStock: true, quantity: true },
        });
        if (already) return { duplicate: true as const, ledgerId: already.id, newStock: already.newStock, codes: 0 };

        const tracked = await isUnitTracked(tx, productId);
        if (!tracked && input.assembled > 0) {
          throw new QuickAddRefused(
            `${product.name} has no unit codes yet, so assembled and not assembled are not tracked for it — add the quantity only`,
            400
          );
        }

        const current = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { currentStock: true } });
        const previousStock = current.currentStock;
        const newStock = await adjustWarehouseQty(tx, productId, bin.warehouse.id, qty);

        const split = bin.nonAssemblable
          ? "no assembly"
          : tracked
            ? `${input.assembled} assembled, ${input.unassembled} not assembled`
            : "no unit codes yet";
        const ledger = await tx.inventoryTransaction.create({
          data: {
            type: "ADJUSTMENT",
            productId,
            quantity: qty,
            previousStock,
            newStock,
            referenceNo,
            // [QUICK_ADD] is this path's own tag; no existing tag is reused (plan 1410 §2).
            notes: `[QUICK_ADD] +${qty} to ${bin.warehouse.name} / bin ${bin.code} (${split}) — ${input.reason}`.slice(0, 1000),
            userId: user.id,
          },
          select: { id: true },
        });

        let codes = 0;
        if (tracked) {
          // One code per item (src/lib/units/create.ts), in the bin; a non-assemblable bin stamps
          // them. sourceTransactionId ties them to this row, so an undo can retire exactly these.
          if (input.assembled > 0) {
            const ids = await createUnits(tx, {
              productId, warehouseId: bin.warehouse.id, qty: input.assembled, assembled: true, binId: bin.id, sourceTransactionId: ledger.id,
            });
            codes += ids.length;
          }
          if (input.unassembled > 0) {
            const ids = await createUnits(tx, {
              productId, warehouseId: bin.warehouse.id, qty: input.unassembled, assembled: false, binId: bin.id, sourceTransactionId: ledger.id,
            });
            codes += ids.length;
          }
        } else {
          // Untracked product (Q2): the bin keeps its typed-in count, plus this add.
          await tx.binStock.upsert({
            where: { binId_productId: { binId: bin.id, productId } },
            update: { quantity: { increment: qty } },
            create: { binId: bin.id, productId, quantity: qty },
          });
        }

        await tx.binMovementLog.create({
          data: {
            warehouseId: bin.warehouse.id,
            productId,
            quantity: qty,
            fromBinId: null,
            toBinId: bin.id,
            reason: `Quick add — ${input.reason}`.slice(0, 500),
            movedById: user.id,
          },
        });
        // A product with no home bin takes this one (the stock-audit rule, assign-product-bin.ts).
        if (!product.binId) await tx.product.update({ where: { id: productId }, data: { binId: bin.id } });

        await logActivity(tx, {
          module: MODULE,
          action: "stock_added",
          entityType: "Product",
          entityId: productId,
          entityRef: product.sku ?? product.name,
          fromValue: String(previousStock),
          toValue: String(newStock),
          details: `${product.name} +${qty} → ${bin.warehouse.name} / ${bin.code} (${split}) — ${input.reason}`.slice(0, 1000),
          userId: user.id,
          userName: user.name,
        });

        return { duplicate: false as const, ledgerId: ledger.id, newStock, codes, tracked };
      },
      { timeout: 30_000 }
    );

    if (result.duplicate) {
      log.info("add-stock repeated request — nothing added again", { productId, referenceNo, ledgerId: result.ledgerId });
    } else {
      log.info("stock added", {
        productId, warehouseId: bin.warehouse.id, binId: bin.id, qty, codes: result.codes, tracked: result.tracked, userId: user.id,
      });
    }
    return successResponse(
      { productId, added: result.duplicate ? 0 : qty, newStock: result.newStock, codes: result.codes, duplicate: result.duplicate, binCode: bin.code, warehouseName: bin.warehouse.name },
      result.duplicate ? 200 : 201
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof ZodError) {
      log.warn("add-stock refused: invalid body", { productId, issue: error.issues[0]?.message });
      return errorResponse(error.issues[0]?.message ?? "Check the quantity and the reason", 400);
    }
    if (error instanceof QuickAddRefused) {
      log.warn("add-stock refused", { productId, reason: error.message });
      return errorResponse(error.message, error.status);
    }
    return failure(error, { scope: "stock:quick-add", step, productId });
  }
}
