export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { deliveryCreateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("deliveries", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    const status = searchParams.get("status") || undefined;
    const area = searchParams.get("area") || undefined;
    const date = searchParams.get("date") || undefined;
    const search = searchParams.get("search") || undefined;
    const outstation = searchParams.get("outstation") || undefined;
    const sortBy = searchParams.get("sortBy") || undefined;

    const dateRange = searchParams.get("dateRange") || undefined;
    const includeService = searchParams.get("includeService") === "true";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, unknown> = {};
    // By default, exclude service invoices from delivery pages
    // NOTE: Must use OR with null check — Prisma's NOT filter excludes NULL rows in PostgreSQL
    if (!includeService) {
      where.AND = [
        { OR: [{ invoiceType: null }, { invoiceType: { not: "SERVICE" } }] },
      ];
    }
    if (status) {
      where.status = status;
      // Auto-hide: delivered/walkout items older than current month unless date filter is set
      if ((status === "DELIVERED" || status === "WALK_OUT") && !date && !dateRange) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        where.deliveredAt = { gte: startOfMonth };
      }
    }
    if (area) where.customerArea = area;
    if (outstation === "true") where.isOutstation = true;
    if (outstation === "false") where.isOutstation = false;
    if (dateRange) {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let rangeEnd: Date | undefined;

      if (dateRange === "today") {
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);
        where.scheduledDate = { gte: startOfDay, lt: endOfDay };
      } else if (dateRange === "tomorrow") {
        const tomorrow = new Date(startOfDay);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayAfter = new Date(tomorrow);
        dayAfter.setDate(dayAfter.getDate() + 1);
        where.scheduledDate = { gte: tomorrow, lt: dayAfter };
      } else if (dateRange === "3days") {
        rangeEnd = new Date(startOfDay);
        rangeEnd.setDate(rangeEnd.getDate() + 4);
        where.scheduledDate = { gte: startOfDay, lt: rangeEnd };
      } else if (dateRange === "week") {
        rangeEnd = new Date(startOfDay);
        rangeEnd.setDate(rangeEnd.getDate() + 8);
        where.scheduledDate = { gte: startOfDay, lt: rangeEnd };
      } else if (dateRange === "month") {
        rangeEnd = new Date(startOfDay);
        rangeEnd.setDate(rangeEnd.getDate() + 31);
        where.scheduledDate = { gte: startOfDay, lt: rangeEnd };
      }
    }
    if (date) {
      const d = new Date(date);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.invoiceDate = { gte: d, lt: next };
    }
    if (search) {
      where.OR = [
        { invoiceNo: { contains: search, mode: "insensitive" } },
        { customerName: { contains: search, mode: "insensitive" } },
        { customerPhone: { contains: search } },
      ];
    }

    const [deliveries, total] = await Promise.all([
      prisma.delivery.findMany({
        where,
        include: { verifiedBy: { select: { name: true } } },
        orderBy: sortBy === "scheduledDate" ? { scheduledDate: "asc" } : { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.delivery.count({ where }),
    ]);

    return paginatedResponse(deliveries, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch deliveries", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("deliveries", "create");
    const body = await req.json();
    const data = deliveryCreateSchema.parse(body);

    // Check duplicate invoice
    const existing = await prisma.delivery.findFirst({
      where: { invoiceNo: data.invoiceNo },
    });
    if (existing) return errorResponse("Invoice number already exists", 409);

    const delivery = await prisma.delivery.create({
      data: {
        invoiceNo: data.invoiceNo,
        invoiceDate: new Date(),
        invoiceAmount: data.invoiceAmount || 0,
        customerName: data.customerName,
        customerPhone: data.customerPhone || null,
        status: "PREBOOKED",
        expectedReadyDate: data.expectedReadyDate ? new Date(data.expectedReadyDate) : null,
        prebookNotes: data.prebookNotes || null,
        lineItems: data.lineItems ?? undefined,
        verifiedById: user.id,
      },
    });

    return successResponse(delivery, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create delivery", 400);
  }
}
