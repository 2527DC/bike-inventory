export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { roleUpdateSchema } from "@/lib/validations";

// GET: one role plus the ids of the permissions it holds, for the editor grid.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("roles", "view");
    const { id } = await params;

    const role = await prisma.role.findUnique({
      where: { id },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isSystem: true,
        isActive: true,
        permissions: { select: { permissionId: true } },
        _count: { select: { users: true } },
      },
    });

    if (!role) return errorResponse("Role not found", 404);

    const { permissions, ...rest } = role;
    return successResponse({ ...rest, permissionIds: permissions.map((p) => p.permissionId) });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// PUT: update the role and replace its grant set.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("roles", "edit");
    const { id } = await params;
    const data = roleUpdateSchema.parse(await req.json());

    const role = await prisma.role.findUnique({
      where: { id },
      select: { id: true, key: true, isSystem: true },
    });
    if (!role) return errorResponse("Role not found", 404);

    // A system role (ADMIN) must keep every permission and stay active. Without this an
    // admin could revoke their own access to the permission editor and lock everyone out
    // with no way back in short of a re-seed.
    if (role.isSystem) {
      if (data.isActive === false) {
        return errorResponse("A system role cannot be deactivated", 400);
      }
      if (data.permissionIds) {
        const total = await prisma.permission.count();
        if (data.permissionIds.length < total) {
          return errorResponse(
            "A system role must hold every permission — its grants cannot be reduced",
            400
          );
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
          ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
      });

      // Replace the grant set wholesale: the editor submits the complete desired state, and
      // diffing here would let a stale client silently drop a grant it never knew about.
      if (data.permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (data.permissionIds.length) {
          await tx.rolePermission.createMany({
            data: data.permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
            skipDuplicates: true,
          });
        }
      }
    });

    return successResponse({ saved: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}

// DELETE: remove a role. Blocked for system roles and for roles still assigned to users,
// since User.roleId is required and orphaning it would break those logins.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("roles", "delete");
    const { id } = await params;

    const role = await prisma.role.findUnique({
      where: { id },
      select: { isSystem: true, name: true, _count: { select: { users: true } } },
    });
    if (!role) return errorResponse("Role not found", 404);
    if (role.isSystem) return errorResponse("A system role cannot be deleted", 400);
    if (role._count.users > 0) {
      return errorResponse(
        `${role.name} is assigned to ${role._count.users} user(s). Reassign them before deleting it.`,
        409
      );
    }

    await prisma.role.delete({ where: { id } });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
