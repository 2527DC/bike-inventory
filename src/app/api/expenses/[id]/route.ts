export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { expenseSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("expenses", "view");
    const { id } = await params;
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: { recordedBy: { select: { name: true } } },
    });

    if (!expense) return errorResponse("Expense not found", 404);
    return successResponse(expense);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch expense", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("expenses", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = expenseSchema.partial().parse(body);

    const expense = await prisma.expense.update({
      where: { id },
      data: {
        ...(data.date && { date: new Date(data.date) }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.category && { category: data.category }),
        ...(data.description && { description: data.description }),
        ...(data.paidBy && { paidBy: data.paidBy }),
        ...(data.paymentMode && { paymentMode: data.paymentMode }),
        ...(data.referenceNo !== undefined && { referenceNo: data.referenceNo }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
      include: { recordedBy: { select: { name: true } } },
    });

    return successResponse(expense);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update expense", 400);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("expenses", "delete");
    const { id } = await params;

    await prisma.expense.delete({ where: { id } });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to delete expense", 400);
  }
}
