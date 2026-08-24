// ─── Server-side RBAC resolver ───────────────────────────────────────────────
// The single source of truth for "what can this user do". Every answer comes from the
// database (modules / permissions / roles / role_permissions) — nothing is hardcoded here,
// so an admin changing a grant takes effect on the very next request with no redeploy.
//
// Replaces the former src/lib/permissions-server.ts, which held per-role permission maps
// in code and merged them with two JSON blobs (User.permissions, AlertConfig.rolePermissions).
// Those are all gone.
//
// Request-level memoisation
// -------------------------
// React's cache() dedupes by argument within a single server request. A route handler that
// checks two permissions therefore hits the database once, not twice, while two different
// requests never share a result. That is deliberate: a cross-request cache would keep a
// revoked permission alive, which is the bug this whole migration exists to remove.

import { cache } from "react";
import { prisma } from "@/lib/db";

export type PermAction = "view" | "create" | "edit" | "delete" | "approve" | "fetch";

// The action that governs whether a module appears in the navigation. Module-private:
// callers use userCan()/getAccess() rather than reimplementing the filter, and
// prisma/rbac-catalog.ts keeps its own copy for seed-time use.
const READ_ACTION: PermAction = "view";

export interface GrantedModule {
  key: string;
  label: string;
  icon: string | null;
  route: string | null;
  group: string | null;
  sortOrder: number;
  /** Actions this user holds on this module, e.g. ["view", "edit"]. */
  actions: PermAction[];
}

export interface ResolvedAccess {
  userId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  /** module key -> { action -> true }. Absent action means "not granted". */
  permissions: Record<string, Partial<Record<PermAction, boolean>>>;
  /** Only modules the user can view, ordered for the sidebar. */
  modules: GrantedModule[];
}

const EMPTY_ACCESS = (userId: string): ResolvedAccess => ({
  userId,
  roleId: "",
  roleKey: "",
  roleName: "",
  permissions: {},
  modules: [],
});

/**
 * Resolve everything the user is allowed to do, in ONE query.
 *
 * We walk role_permissions -> permissions -> modules rather than issuing a query per check,
 * because a page like /stock asks about view/edit/delete/create in a single render.
 */
export const getAccess = cache(async (userId: string): Promise<ResolvedAccess> => {
  if (!userId) return EMPTY_ACCESS(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      role: {
        select: {
          id: true,
          key: true,
          name: true,
          isActive: true,
          permissions: {
            select: {
              permission: {
                select: {
                  action: true,
                  module: {
                    select: {
                      key: true,
                      label: true,
                      icon: true,
                      route: true,
                      group: true,
                      sortOrder: true,
                      isActive: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  // An inactive user, or a user on a deactivated role, holds nothing.
  if (!user || !user.isActive || !user.role || !user.role.isActive) {
    return EMPTY_ACCESS(userId);
  }

  const permissions: ResolvedAccess["permissions"] = {};
  const moduleMap = new Map<string, GrantedModule>();

  for (const { permission } of user.role.permissions) {
    const mod = permission.module;
    if (!mod.isActive) continue; // a disabled module grants nothing, even if the row survives

    const action = permission.action as PermAction;
    (permissions[mod.key] ??= {})[action] = true;

    let entry = moduleMap.get(mod.key);
    if (!entry) {
      entry = {
        key: mod.key,
        label: mod.label,
        icon: mod.icon,
        route: mod.route,
        group: mod.group,
        sortOrder: mod.sortOrder,
        actions: [],
      };
      moduleMap.set(mod.key, entry);
    }
    entry.actions.push(action);
  }

  // The sidebar only ever renders modules the user can read.
  const modules = [...moduleMap.values()]
    .filter((m) => m.actions.includes(READ_ACTION))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

  return {
    userId,
    roleId: user.role.id,
    roleKey: user.role.key,
    roleName: user.role.name,
    permissions,
    modules,
  };
});

/** True if the user holds `action` on `moduleKey`. The only authorisation primitive. */
export async function userCan(
  userId: string,
  moduleKey: string,
  action: PermAction = READ_ACTION
): Promise<boolean> {
  const access = await getAccess(userId);
  return access.permissions[moduleKey]?.[action] === true;
}
