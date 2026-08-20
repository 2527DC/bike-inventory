import { getServerSession as nextAuthGetServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAccess, userCan, type PermAction } from "@/lib/rbac";

export type { PermAction };

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  roleId: string;
  /** Stable role identifier, e.g. "ADMIN". Display/logging only — never authorise on this. */
  roleKey: string;
  roleName: string;
  isActive: boolean;
}

export async function getServerSession() {
  return nextAuthGetServerSession(authOptions);
}

/**
 * The authenticated user, re-read from the DB so a deactivated account or a role change
 * takes effect immediately rather than riding on a stale JWT.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession();
  if (!session?.user) return null;

  const userId = (session.user as { userId?: string; id?: string }).userId
    || (session.user as { id?: string }).id;
  if (!userId) return null;

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      roleId: true,
      role: { select: { key: true, name: true, isActive: true } },
    },
  });

  if (!dbUser || !dbUser.isActive || !dbUser.role?.isActive) return null;

  return {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    roleId: dbUser.roleId,
    roleKey: dbUser.role.key,
    roleName: dbUser.role.name,
    isActive: dbUser.isActive,
  };
}

/**
 * Authentication only — "is a real, active user making this request".
 *
 * Use this ONLY where no module/action pair is meaningful: the permission bootstrap
 * endpoint, self-service profile reads, and public/cron handlers. Everything that touches
 * a feature must use requireFeature() instead, so access is decided by data rather than code.
 */
export async function requireAuth(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Authentication required", 401);
  if (!user.isActive) throw new AuthError("Account is inactive", 403);
  return user;
}

/**
 * Authorisation — authenticate, then ask the database whether this user's role holds
 * `action` on `moduleKey`. This is the guard every feature route uses.
 *
 * There is no role allow-list and no superuser short-circuit: an admin passes because the
 * seed granted the ADMIN role all 101 permissions, not because the code names them. Revoke a
 * grant and the admin is refused too, which is what makes the system genuinely dynamic.
 */
export async function requireFeature(
  moduleKey: string,
  action: PermAction = "view"
): Promise<CurrentUser> {
  const user = await requireAuth();

  const allowed = await userCan(user.id, moduleKey, action);
  if (!allowed) {
    throw new AuthError(`You do not have permission to ${action} ${moduleKey}`, 403);
  }
  return user;
}

/** The user's full resolved access — for endpoints that return the permission set itself. */
export async function requireAccess() {
  const user = await requireAuth();
  return { user, access: await getAccess(user.id) };
}

export class AuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
