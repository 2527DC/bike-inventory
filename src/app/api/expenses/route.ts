export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { expenseSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("expenses", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    const category = searchParams.get("category") || undefined;
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const where = {
      ...(category && { category: category as never }),
      ...(dateFrom && { date: { gte: new Date(dateFrom) } }),
      ...(dateTo && { date: { ...(dateFrom ? { gte: new Date(dateFrom) } : {}), lte: new Date(dateTo) } }),
    };

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: { recordedBy: { select: { name: true } } },
        orderBy: { date: "desc" },
        skip,
        take: limit,
      }),
      prisma.expense.count({ where }),
    ]);

    return paginatedResponse(expenses, total, page, limit);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch expenses", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("expenses", "create");
    const body = await req.json();
    const data = expenseSchema.parse(body);

    const expense = await prisma.expense.create({
      data: {
        date: new Date(data.date),
        amount: data.amount,
        category: data.category,
        description: data.description,
        paidBy: data.paidBy,
        paymentMode: data.paymentMode,
        referenceNo: data.referenceNo,
        notes: data.notes,
        recordedById: user.id,
      },
      include: { recordedBy: { select: { name: true } } },
    });

    return successResponse(expense, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to record expense", 400);
  }
}
