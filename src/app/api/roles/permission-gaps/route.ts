export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("roles:gaps");

/**
 * GET: the module × role permission matrix for the read-only "Permission gaps" view
 * (plan 2109 R10, Q16a, owner 21 Sep 2026).
 *
 * Read-only. Granting stays in the role editor (PUT /api/roles/[id]); this route writes nothing.
 * Guarded exactly like the editor's own reads (/api/roles, /api/modules): `roles.view`.
 *
 * Two queries, no N+1: every active module with its permissions, and every role with the ids
 * of the permissions it holds. The matrix is assembled here so the screen receives, per role
 * and module, the actions held and the actions missing. No role name appears anywhere — roles
 * are rows, and `isSystem` (a column) is the only thing that marks the system role.
 */
export async function GET() {
  try {
    await requireFeature("roles", "view");
    const started = Date.now();

    const [modules, roles] = await Promise.all([
      prisma.module.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        select: {
          id: true,
          key: true,
          label: true,
          group: true,
          parentId: true,
          assignable: true,
          permissions: { select: { id: true, action: true } },
        },
      }),
      prisma.role.findMany({
        orderBy: [{ isSystem: "desc" }, { name: "asc" }],
        select: {
          id: true,
          key: true,
          name: true,
          isSystem: true,
          isActive: true,
          permissions: { select: { permissionId: true } },
          _count: { select: { users: true } },
        },
      }),
    ]);

    const roleRows = roles.map((r) => {
      const held = new Set(r.permissions.map((p) => p.permissionId));
      // moduleId -> actions this role holds for it. Only modules with at least one grant are
      // listed; an absent module means "holds nothing", which the screen highlights.
      const cells: Record<string, string[]> = {};
      for (const m of modules) {
        const actions = m.permissions.filter((p) => held.has(p.id)).map((p) => p.action);
        if (actions.length) cells[m.id] = actions;
      }
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        isSystem: r.isSystem,
        isActive: r.isActive,
        users: r._count.users,
        cells,
      };
    });

    const moduleRows = modules.map((m) => ({
      id: m.id,
      key: m.key,
      label: m.label,
      group: m.group,
      parentId: m.parentId,
      assignable: m.assignable,
      actions: m.permissions.map((p) => p.action),
    }));

    log.debug("permission matrix built", {
      modules: moduleRows.length,
      roles: roleRows.length,
      ms: Date.now() - started,
    });

    return successResponse({ modules: moduleRows, roles: roleRows });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "roles:gaps" });
  }
}
