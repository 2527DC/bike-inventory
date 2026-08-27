export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// The full module × permission catalog, used to build the grid in the Roles & Permissions
// editor. Read from the DB, so adding a module to the seed makes it appear here with no
// frontend change.
export async function GET() {
  try {
    await requireFeature("roles", "view");

    const modules = await prisma.module.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: {
        id: true,
        key: true,
        label: true,
        description: true,
        icon: true,
        route: true,
        group: true,
        sortOrder: true,
        // So the grant screen can indent sub-modules under their parent, matching the
        // sidebar. Without it the editor renders four equal Staff LMS cards and gives no
        // hint that ticking `staff_lms_learning.view` without `staff_lms.view` leaves the
        // parent as a non-clickable heading.
        parentId: true,
        permissions: {
          orderBy: { action: "asc" },
          select: { id: true, key: true, action: true, label: true },
        },
      },
    });

    return successResponse({ modules });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
