export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { vendorBillSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import type { BillStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("bills", "view");
    const { page, limit, skip, search, searchParams } = parseSearchParams(req.url);
    const status = searchParams.get("status") || undefined;
    const vendorId = searchParams.get("vendorId") || undefined;
    const overdue = searchParams.get("overdue") === "true";
    const aging = searchParams.get("aging") || undefined; // "current" | "0-30" | "30-60" | "60+"

    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const billedTo = searchParams.get("billedTo") || undefined;

    // Aging bucket filter on dueDate
    let agingFilter: Record<string, unknown> | undefined;
    if (aging) {
      const now = new Date();
      const unpaidStatuses = ["PENDING", "PARTIALLY_PAID"] as BillStatus[];
      if (aging === "current") {
        agingFilter = { dueDate: { gte: now }, status: { in: unpaidStatuses } };
      } else if (aging === "0-30") {
        const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        agingFilter = { dueDate: { lt: now, gte: d30 }, status: { in: unpaidStatuses } };
      } else if (aging === "30-60") {
        const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const d60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        agingFilter = { dueDate: { lt: d30, gte: d60 }, status: { in: unpaidStatuses } };
      } else if (aging === "60+") {
        const d60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        agingFilter = { dueDate: { lt: d60 }, status: { in: unpaidStatuses } };
      }
    }

    const where = {
      ...(search && {
        OR: [
          { billNo: { contains: search, mode: "insensitive" as const } },
          { vendor: { name: { contains: search, mode: "insensitive" as const } } },
        ],
      }),
      ...(status && { status: status as never }),
      ...(vendorId && { vendorId }),
      ...(overdue && { dueDate: { lt: new Date() }, status: { in: ["PENDING", "PARTIALLY_PAID"] as BillStatus[] } }),
      ...agingFilter,
      ...(billedTo && { billedTo }),
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
          status: true, dueDate: true, billDate: true, billedTo: true, createdAt: true,
          vendor: { select: { name: true, code: true, paymentTermDays: true } },
          _count: { select: { payments: true } },
        },
        orderBy: { dueDate: "asc" },
        skip,
        take: limit,
      }),
      prisma.vendorBill.count({ where }),
    ]);

    return paginatedResponse(bills, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch bills", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("bills", "create");
    const body = await req.json();
    const data = vendorBillSchema.parse(body);

    // Duplicate check
    const existing = await prisma.vendorBill.findFirst({ where: { billNo: data.billNo } });
    if (existing) return errorResponse("Bill number already exists", 409);

    // Auto-calculate dueDate from vendor's paymentTermDays if not provided
    let dueDate: Date;
    if (data.dueDate) {
      dueDate = new Date(data.dueDate);
    } else {
      const vendor = await prisma.vendor.findUnique({
        where: { id: data.vendorId },
        select: { paymentTermDays: true },
      });
      const billDate = new Date(data.billDate);
      dueDate = new Date(billDate);
      dueDate.setDate(dueDate.getDate() + (vendor?.paymentTermDays || 30));
    }

    const bill = await prisma.vendorBill.create({
      data: {
        vendorId: data.vendorId,
        purchaseOrderId: data.purchaseOrderId || null,
        billNo: data.billNo,
        billDate: new Date(data.billDate),
        dueDate,
        amount: data.amount,
        notes: data.notes,
      },
      include: { vendor: { select: { name: true } } },
    });

    return successResponse(bill, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create bill", 400);
  }
}
