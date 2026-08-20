export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { vendorContactSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("vendors", "view");
    const { id } = await params;
    const contacts = await prisma.vendorContact.findMany({
      where: { vendorId: id },
      orderBy: { isPrimary: "desc" },
    });
    return successResponse(contacts);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch contacts", 500);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("vendors", "create");
    const { id } = await params;
    const body = await req.json();
    const data = vendorContactSchema.parse(body);

    if (data.isPrimary) {
      await prisma.vendorContact.updateMany({
        where: { vendorId: id },
        data: { isPrimary: false },
      });
    }

    const contact = await prisma.vendorContact.create({
      data: { ...data, vendorId: id },
    });

    return successResponse(contact, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create contact", 400);
  }
}
