export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { customerUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("customers", "view");
    const { id } = await params;

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        invoices: {
          select: { id: true, invoiceNo: true, amount: true, paidAmount: true, status: true, dueDate: true },
          orderBy: { dueDate: "asc" },
        },
        _count: { select: { invoices: true, payments: true } },
      },
    });

    if (!customer) return errorResponse("Customer not found", 404);

    const totalOutstanding = customer.invoices.reduce(
      (sum, inv) => sum + (inv.amount - inv.paidAmount),
      0
    );

    return successResponse({ ...customer, totalOutstanding });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch customer", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("customers", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = customerUpdateSchema.parse(body);

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return errorResponse("Customer not found", 404);

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.email !== undefined && { email: data.email || null }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.type !== undefined && { type: data.type }),
      },
    });

    return successResponse(customer);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update customer", 400);
  }
}
