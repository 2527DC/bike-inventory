export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { purchaseOrderSchema, purchaseOrderListQuerySchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createPurchaseOrder, PoCreateError } from "@/lib/purchase-orders/create";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders");

export async function GET(req: NextRequest) {
  try {
    await requireFeature("purchase_orders", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    // Validated rather than cast. This was `status as never`, which handed an arbitrary query
    // string straight to Prisma — `?status=nonsense` reached the database as an enum value.
    const parsedQuery = purchaseOrderListQuerySchema.safeParse({
      status: searchParams.get("status") || undefined,
    });
    if (!parsedQuery.success) {
      return errorResponse("Unknown purchase order status filter", 400);
    }
    const status = parsedQuery.data.status;
    const vendorId = searchParams.get("vendorId") || undefined;

    const search = searchParams.get("search") || undefined;
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;

    const where = {
      ...(status && { status }),
      ...(vendorId && { vendorId }),
      ...(search && {
        OR: [
          { poNumber: { contains: search, mode: "insensitive" as const } },
          { vendor: { name: { contains: search, mode: "insensitive" as const } } },
        ],
      }),
      ...((dateFrom || dateTo) && {
        orderDate: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo + "T23:59:59.999Z") }),
        },
      }),
    };

    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          vendor: { select: { name: true, code: true } },
          items: { include: { product: { select: { name: true, sku: true } } } },
          createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    return paginatedResponse(orders, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch purchase orders", 500);
  }
}

/**
 * Create a purchase order from the /purchase-orders/new screen.
 *
 * The whole write lives in `createPurchaseOrder` — the advisory lock, the duplicate check,
 * the number allocation, the insert and the activity row — because the brand-stock sheet
 * creates POs too and two independent creators is what P9 exists to end. See that file for
 * why the lock is transaction-scoped.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("purchase_orders", "create");
    const data = purchaseOrderSchema.parse(await req.json());

    // "reject": on this screen a blank rate is a typo somebody can fix in the field they are
    // looking at. The brand-stock caller passes "skip" instead.
    const { po } = await createPurchaseOrder(data, user, {
      onPricelessLine: "reject",
      // ON here, OFF for the brand-stock caller. On this screen the vendor was chosen
      // deliberately, so a product resolving to a different vendor means the wrong one was
      // picked — and P10 makes the vendor read-only precisely so that cannot happen silently.
      verifyVendorSupplies: true,
    });

    return successResponse(po, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof PoCreateError) {
      // The 409 carries `{ conflicts }` so the screen can name the PO and offer to drop the
      // clashing lines, rather than printing one red sentence.
      return errorResponse(error.message, error.status, error.data);
    }
    const message = error instanceof Error ? error.message : "Failed to create purchase order";
    log.error("purchase order create failed", { message });
    return errorResponse(message, 400);
  }
}
