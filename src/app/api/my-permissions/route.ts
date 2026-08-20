export const dynamic = "force-dynamic";

import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAccess, AuthError } from "@/lib/auth-helpers";

// The permission bootstrap endpoint. The frontend store calls this once after login and
// keeps the result in memory (src/stores/permissions.ts).
//
// This route is intentionally guarded by authentication ONLY, never by requireFeature().
// Gating it on a permission would deadlock: a user would need permissions in order to
// discover which permissions they have.
export async function GET() {
  try {
    const { user, access } = await requireAccess();

    return successResponse({
      user: { id: user.id, name: user.name, email: user.email },
      role: { key: access.roleKey, name: access.roleName },
      permissions: access.permissions,
      modules: access.modules,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
