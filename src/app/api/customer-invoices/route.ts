export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { customerInvoiceSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import type { InvoiceStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("customers", "view");
    const { page, limit, skip, search, searchParams } = parseSearchParams(req.url);
    const status = searchParams.get("status") || undefined;
    const customerId = searchParams.get("customerId") || undefined;
    const overdue = searchParams.get("overdue") === "true";
    const aging = searchParams.get("aging") || undefined; // "current" | "0-30" | "30-60" | "60+"

    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;

    // Build aging date range filter on dueDate
    let agingFilter: Record<string, unknown> | undefined;
    if (aging) {
      const now = new Date();
      const unpaidStatuses = ["PENDING", "PARTIALLY_PAID"] as InvoiceStatus[];
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
          { invoiceNo: { contains: search, mode: "insensitive" as const } },
          { customer: { name: { contains: search, mode: "insensitive" as const } } },
        ],
      }),
      ...(status && { status: status as never }),
      ...(customerId && { customerId }),
      ...(overdue && { dueDate: { lt: new Date() }, status: { in: ["PENDING", "PARTIALLY_PAID"] as InvoiceStatus[] } }),
      ...agingFilter,
      ...((dateFrom || dateTo) && {
        invoiceDate: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo + "T23:59:59.999Z") }),
        },
      }),
    };

    const [invoices, total] = await Promise.all([
      prisma.customerInvoice.findMany({
        where,
        select: {
          id: true, invoiceNo: true, amount: true, paidAmount: true,
          status: true, invoiceDate: true, dueDate: true, createdAt: true,
          customer: { select: { name: true, phone: true } },
        },
        orderBy: { dueDate: "asc" },
        skip,
        take: limit,
      }),
      prisma.customerInvoice.count({ where }),
    ]);

    return paginatedResponse(invoices, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch invoices", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("customers", "create");
    const body = await req.json();
    const data = customerInvoiceSchema.parse(body);

    const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) return errorResponse("Customer not found", 404);

    const invoice = await prisma.customerInvoice.create({
      data: {
        customerId: data.customerId,
        invoiceNo: data.invoiceNo,
        invoiceDate: new Date(data.invoiceDate),
        dueDate: new Date(data.dueDate),
        amount: data.amount,
        notes: data.notes,
      },
      include: { customer: { select: { name: true } } },
    });

    return successResponse(invoice, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create invoice", 400);
  }
}
