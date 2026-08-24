import { NextResponse } from "next/server";
import { requireFeature, AuthError, type CurrentUser, type PermAction } from "@/lib/auth-helpers";

// Permission guard for the ported service routes.
//
// The standalone app guarded every route with:
//     const user = await getSession();
//     if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
//
// ...where the session was unsigned JSON in a cookie, so `user.role` was whatever the
// caller typed. That is gone. This keeps the same two-line call shape at each site, but the
// answer now comes from the database: authenticate via NextAuth, then check the role's
// grants on the given module.
//
// Returned as a value rather than thrown because these routes have no try/catch of their
// own — throwing would surface as a 500 instead of a 401/403.
export async function serviceGuard(
  moduleKey: string,
  action: PermAction = "view"
): Promise<{ user: CurrentUser; error: null } | { user: null; error: NextResponse }> {
  try {
    const user = await requireFeature(moduleKey, action);
    return { user, error: null };
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Not authorised";
    return { user: null, error: NextResponse.json({ error: message }, { status }) };
  }
}

/** The role key given to workshop mechanics; used when listing assignable mechanics. */
export const MECHANIC_ROLE_KEY = "SERVICE_MECHANIC";
