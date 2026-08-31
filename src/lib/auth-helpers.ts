import { cache } from "react";
import { getServerSession as nextAuthGetServerSession } from "next-auth";
import { decode } from "next-auth/jwt";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth";
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
 *
 * Supports both:
 * 1. Web session cookies (NextAuth getServerSession)
 * 2. Mobile / API Bearer tokens (Authorization: Bearer <jwt>)
 *
 * Wrapped in React cache() for the same reason getAccess is: a route that calls
 * requireFeature twice would otherwise decode the session cookie twice. Request-scoped, so
 * two requests never share a result — see the note on getAccess in src/lib/rbac.ts.
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
  let userId: string | null = null;

  // 1. Check NextAuth cookie session (for Web)
  try {
    const session = await getServerSession();
    if (session?.user) {
      userId =
        (session.user as { userId?: string; id?: string }).userId ||
        (session.user as { id?: string }).id ||
        null;
    }
  } catch {
    // ignore session lookup failure in non-cookie requests
  }

  // 2. If no cookie session, check Authorization header (for Mobile App)
  if (!userId) {
    try {
      const headerList = await headers();
      const authHeader = headerList.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7).trim();
        const secret = process.env.NEXTAUTH_SECRET;
        if (token && secret) {
          const decoded = await decode({ token, secret });
          if (decoded) {
            userId = (decoded.userId as string) || (decoded.sub as string) || null;
          }
        }
      }
    } catch {
      // headers() might not be available in non-request contexts
    }
  }

  if (!userId) return null;

  // Reads through getAccess rather than issuing its own `user.findUnique`.
  //
  // Three separate reads of the SAME User row used to happen on every guarded request,
  // across 190 route files: the next-auth jwt callback (role label), this function
  // (identity) and getAccess (permissions). The jwt callback's read is gone
  // (src/lib/auth.ts) and this one now comes out of getAccess, which already selects
  // everything needed here — so requireFeature() costs ONE query: requireAuth and userCan
  // share it via React cache().
  //
  // Per-request freshness is unchanged. cache() dedupes within a single request only, by
  // design, so a permission revoked a moment ago still applies on the next request.
  const access = await getAccess(userId);

  // getAccess returns user: null for a missing user, a deactivated one, or one whose ROLE is
  // deactivated — exactly the three cases this used to reject itself.
  if (!access.user) return null;

  return {
    id: access.user.id,
    name: access.user.name,
    email: access.user.email,
    roleId: access.roleId,
    roleKey: access.roleKey,
    roleName: access.roleName,
    isActive: access.user.isActive,
  };
});

/**
 * Authentication only — "is a real, active user making this request".
 *
 * Use this ONLY where no module/action pair is meaningful: the permission bootstrap
 * endpoint, self-service profile reads, and public handlers. Everything that touches
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
