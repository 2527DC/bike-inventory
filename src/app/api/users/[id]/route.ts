export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getAccess } from "@/lib/rbac";

const MAX_NAV_TABS = 4;

// Bottom-nav hrefs an admin may pin. Validated against the real module table rather than a
// hardcoded list, so seeding a new module immediately makes it pinnable and a removed module
// stops being accepted — no second list to keep in sync.
async function validNavRoutes(): Promise<Set<string>> {
  const mods = await prisma.module.findMany({
    where: { isActive: true, route: { not: null } },
    select: { route: true },
  });
  return new Set(mods.map((m) => m.route as string).filter((r) => r !== "/"));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("team", "view");
    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        roleId: true,
        role: { select: { id: true, key: true, name: true } },
        navTabs: true,
        accessCode: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { transactions: true, stockCounts: true } },
      },
    });

    if (!user) return errorResponse("User not found", 404);

    // The modules this person can actually open, so the admin UI offers only bottom-nav tabs
    // they are permitted to reach. Resolved from their role's grants, not from the user row.
    const access = await getAccess(user.id);
    return successResponse({ ...user, grantedModules: access.modules });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch user", 500);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("team", "edit");
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return errorResponse("User not found", 404);

    const updateData: Record<string, unknown> = {};
    if (body.name && typeof body.name === "string") updateData.name = body.name.trim();
    if (body.email && typeof body.email === "string") updateData.email = body.email.trim().toLowerCase();

    // Roles are rows now: accept a roleId and verify it exists and is usable, rather than
    // validating against a hardcoded list of role names.
    if (body.roleId !== undefined) {
      const role = await prisma.role.findUnique({
        where: { id: String(body.roleId) },
        select: { id: true, isActive: true },
      });
      if (!role) return errorResponse("Role not found", 400);
      if (!role.isActive) return errorResponse("That role is deactivated", 400);
      updateData.roleId = role.id;
    }

    if (body.navTabs !== undefined) {
      // Sanitize: only real module routes, de-duplicated, order preserved, capped.
      const allowed = await validNavRoutes();
      const cleaned = Array.isArray(body.navTabs)
        ? [
            ...new Set(
              body.navTabs.filter(
                (h: unknown): h is string => typeof h === "string" && allowed.has(h)
              )
            ),
          ].slice(0, MAX_NAV_TABS)
        : [];
      updateData.navTabs = cleaned;
    }
    if (body.accessCode && typeof body.accessCode === "string") {
      updateData.accessCode = body.accessCode.toUpperCase().trim();
      // Access code IS the login credential — always sync password hash
      updateData.password = await bcrypt.hash(body.accessCode.toUpperCase().trim(), 10);
    }
    if (body.isActive !== undefined && typeof body.isActive === "boolean") updateData.isActive = body.isActive;

    // Check uniqueness if email or accessCode changed
    if (body.email && body.email !== existing.email) {
      const dup = await prisma.user.findUnique({ where: { email: body.email } });
      if (dup) return errorResponse("Email already exists", 409);
    }
    if (body.accessCode && body.accessCode.toUpperCase() !== existing.accessCode) {
      const dup = await prisma.user.findUnique({ where: { accessCode: body.accessCode.toUpperCase() } });
      if (dup) return errorResponse("Access code already taken", 409);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: { select: { id: true, key: true, name: true } },
        isActive: true,
        updatedAt: true,
      },
    });

    return successResponse(user);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update user", 400);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireFeature("team", "delete");
    const { id } = await params;

    if (currentUser.id === id) {
      return errorResponse("Cannot delete your own account", 400);
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, isActive: true,
        _count: {
          select: {
            transactions: true,
            stockCounts: true,
          },
        },
      },
    });
    if (!user) return errorResponse("User not found", 404);

    const hasHistory = user._count.transactions > 0 || user._count.stockCounts > 0;

    if (hasHistory) {
      // User has transaction history — can only soft-delete
      await prisma.user.update({
        where: { id },
        data: { isActive: false },
      });
      return successResponse({
        deleted: false,
        deactivated: true,
        name: user.name,
        message: `${user.name} has ${user._count.transactions} transaction(s) and ${user._count.stockCounts} stock count(s) linked. Deactivated instead of deleted to preserve records.`,
      });
    }

    // No history — safe to hard delete
    try {
      await prisma.user.delete({ where: { id } });
      return successResponse({ deleted: true, deactivated: false, name: user.name, message: `${user.name} permanently deleted.` });
    } catch {
      // FK constraint still hit (other relations) — fallback to soft-delete
      await prisma.user.update({
        where: { id },
        data: { isActive: false },
      });
      return successResponse({
        deleted: false,
        deactivated: true,
        name: user.name,
        message: `${user.name} has linked records. Deactivated instead of deleted to preserve data integrity.`,
      });
    }
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to delete user", 400);
  }
}
