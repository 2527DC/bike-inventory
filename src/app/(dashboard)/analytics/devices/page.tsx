"use client";

// Counting devices — register a camera agent, revoke it, rotate its key.
//
// Permission model: `analytics.view` to see the list, `analytics.edit` to change anything.
// Everything here is cosmetic — the API re-checks both (CLAUDE.md: "frontend checks are
// cosmetic; never let the client be the only gate").

import { useCallback, useEffect, useState } from "react";
import { Activity, Copy, Check, KeyRound, Plus, RefreshCw, ShieldOff, ShieldCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SkeletonList } from "@/components/ui/skeleton";
import { usePermissions } from "@/lib/use-permissions";
import { STOCK_LOCATIONS, stockLocationLabel } from "@/lib/inventory-config";

interface Device {
  id: string;
  label: string;
  storeId: "BCH_STORE" | "BCC_STORE";
  agentId: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  online: boolean;
}

// Only sites with a doorway can be counted. Derived from the shared location config rather
// than a second hardcoded list.
const COUNTABLE_STORES = STOCK_LOCATIONS.filter((l) => l.kind === "Store");

/**
 * The one-time key panel.
 *
 * The key is shown here and never again — it exists only as a sha-256 in the database. That
 * is stated plainly rather than buried, because the recovery path (rotate, then walk to the
 * shop and edit agent/.env) is expensive enough that people should copy it now.
 */
function KeyReveal({ label, apiKey, onDone }: { label: string; apiKey: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked outside a secure context; the key is selectable on screen.
    }
  }

  return (
    <Card className="border-amber-300 bg-amber-50">
      <CardContent className="p-4">
        <div className="flex items-start gap-2">
          <KeyRound className="h-5 w-5 shrink-0 text-amber-700" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">
              API key for “{label}” — shown once
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">
              Copy it into <code className="rounded bg-amber-100 px-1">agent/.env</code> on the
              store laptop as <code className="rounded bg-amber-100 px-1">API_KEY</code>. It is
              stored only as a hash, so it cannot be shown again — if it is lost, rotate the key
              and update the laptop.
            </p>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="block flex-1 overflow-x-auto rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-slate-900">
                {apiKey}
              </code>
              <Button size="sm" variant="outline" onClick={copy} className="shrink-0">
                {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <Button size="sm" variant="ghost" onClick={onDone} className="mt-2 text-amber-900">
              I have saved it
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsDevicesPage() {
  // `ready` matters: the store grants nothing until the permission set has arrived, so
  // checking canView() while it is still loading renders "no access" to a user who has it.
  const { canView, canEdit, ready: permsReady } = usePermissions();
  const allowed = canView("analytics");
  const editable = canEdit("analytics");

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [storeId, setStoreId] = useState<"BCH_STORE" | "BCC_STORE">("BCH_STORE");
  const [agentId, setAgentId] = useState("edge-1");
  const [saving, setSaving] = useState(false);

  const [revealed, setRevealed] = useState<{ label: string; key: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/analytics/devices");
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to load devices");
      setDevices(json.data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load devices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/analytics/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, storeId, agentId }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to register device");
      setRevealed({ label: json.data.device.label, key: json.data.key });
      setShowForm(false);
      setLabel("");
      setAgentId("edge-1");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register device");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(device: Device, isActive: boolean) {
    setBusyId(device.id);
    setError("");
    try {
      const res = await fetch(`/api/analytics/devices/${device.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to update device");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update device");
    } finally {
      setBusyId(null);
    }
  }

  async function rotate(device: Device) {
    setBusyId(device.id);
    setError("");
    try {
      const res = await fetch(`/api/analytics/devices/${device.id}/rotate`, { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to rotate key");
      setRevealed({ label: json.data.device.label, key: json.data.key });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate key");
    } finally {
      setBusyId(null);
    }
  }

  if (!permsReady) return <SkeletonList />;

  if (!allowed) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-slate-500">You do not have access to Store Analytics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Counting devices</h1>
          <p className="mt-1 text-sm text-slate-500">
            Camera agents allowed to report footfall. Each holds one API key.
          </p>
        </div>
        {editable && !showForm && (
          <Button size="sm" onClick={() => setShowForm(true)} className="shrink-0">
            <Plus className="mr-1.5 h-4 w-4" />
            Add
          </Button>
        )}
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      {revealed && (
        <KeyReveal
          label={revealed.label}
          apiKey={revealed.key}
          onDone={() => setRevealed(null)}
        />
      )}

      {showForm && editable && (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={create} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Label</label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="BCH front door laptop"
                  required
                  maxLength={80}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Store</label>
                  <select
                    value={storeId}
                    onChange={(e) => setStoreId(e.target.value as "BCH_STORE" | "BCC_STORE")}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    {COUNTABLE_STORES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Agent id</label>
                  <Input
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    placeholder="edge-1"
                    required
                    maxLength={64}
                  />
                </div>
              </div>

              <p className="text-xs text-slate-500">
                One device per store and agent id. A second door at the same store needs its own
                agent id — for example <code>edge-2</code>.
              </p>

              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? "Creating…" : "Create and show key"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowForm(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <SkeletonList />
      ) : devices.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Activity className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">No counting devices yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
              Until one is registered, the ingest endpoints reject every request — nothing can
              write footfall without a key.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {devices.map((d) => (
            <Card key={d.id} className={d.isActive ? "" : "opacity-60"}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{d.label}</span>
                      {d.isActive ? (
                        <Badge variant={d.online ? "success" : "warning"}>
                          {d.online ? "Online" : "No heartbeat"}
                        </Badge>
                      ) : (
                        <Badge variant="danger">Revoked</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {stockLocationLabel(d.storeId)} · {d.agentId} ·{" "}
                      {d.lastSeenAt
                        ? `last seen ${formatDistanceToNow(new Date(d.lastSeenAt), { addSuffix: true })}`
                        : "never seen"}
                    </p>
                  </div>

                  {editable && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => rotate(d)}
                        disabled={busyId === d.id}
                        title="Issue a new key. The old one stops working immediately."
                      >
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        Rotate
                      </Button>
                      <Button
                        size="sm"
                        variant={d.isActive ? "destructive" : "outline"}
                        onClick={() => setActive(d, !d.isActive)}
                        disabled={busyId === d.id}
                      >
                        {d.isActive ? (
                          <>
                            <ShieldOff className="mr-1.5 h-3.5 w-3.5" />
                            Revoke
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                            Restore
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="px-1 text-xs leading-relaxed text-slate-400">
        Revoking keeps the device&apos;s counted history — it stops the key working, it does not
        delete data. “No heartbeat” means nothing has been heard for five minutes; the agent
        keeps counting locally and backfills when it reconnects.
      </p>
    </div>
  );
}
