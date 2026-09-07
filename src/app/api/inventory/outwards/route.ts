export const dynamic = "force-dynamic";

export const runtime = "nodejs";
// nodejs, explicitly: this route reaches SMTP (a raw socket on 587) and the FCM JWT signer
// (node crypto) through notify(). Neither works on the edge runtime, and the failure there
// is not self-explanatory. Node is the default today; this stops a later change from
// silently breaking sends. See the notifications plan, Part C and D.1.
import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { outwardSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { maybeNotifyBelowReorder, type ReorderCrossing } from "@/lib/notify/stock";
import { deductFromStore } from "@/lib/stock-location";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("deliveries", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const where = {
      type: "OUTWARD" as const,
      ...((dateFrom || dateTo) && {
        createdAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo) }),
        },
      }),
    };

    const [transactions, total] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where,
        include: {
          product: { select: { name: true, sku: true, size: true, brand: { select: { name: true } } } },
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.inventoryTransaction.count({ where }),
    ]);

    return paginatedResponse(transactions, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch outwards", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("deliveries", "create");
    const body = await req.json();
    const data = outwardSchema.parse(body);

    // §F.0: filled INSIDE the transaction, sent AFTER it commits. notify() does SMTP/FCM I/O
    // that would blow the transaction's 5-second budget and roll the stock write back.
    const crossings: ReorderCrossing[] = [];

    const result = await prisma.$transaction(async (tx) => {
      // Read product inside transaction to prevent race conditions
      const product = await tx.product.findUnique({
        where: { id: data.productId },
      });

      if (!product) throw new Error("Product not found");

      const available = product.currentStock - product.reservedStock;
      if (available < data.quantity) {
        throw new Error(`Insufficient available stock. Physical: ${product.currentStock}, Reserved: ${product.reservedStock}, Available: ${available}, Requested: ${data.quantity}`);
      }

      const previousStock = product.currentStock;
      const newStock = previousStock - data.quantity;

      // WHICH STORE this leaves (R12). This route has never had a location field of any
      // kind, so an unspecified store means the primary one: active, lowest sortOrder — the
      // same ordering every picker uses.
      const storeId =
        data.storeId ??
        (
          await tx.store.findFirst({
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: { id: true },
          })
        )?.id;
      if (!storeId) throw new Error("No active store is configured to take stock out of.");

      // THE FIX (R12). Was `tx.product.update({ data: { currentStock: newStock } })`, which
      // moved the cache and left StockLevel alone — so the next receipt, applied audit or
      // transfer recomputed the total from a ledger that never saw this outward and put the
      // units back.
      await deductFromStore(tx, data.productId, storeId, data.quantity, product.name);
      crossings.push({ productId: data.productId, previousStock, newStock }); // collect only (§F.0)

      // Build notes with bin info
      const binNote = body.binId ? `[Bin: ${body.binId}]` : "";
      const combinedNotes = [binNote, data.notes].filter(Boolean).join(" ");

      // Create transaction record
      const transaction = await tx.inventoryTransaction.create({
        data: {
          type: "OUTWARD",
          productId: data.productId,
          quantity: data.quantity,
          previousStock,
          newStock,
          referenceNo: data.referenceNo,
          notes: combinedNotes || undefined,
          userId: user.id,
        },
        include: {
          product: { select: { name: true, sku: true } },
        },
      });

      // Update serial items if specific serials selected
      if (body.serialCodes && body.serialCodes.length > 0) {
        await tx.serialItem.updateMany({
          where: {
            serialCode: { in: body.serialCodes },
            productId: data.productId,
            status: "IN_STOCK",
          },
          data: {
            status: "SOLD",
            soldAt: new Date(),
            customerName: body.customerName || null,
            saleInvoiceNo: data.referenceNo || null,
          },
        });
      }

      return transaction;
    });

    // §F.0: the transaction has committed. after() runs this once the response has gone out, so
    // the sale is not slowed by SMTP/FCM, and nothing is sent if the transaction threw above.
    after(() => maybeNotifyBelowReorder(crossings));

    return successResponse(result, 201);
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(error instanceof Error ? error.message : "Failed to record outward", 400);
  }
}
