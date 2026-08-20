"use client";

// ─── Permission store ────────────────────────────────────────────────────────
// Holds the signed-in user's permission set and granted modules for the whole client.
//
// Replaces the old module-level `cachedPermissions` variable in src/lib/use-permissions.ts,
// which had three defects this store fixes:
//   1. It wasn't React state, so clearing it never re-rendered anything.
//   2. Sidebar + nav + page each fired their own duplicate fetch on a cold start.
//   3. canView() returned `true` while loading, briefly showing modules the user may not hold.
//
// Here, `load()` is idempotent per session (concurrent callers share one in-flight request),
// every consumer subscribes to real state, and nothing is granted until the data arrives.

import { create } from "zustand";

export type PermAction = "view" | "create" | "edit" | "delete" | "approve" | "fetch";

export interface GrantedModule {
  key: string;
  label: string;
  icon: string | null;
  route: string | null;
  group: string | null;
  sortOrder: number;
  actions: PermAction[];
}

type PermissionMap = Record<string, Partial<Record<PermAction, boolean>>>;

interface PermissionState {
  status: "idle" | "loading" | "ready" | "error";
  user: { id: string; name: string; email: string } | null;
  role: { key: string; name: string } | null;
  permissions: PermissionMap;
  modules: GrantedModule[];
  error: string | null;

  /** Fetch the permission set. Safe to call from many components — only one request runs. */
  load: () => Promise<void>;
  /** Re-fetch after an admin changes grants. */
  refresh: () => Promise<void>;
  /** Drop everything on sign-out so the next user never sees the previous one's grants. */
  reset: () => void;

  can: (moduleKey: string, action?: PermAction) => boolean;
  canView: (moduleKey: string) => boolean;
  canCreate: (moduleKey: string) => boolean;
  canEdit: (moduleKey: string) => boolean;
  canDelete: (moduleKey: string) => boolean;
  canApprove: (moduleKey: string) => boolean;
  canFetch: (moduleKey: string) => boolean;
}

// Shared in-flight promise so a cold start with three mounting consumers issues one request.
let inFlight: Promise<void> | null = null;

async function fetchAccess(set: (p: Partial<PermissionState>) => void) {
  set({ status: "loading", error: null });
  try {
    const res = await fetch("/api/my-permissions", { cache: "no-store" });
    const json = await res.json();

    if (!res.ok || !json?.success) {
      throw new Error(json?.error || `Request failed (${res.status})`);
    }

    set({
      status: "ready",
      user: json.data.user ?? null,
      role: json.data.role ?? null,
      permissions: (json.data.permissions as PermissionMap) ?? {},
      modules: (json.data.modules as GrantedModule[]) ?? [],
      error: null,
    });
  } catch (e) {
    // Fail CLOSED: on error the user holds nothing rather than everything.
    set({
      status: "error",
      permissions: {},
      modules: [],
      error: e instanceof Error ? e.message : "Failed to load permissions",
    });
  }
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  status: "idle",
  user: null,
  role: null,
  permissions: {},
  modules: [],
  error: null,

  load: async () => {
    const { status } = get();
    if (status === "ready" || status === "loading") {
      if (inFlight) await inFlight;
      return;
    }
    inFlight = fetchAccess(set).finally(() => {
      inFlight = null;
    });
    await inFlight;
  },

  refresh: async () => {
    inFlight = fetchAccess(set).finally(() => {
      inFlight = null;
    });
    await inFlight;
  },

  reset: () => {
    inFlight = null;
    set({
      status: "idle",
      user: null,
      role: null,
      permissions: {},
      modules: [],
      error: null,
    });
  },

  // A permission is granted only when the backend said so. Unknown module, unloaded state
  // and failed fetch all resolve to false — the same answer the API guard would give.
  can: (moduleKey, action = "view") => get().permissions[moduleKey]?.[action] === true,

  canView: (m) => get().permissions[m]?.view === true,
  canCreate: (m) => get().permissions[m]?.create === true,
  canEdit: (m) => get().permissions[m]?.edit === true,
  canDelete: (m) => get().permissions[m]?.delete === true,
  canApprove: (m) => get().permissions[m]?.approve === true,
  canFetch: (m) => get().permissions[m]?.fetch === true,
}));

/**
 * Read permissions outside React — route handlers on the client, event callbacks, helpers
 * in src/lib. Not possible with a Context-based store, which is part of why this is Zustand.
 */
export function can(moduleKey: string, action: PermAction = "view"): boolean {
  return usePermissionStore.getState().can(moduleKey, action);
}
