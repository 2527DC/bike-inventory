export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { getAccess } from "@/lib/rbac";

const loginSchema = z.object({
  accessCode: z.string().min(1, "Access code is required"),
});

/**
 * Dedicated mobile login endpoint.
 * Validates accessCode, returns a standard NextAuth-compatible JWT Bearer token
 * along with the user's role and RBAC permission map.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return errorResponse("Access code is required", 400);
    }

    const code = parsed.data.accessCode.trim().toUpperCase();

    const user = await prisma.user.findUnique({
      where: { accessCode: code },
      select: {
        id: true,
        name: true,
        email: true,
        password: true,
        isActive: true,
        role: { select: { id: true, key: true, name: true, isActive: true } },
      },
    });

    if (!user || !user.isActive || !user.role || !user.role.isActive) {
      // Run bcrypt against a dummy hash to prevent user enumeration by timing
      await bcrypt.compare(code, "$2b$10$dummyhashvaluetopreventtimingattacks");
      return errorResponse("Invalid access code or inactive account", 401);
    }

    const isValid = await bcrypt.compare(code, user.password);
    if (!isValid) {
      return errorResponse("Invalid access code", 401);
    }

    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      throw new Error("NEXTAUTH_SECRET is not configured");
    }

    const token = await encode({
      token: {
        userId: user.id,
        sub: user.id,
        name: user.name,
        email: user.email,
        roleKey: user.role.key,
        roleName: user.role.name,
      },
      secret,
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    const access = await getAccess(user.id);

    return successResponse({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roleKey: user.role.key,
        roleName: user.role.name,
      },
      access: {
        roleKey: access.roleKey,
        roleName: access.roleName,
        permissions: access.permissions,
        modules: access.modules,
      },
    });
  } catch (error) {
    return failure(error, { scope: "auth:mobile-login" });
  }
}
