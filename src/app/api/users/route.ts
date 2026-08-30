export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { userSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { validateSiteAssignment } from "@/lib/site-assignment";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("team", "view");
    const { page, limit, skip, search } = parseSearchParams(req.url);
    // Filtered here rather than in the browser: pagination is server-side, so a client-side
    // filter would leave the page claiming "Showing 1-20 of 47" while rendering three rows.
    const roleId = new URL(req.url).searchParams.get("roleId") || undefined;

    const where = {
      ...(roleId ? { roleId } : {}),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          roleId: true,
          role: { select: { id: true, key: true, name: true } },
          // Where this person works. Both nullable — a user may be assigned to a store, a
          // warehouse, both or neither, and none of it grants access. /team renders these in
          // one "Store · Warehouse" column.
          store: { select: { id: true, code: true, name: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { transactions: true } },
        },
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return paginatedResponse(users, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch users", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("team", "create");
    const body = await req.json();
    const data = userSchema.parse(body);

    // Check for duplicate email or access code
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: data.email }, { accessCode: data.accessCode.toUpperCase() }],
      },
    });
    if (existing) {
      return errorResponse(
        existing.email === data.email ? "Email already exists" : "Access code already taken",
        409
      );
    }

    // The role must exist and be usable. Permissions are never set on the user — they come
    // from whatever the role holds, which is what makes access editable after the fact.
    const role = await prisma.role.findUnique({
      where: { id: data.roleId },
      select: { id: true, isActive: true },
    });
    if (!role) return errorResponse("Role not found", 400);
    if (!role.isActive) return errorResponse("That role is deactivated", 400);

    // The store/warehouse pair must hold. The select on /team/new filters warehouses to the
    // chosen store, but that is cosmetic — a hand-rolled request can send any pair.
    const siteError = await validateSiteAssignment({
      storeId: data.storeId,
      warehouseId: data.warehouseId,
    });
    if (siteError) return errorResponse(siteError, 400);

    // Access code IS the login credential — hash it as the password
    const hashedPassword = await bcrypt.hash(data.accessCode.toUpperCase(), 10);

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: hashedPassword,
        roleId: role.id,
        accessCode: data.accessCode.toUpperCase(),
        storeId: data.storeId ?? null,
        warehouseId: data.warehouseId ?? null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: { select: { id: true, key: true, name: true } },
        store: { select: { id: true, code: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        isActive: true,
        createdAt: true,
      },
    });

    return successResponse(user, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create user", 400);
  }
}
