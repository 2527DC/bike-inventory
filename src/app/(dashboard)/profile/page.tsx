"use client";

// ─── /profile — every signed-in user's own page ───────────────────────────────
//
// Plan 2809-profile-page-push-enrolment, Part B (R3, R4). No `can()` check anywhere: this page
// has no module and must render for a mechanic with no grants at all. Every API it calls is
// requireAuth-only and scoped to the SESSION user:
//   GET/DELETE /api/notifications/devices, POST /api/notifications/devices/test,
//   /api/notifications/push-config, /api/notifications/preferences.
//
// Loads on mount; the device list refreshes after this device registers or one is removed.
// No polling.

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Laptop, Loader2, Smartphone, Trash2, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/error-banner";
import { EnablePushButton } from "@/components/enable-push-button";
import { NotificationPreferences } from "@/components/notification-preferences";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { DeviceView } from "@/lib/notify/types";

const log = createLogger("profile:page");

export default function ProfilePage() {
  const { data: session } = useSession();
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;
  const { role } = usePermissions();

  const [devices, setDevices] = useState<DeviceView[] | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    const { data, error } = await apiTry<DeviceView[]>("/api/notifications/devices");
    if (error || !data) {
      log.error("could not load devices", { error });
      setDevicesError(error ?? "Could not load your devices");
      return;
    }
    setDevicesError(null);
    setDevices(data);
    log.debug("devices loaded", { count: data.length });
  }, []);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  async function remove(id: string) {
    setRemoving(id);
    try {
      await apiFetch(`/api/notifications/devices?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      log.info("device removed", { deviceId: id });
      setDevices((prev) => prev?.filter((d) => d.id !== id) ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("device remove failed", { deviceId: id, error: msg });
      setDevicesError(msg);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900 mb-3">Profile</h1>

      {/* Identity */}
      <Card className="mb-4">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
            <User className="h-6 w-6 text-slate-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-slate-900 truncate">{user?.name || "User"}</p>
            {user?.email && <p className="text-xs text-slate-500 truncate">{user.email}</p>}
            <Badge variant="info" className="mt-1">{role?.name || "No role"}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* This device */}
      <Card className="mb-4">
        <div className="px-4 py-3">
          <p className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Push on this device</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Turn this on once on every phone or computer you use. Notifications then arrive even when
            the app is closed.
          </p>
        </div>
        <div className="border-t border-slate-100 px-4 py-3">
          <EnablePushButton showTest onEnrolled={() => void loadDevices()} />
        </div>
      </Card>

      {/* My devices */}
      <Card className="mb-4">
        <div className="px-4 py-3">
          <p className="text-[13px] font-bold uppercase tracking-wide text-slate-500">My devices</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Everywhere your notifications are sent. Remove a phone you no longer use.
          </p>
        </div>
        <div className="border-t border-slate-100">
          {devicesError && (
            <div className="px-4 py-2">
              <ErrorBanner message={devicesError} onRetry={() => void loadDevices()} />
            </div>
          )}
          {devices === null && !devicesError && (
            <p className="px-4 py-3 text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )}
          {devices?.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-500">
              No device yet — you will not get push until you enable it above.
            </p>
          )}
          {devices?.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-2 min-h-[44px] border-t border-slate-50 first:border-t-0">
              {/android|iphone|mobile/i.test(d.userAgent ?? "") ? (
                <Smartphone className="h-4 w-4 text-slate-500 shrink-0" />
              ) : (
                <Laptop className="h-4 w-4 text-slate-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 truncate">{deviceLabel(d.userAgent)} · …{d.tokenTail}</p>
                <p className="text-[11px] text-slate-500">Last seen {new Date(d.lastSeenAt).toLocaleString()}</p>
              </div>
              <button
                type="button"
                onClick={() => void remove(d.id)}
                disabled={removing === d.id}
                aria-label="Remove this device"
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-red-600 rounded-lg focus-ring disabled:opacity-50"
              >
                {removing === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* Personal mutes — moved here from /more */}
      <NotificationPreferences />
    </div>
  );
}

/** "Chrome on Android" from a user-agent string — a recognisable name, not a parser. */
function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os = /android/i.test(ua)
    ? "Android"
    : /iphone|ipad/i.test(ua)
      ? "iPhone"
      : /mac os/i.test(ua)
        ? "Mac"
        : /windows/i.test(ua)
          ? "Windows"
          : /linux/i.test(ua)
            ? "Linux"
            : "Device";
  const browser = /edg\//i.test(ua) ? "Edge" : /chrome\//i.test(ua) ? "Chrome" : /safari\//i.test(ua) ? "Safari" : /firefox\//i.test(ua) ? "Firefox" : "Browser";
  return `${browser} on ${os}`;
}
