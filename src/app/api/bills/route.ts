export const dynamic = "force-dynamic";

// GET  /api/bills — the vendor bill list (/bills, /payments/new, /vendor-issues/new, reconcile).
// POST /api/bills — a bill typed by hand.
//
// Plan 1210 credit notes and payables:
//   - `storeId=<id>|none` replaces `billedTo`, which nothing ever wrote (§2.5, X3). Each row
//     carries its store.
//   - `aging=` takes the four keys of the aging cards — notDue, pastDue1to30, pastDue31to45,
//     pastDueOver45 — by days past the STORED due date in IST (Q5 = a, F6). The ranges come
//     from src/lib/payables/cash-discount.ts, as the card counts do.
//   - Unpaid includes OVERDUE (X10), for `aging=` and `overdue=true` alike.
//   - POST refuses a duplicate bill number per supplier, not across every supplier (X2) — the
//     database's own rule is @@unique([vendorId, billNo]).

import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma, type BillStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { vendorBillSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import {
  AGING_BUCKETS,
  DAY_MS,
  agingDueDateRange,
  istDayStart,
  todayIstDayNumber,
} from "@/lib/payables/cash-discount";

const log = createLogger("api:bills");

const UNPAID: BillStatus[] = ["PENDING", "PARTIALLY_PAID", "OVERDUE"];

const listQuerySchema = z.object({
  status: z
    .enum(["PENDING", "PARTIALLY_PAID", "PAID", "OVERDUE", "DISPUTED"], { error: "Unknown bill status" })
    .optional(),
  vendorId: z.string().trim().min(1).max(64).optional(),
  storeId: z.string().trim().min(1).max(64).optional(),
  aging: z.enum(AGING_BUCKETS, { error: "Unknown aging bucket" }).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateFrom must be YYYY-MM-DD").optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateTo must be YYYY-MM-DD").optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireFeature("bills", "view");
    const { page, limit, skip, search, searchParams } = parseSearchParams(req.url);

    const parsed = listQuerySchema.safeParse({
      status: searchParams.get("status") || undefined,
      vendorId: searchParams.get("vendorId") || undefined,
      storeId: searchParams.get("storeId") || undefined,
      aging: searchParams.get("aging") || undefined,
      dateFrom: searchParams.get("dateFrom") || undefined,
      dateTo: searchParams.get("dateTo") || undefined,
    });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid bill filter";
      log.warn("bill list query refused", { message });
      return errorResponse(message, 400);
    }
    const { status, vendorId, storeId, aging, dateFrom, dateTo } = parsed.data;
    const overdue = searchParams.get("overdue") === "true";

    // Open = unpaid status AND money left. The column comparison drops fully settled rows.
    const open: Prisma.VendorBillWhereInput = {
      status: { in: UNPAID },
      paidAmount: { lt: prisma.vendorBill.fields.amount },
    };

    const where: Prisma.VendorBillWhereInput = {
      ...(search && {
        OR: [
          { billNo: { contains: search, mode: "insensitive" as const } },
          { vendor: { name: { contains: search, mode: "insensitive" as const } } },
        ],
      }),
      ...(status && { status }),
      ...(vendorId && { vendorId }),
      ...(storeId === "none" ? { storeId: null } : storeId ? { storeId } : {}),
      // Past the stored due date by at least one IST day.
      ...(overdue && { ...open, dueDate: { lt: istDayStart(todayIstDayNumber()) } }),
      // An aging card: the same ranges the card counts with.
      ...(aging && { ...open, dueDate: agingDueDateRange(aging) }),
      ...((dateFrom || dateTo) && {
        billDate: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo + "T23:59:59.999Z") }),
        },
      }),
    };

    const [bills, total] = await Promise.all([
      prisma.vendorBill.findMany({
        where,
        select: {
          id: true, billNo: true, amount: true, paidAmount: true,
          status: true, dueDate: true, billDate: true, createdAt: true,
          vendorId: true,
          storeId: true,
          vendor: { select: { name: true, code: true, paymentTermDays: true } },
          store: { select: { id: true, name: true, code: true } },
          _count: { select: { payments: true } },
        },
        orderBy: { dueDate: "asc" },
        skip,
        take: limit,
      }),
      prisma.vendorBill.count({ where }),
    ]);

    log.debug("bills listed", { rows: bills.length, total, storeId, aging, status });
    return paginatedResponse(bills, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("bill list failed", { error: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not load bills. Try again.", 500);
  }
}

export async function POST(req: NextRequest) {
  let vendorId: string | undefined;
  try {
    await requireFeature("bills", "create");
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      log.warn("bill refused: body is not JSON");
      return errorResponse("Invalid request body", 400);
    }
    const parsed = vendorBillSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid bill";
      log.warn("bill refused", { message });
      return errorResponse(message, 400);
    }
    const data = parsed.data;
    vendorId = data.vendorId;

    const vendor = await prisma.vendor.findUnique({
      where: { id: data.vendorId },
      select: { name: true, paymentTermDays: true },
    });
    if (!vendor) {
      log.warn("bill refused: vendor not found", { vendorId });
      return errorResponse("Vendor not found", 400);
    }

    // Duplicate check — per supplier (X2). Two suppliers may both number a bill "1024".
    const duplicateMessage = `Bill ${data.billNo} is already recorded for ${vendor.name}`;
    const existing = await prisma.vendorBill.findUnique({
      where: { vendorId_billNo: { vendorId: data.vendorId, billNo: data.billNo } },
      select: { id: true },
    });
    if (existing) {
      log.warn("bill refused: duplicate", { vendorId, existingBillId: existing.id });
      return errorResponse(duplicateMessage, 409);
    }

    // Due date: as given, else bill date + the vendor's payment terms. Whole days added to the
    // date-only value, so the result stays on a calendar day whatever the server's time zone.
    const billDate = new Date(data.billDate);
    const dueDate = data.dueDate
      ? new Date(data.dueDate)
      : new Date(billDate.getTime() + (vendor.paymentTermDays || 30) * DAY_MS);

    let bill;
    try {
      bill = await prisma.vendorBill.create({
        data: {
          vendorId: data.vendorId,
          purchaseOrderId: data.purchaseOrderId || null,
          billNo: data.billNo,
          billDate,
          dueDate,
          amount: data.amount,
          notes: data.notes,
        },
        include: { vendor: { select: { name: true } } },
      });
    } catch (e) {
      // Two people saving the same bill at once: the second loses on the unique index.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        log.warn("bill refused: duplicate (concurrent)", { vendorId });
        return errorResponse(duplicateMessage, 409);
      }
      throw e;
    }

    log.info("bill created", { billId: bill.id, vendorId });
    return successResponse(bill, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("bill create failed", { vendorId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not save the bill. Try again.", 500);
  }
}
