export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { roleCreateSchema } from "@/lib/validations";

// GET: every role, with how many permissions it holds and how many users it is assigned to.
export async function GET() {
  try {
    await requireFeature("roles", "view");

    const roles = await prisma.role.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isSystem: true,
        isActive: true,
        createdAt: true,
        _count: { select: { permissions: true, users: true } },
      },
    });

    return successResponse({ roles });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// POST: create a role, optionally with its initial grants.
export async function POST(req: NextRequest) {
  try {
    await requireFeature("roles", "create");
    const data = roleCreateSchema.parse(await req.json());

    const key = data.key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");

    const existing = await prisma.role.findUnique({ where: { key } });
    if (existing) return errorResponse(`A role with key "${key}" already exists`, 409);

    const role = await prisma.role.create({
      data: {
        key,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        // Roles created through the UI are never system roles — only the seed creates those,
        // so an admin cannot accidentally mint an undeletable role.
        isSystem: false,
        permissions: data.permissionIds?.length
          ? { create: data.permissionIds.map((permissionId) => ({ permissionId })) }
          : undefined,
      },
      select: { id: true, key: true, name: true, description: true, isActive: true },
    });

    return successResponse(role, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
