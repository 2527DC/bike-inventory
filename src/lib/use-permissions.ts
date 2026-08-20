"use client";

// Thin hook over the Zustand permission store (src/stores/permissions.ts).
//
// Kept as a hook with the same canView/canCreate/... surface the existing pages already call,
// so the migration off the old file-based system did not require touching every page. New code
// can subscribe to the store directly with a selector for narrower re-renders:
//
//   const canEdit = usePermissionStore((s) => s.canEdit);

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { usePermissionStore, type PermAction } from "@/stores/permissions";

export type { PermAction };

export function usePermissions() {
  const { status: sessionStatus } = useSession();

  const status = usePermissionStore((s) => s.status);
  const permissions = usePermissionStore((s) => s.permissions);
  const modules = usePermissionStore((s) => s.modules);
  const role = usePermissionStore((s) => s.role);
  const error = usePermissionStore((s) => s.error);
  const load = usePermissionStore((s) => s.load);
  const refresh = usePermissionStore((s) => s.refresh);

  // Load once the session exists. The store dedupes, so several components mounting
  // together still produce a single request.
  useEffect(() => {
    if (sessionStatus === "authenticated") void load();
  }, [sessionStatus, load]);

  const can = usePermissionStore((s) => s.can);

  return {
    permissions,
    modules,
    role,
    error,
    // `loading` stays true until the grants are actually known, so callers never render
    // an action against an empty permission set and conclude it is denied.
    loading: sessionStatus === "loading" || status === "idle" || status === "loading",
    ready: status === "ready",

    can,
    canView: (m: string) => can(m, "view"),
    canCreate: (m: string) => can(m, "create"),
    canEdit: (m: string) => can(m, "edit"),
    canDelete: (m: string) => can(m, "delete"),
    canApprove: (m: string) => can(m, "approve"),
    canFetch: (m: string) => can(m, "fetch"),

    refetch: refresh,
  };
}

/** Clear cached grants — call after sign-out. */
export function clearPermissionCache() {
  usePermissionStore.getState().reset();
}
