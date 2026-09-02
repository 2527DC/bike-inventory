"use client";

// ─── "My notifications" — the personal mute switches on /more ─────────────────
//
// Renders for EVERY signed-in user. There is deliberately no `can()` check anywhere in this
// file: a mechanic with no settings grant must be able to silence their own notifications,
// and the API it talks to (/api/notifications/preferences) is requireAuth-only and writes the
// SESSION user's rows, never a userId from the body. Plan §E.2.
//
// Sits on /more between the user card and the grouped menu — as plain JSX, not as a menu
// entry, because the menu is built from the RBAC module list and this surface has no module.
//
// Loads once on mount and saves on each flip. No polling: nobody else changes these rows.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { PreferenceView, PreferenceUpdate } from "@/lib/notify/types";

const log = createLogger("preferences:client");

const ENDPOINT = "/api/notifications/preferences";

type ChannelField = "push" | "email";

export function NotificationPreferences() {
  const [rows, setRows] = useState<PreferenceView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Keys with a PUT in flight. Their switches are disabled so a double-tap cannot race two
  // writes for the same row.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState("");
  // `at` makes two quick saves of the same row restart the flash instead of sharing one.
  const [saved, setSaved] = useState<{ eventKey: string; at: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await apiTry<PreferenceView[]>(ENDPOINT);
    if (error || !data) {
      log.error("load failed", { error: error ?? "empty response" });
      setLoadError(error || "Could not load your notification preferences.");
    } else {
      setRows(data);
      setLoadError("");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 1500);
    return () => clearTimeout(t);
  }, [saved]);

  async function toggle(eventKey: PreferenceView["eventKey"], field: ChannelField) {
    if (!rows || pending.has(eventKey)) return;
    const before = rows.find((r) => r.eventKey === eventKey);
    if (!before) return;

    const next: PreferenceUpdate = {
      eventKey,
      push: field === "push" ? !before.push : before.push,
      email: field === "email" ? !before.email : before.email,
    };

    // Optimistic: flip first, revert only if the server refuses. The response is the merged
    // list, but it is NOT used to replace state — a second row flipped while this request was
    // in flight would be overwritten with its pre-save value and appear to bounce back.
    setSaveError("");
    setPending((p) => new Set(p).add(eventKey));
    setRows((rs) => rs?.map((r) => (r.eventKey === eventKey ? { ...r, ...next } : r)) ?? rs);
    log.debug("-> save", { eventKey, field, value: next[field] });

    try {
      await apiFetch<PreferenceView[]>(ENDPOINT, { method: "PUT", json: [next] });
      log.debug("saved", { eventKey });
      setSaved({ eventKey, at: Date.now() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save";
      log.error("save failed", { eventKey, field, error: msg });
      setRows((rs) => rs?.map((r) => (r.eventKey === eventKey ? before : r)) ?? rs);
      setSaveError(`Could not save "${before.label}": ${msg}`);
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(eventKey);
        return n;
      });
    }
  }

  // Nothing registered means nothing to mute. Render nothing rather than an empty card that
  // only clutters /more.
  if (!loading && !loadError && rows && rows.length === 0) return null;

  return (
    <Card className="mb-4">
      <div className="px-4 py-3">
        <p className="text-[13px] font-bold uppercase tracking-wide text-slate-500">My notifications</p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Silence the ones you don&apos;t want. Admins control which events exist; this is only for you.
        </p>
      </div>

      <div className="border-t border-slate-100">
        {loading && (
          <div className="px-4 py-2 space-y-2" aria-busy="true" aria-label="Loading notification preferences">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 min-h-[44px]">
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            ))}
          </div>
        )}

        {!loading && loadError && (
          <div className="px-4 py-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-700">{loadError}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="text-xs font-semibold text-blue-600 hover:underline min-h-[44px] focus-ring rounded"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {!loading && !loadError && rows && (
          <div className="divide-y divide-slate-100">
            {rows.map((row) => {
              const busy = pending.has(row.eventKey);
              const justSaved = saved?.eventKey === row.eventKey;
              return (
                <div key={row.eventKey} className="flex items-center gap-2 px-4 py-1.5 min-h-[44px]">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate">
                      {row.label}
                      {justSaved && (
                        <span className="ml-2 text-[10px] font-medium text-green-600">Saved</span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-500 leading-snug">{row.description}</p>
                  </div>
                  <ChannelSwitch
                    label="Push"
                    eventLabel={row.label}
                    on={row.push}
                    disabled={busy}
                    onToggle={() => void toggle(row.eventKey, "push")}
                  />
                  <ChannelSwitch
                    label="Email"
                    eventLabel={row.label}
                    on={row.email}
                    disabled={busy}
                    onToggle={() => void toggle(row.eventKey, "email")}
                  />
                </div>
              );
            })}
          </div>
        )}

        {saveError && (
          <p className="px-4 py-2 text-[11px] text-red-700 bg-red-50 border-t border-red-100 rounded-b-xl">
            {saveError}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * One labelled switch with a full 44px tap target. `role="switch"` + `aria-checked` so a
 * screen reader announces "Push for Stock below reorder level, on" rather than a bare button.
 */
function ChannelSwitch({
  label, eventLabel, on, disabled, onToggle,
}: {
  label: string;
  eventLabel: string;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label} for ${eventLabel}`}
      disabled={disabled}
      onClick={onToggle}
      className="flex flex-col items-center justify-center gap-0.5 min-h-[44px] min-w-[44px] px-1 rounded-lg focus-ring disabled:opacity-50 shrink-0"
    >
      <span
        className={`relative inline-block h-5 w-9 rounded-full transition-colors ${
          on ? "bg-blue-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-4" : ""
          }`}
        />
      </span>
      <span className="text-[10px] font-medium text-slate-500">{label}</span>
    </button>
  );
}
