"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle2, XCircle,
  Loader2, Clock,
  ChevronDown, ChevronUp,
  BookOpen, Store, Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";

// GET status now returns the SAVED details whether or not the integration is connected —
// disconnect only clears the tokens, so these survive it. `clientSecret` is never sent;
// `hasClientSecret` is the signal that one is stored, so the field can say "leave blank to
// keep" instead of forcing the admin to re-type a value they cannot read back.
interface ZohoStatus {
  connected: boolean;
  clientId?: string | null;
  hasClientSecret?: boolean;
  organizationId?: string | null;
  organizationName?: string | null;
  lastSyncAt?: string;
  tokenValid?: boolean;
  /**
   * Set when a token refresh was REFUSED (R1). `connected` cannot express this on its own —
   * it is only ever written by a successful connect, so a revoked refresh token leaves a
   * green "Connected" badge while every fetch reports "no new invoices". Cleared by the next
   * successful refresh.
   */
  lastAuthErrorAt?: string | null;
}

type SourceStatus = ZohoStatus;

/**
 * The line that stops a dead connection from looking healthy.
 *
 * Rendered only when the row says "connected" AND a refresh has been refused — the exact
 * combination that was previously invisible. A never-connected source already reads "Not
 * connected" and needs nothing extra.
 */
function TokenRefusedNotice({ status }: { status?: SourceStatus | null }) {
  if (!status?.connected || !status.lastAuthErrorAt) return null;
  const when = new Date(status.lastAuthErrorAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
      Token refused on {when} — reconnect. Fetches will return nothing until you do.
    </p>
  );
}

interface SyncLogEntry {
  id: string;
  syncType: string;
  status: string;
  totalItems: number;
  synced: number;
  failed: number;
  startedAt: string;
  completedAt?: string;
}

export default function ZohoSettingsPage() {
  const [status, setStatus] = useState<ZohoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [error, setError] = useState("");

  // Setup form (Books)
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [grantToken, setGrantToken] = useState("");
  const [orgId, setOrgId] = useState("");
  const [orgName, setOrgName] = useState("");

  // POS (Zakya) state
  const [posStatus, setPosStatus] = useState<SourceStatus | null>(null);
  const [posForm, setPosForm] = useState({ clientId: "", clientSecret: "", grantToken: "", orgId: "", orgName: "" });
  const [connectingPos, setConnectingPos] = useState(false);
  const [posError, setPosError] = useState("");
  const [posExpanded, setPosExpanded] = useState(false);
  const [savingPos, setSavingPos] = useState(false);

  // Zoho Inventory state
  const [invStatus, setInvStatus] = useState<SourceStatus | null>(null);
  const [invForm, setInvForm] = useState({ clientId: "", clientSecret: "", grantToken: "", orgId: "", orgName: "" });
  const [connectingInv, setConnectingInv] = useState(false);
  const [invError, setInvError] = useState("");
  const [invExpanded, setInvExpanded] = useState(false);
  const [savingInv, setSavingInv] = useState(false);

  // Books connect form expand (for not-connected state)
  const [booksExpanded, setBooksExpanded] = useState(false);

  useEffect(() => {
    fetchStatus();
    fetchLogs();
    fetchPosStatus();
    fetchInvStatus();
  }, []);

  // Each fetch also PREFILLS its form. The saved client id and organisation details live in
  // integration_config and survive a disconnect, so the screen shows them rather than making
  // the admin find them again. The secret is never sent — the field stays blank and means
  // "keep the stored one" unless something is typed.
  async function fetchPosStatus() {
    try {
      const d = await (await fetch("/api/integrations/ZAKYA_POS/status")).json();
      if (d.success) {
        setPosStatus(d.data);
        setPosForm((f) => ({
          ...f,
          clientId: d.data.clientId || "",
          orgId: d.data.organizationId || "",
          orgName: d.data.organizationName || "",
        }));
      }
    } catch { /* the card renders as not-connected; nothing else to do */ }
  }

  async function fetchInvStatus() {
    try {
      const d = await (await fetch("/api/integrations/ZOHO_INVENTORY/status")).json();
      if (d.success) {
        setInvStatus(d.data);
        setInvForm((f) => ({
          ...f,
          clientId: d.data.clientId || "",
          orgId: d.data.organizationId || "",
          orgName: d.data.organizationName || "",
        }));
      }
    } catch { /* as above */ }
  }

  async function fetchStatus() {
    try {
      const res = await fetch("/api/integrations/ZOHO_BOOKS/status");
      const data = await res.json();
      if (data.success) {
        setStatus(data.data);
        setClientId(data.data.clientId || "");
        setOrgId(data.data.organizationId || "");
        setOrgName(data.data.organizationName || "");
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  /**
   * Save client and organisation details WITHOUT connecting.
   *
   * A blank secret means "keep the stored one", so an organisation name can be corrected
   * without re-typing a credential. Returns true on success so the caller can clear its
   * error state.
   */
  async function saveDetails(
    provider: "ZOHO_BOOKS" | "ZAKYA_POS" | "ZOHO_INVENTORY",
    details: { clientId: string; clientSecret: string; orgId: string; orgName: string },
  ): Promise<string | null> {
    try {
      const res = await fetch(`/api/integrations/${provider}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: details.clientId,
          // Omit rather than send "" — the API reads a blank as "keep the stored secret".
          ...(details.clientSecret ? { clientSecret: details.clientSecret } : {}),
          organizationId: details.orgId,
          organizationName: details.orgName,
        }),
      });
      const data = await res.json();
      return data.success ? null : (data.error || "Could not save");
    } catch {
      return "Network error while saving";
    }
  }

  async function fetchLogs() {
    try {
      const res = await fetch("/api/zoho/sync/logs?limit=10");
      const data = await res.json();
      if (data.success) setLogs(data.data);
    } catch { /* ignore */ }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setError("");
    try {
      const res = await fetch("/api/integrations/ZOHO_BOOKS/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret, grantToken, organizationId: orgId, organizationName: orgName }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchStatus();
        setClientId(""); setClientSecret(""); setGrantToken("");
      } else {
        setError(data.error || "Connection failed");
      }
    } catch { setError("Network error"); }
    finally { setConnecting(false); }
  }

  async function handleDisconnect() {
    try {
      await fetch("/api/integrations/ZOHO_BOOKS/disconnect", { method: "POST" });
      // Re-read rather than setStatus({ connected: false }): disconnect clears only the
      // tokens, so the client id and organisation details are still there and must stay
      // on screen. Blanking the status locally is what made it look like they were lost.
      await fetchStatus();
      setGrantToken("");
    } catch { /* ignore */ }
  }

  async function handleConnectPos(e: React.FormEvent) {
    e.preventDefault();
    setConnectingPos(true);
    setPosError("");
    try {
      const res = await fetch("/api/integrations/ZAKYA_POS/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: posForm.clientId, clientSecret: posForm.clientSecret,
          grantToken: posForm.grantToken, organizationId: posForm.orgId, organizationName: posForm.orgName,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const statusRes = await fetch("/api/integrations/ZAKYA_POS/status");
        const statusData = await statusRes.json();
        if (statusData.success) setPosStatus(statusData.data);
        setPosForm({ clientId: "", clientSecret: "", grantToken: "", orgId: "", orgName: "" });
        setPosExpanded(false);
      } else {
        setPosError(data.error || "Connection failed");
      }
    } catch { setPosError("Network error"); }
    finally { setConnectingPos(false); }
  }

  async function handleDisconnectPos() {
    try {
      await fetch("/api/integrations/ZAKYA_POS/disconnect", { method: "POST" });
      // Re-read: the saved credentials survive a disconnect and must stay on screen.
      await fetchPosStatus();
      setPosForm((f) => ({ ...f, grantToken: "" }));
    } catch { /* ignore */ }
  }

  async function handleConnectInv(e: React.FormEvent) {
    e.preventDefault();
    setConnectingInv(true);
    setInvError("");
    try {
      const res = await fetch("/api/integrations/ZOHO_INVENTORY/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: invForm.clientId, clientSecret: invForm.clientSecret,
          grantToken: invForm.grantToken, organizationId: invForm.orgId, organizationName: invForm.orgName,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const statusRes = await fetch("/api/integrations/ZOHO_INVENTORY/status");
        const statusData = await statusRes.json();
        if (statusData.success) setInvStatus(statusData.data);
        setInvForm({ clientId: "", clientSecret: "", grantToken: "", orgId: "", orgName: "" });
        setInvExpanded(false);
      } else {
        setInvError(data.error || "Connection failed");
      }
    } catch { setInvError("Network error"); }
    finally { setConnectingInv(false); }
  }

  async function handleDisconnectInv() {
    try {
      await fetch("/api/integrations/ZOHO_INVENTORY/disconnect", { method: "POST" });
      // Re-read: the saved credentials survive a disconnect and must stay on screen.
      await fetchInvStatus();
      setInvForm((f) => ({ ...f, grantToken: "" }));
    } catch { /* ignore */ }
  }

  // Helper to render a connect form
  function renderConnectForm(
    form: { clientId: string; clientSecret: string; grantToken: string; orgId: string; orgName: string },
    setForm: (f: { clientId: string; clientSecret: string; grantToken: string; orgId: string; orgName: string }) => void,
    onSubmit: (e: React.FormEvent) => void,
    isConnecting: boolean,
    formError: string,
    label: string,
    // True once a client secret is stored. The field then means "leave blank to keep",
    // because the secret is never sent to the browser and cannot be shown.
    hasSavedSecret = false,
    onSave?: () => void,
    isSaving = false,
  ) {
    return (
      <form onSubmit={onSubmit} className="mt-2 space-y-2">
        {formError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2">
            <p className="text-xs text-red-700">{formError}</p>
          </div>
        )}
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Client ID *</label>
          <Input placeholder="1000.XXXX..." value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="h-8 text-xs" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">
            Client Secret {hasSavedSecret ? "" : "*"}
          </label>
          <Input type="password" placeholder={hasSavedSecret ? "Saved — leave blank to keep" : "XXXX..."} value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} className="h-8 text-xs" />
          {hasSavedSecret && (
            <p className="text-[11px] text-slate-400 mt-0.5">A secret is stored. Type a new one only to replace it.</p>
          )}
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Grant Token *</label>
          <Input type="password" placeholder="1000.XXXX..." value={form.grantToken} onChange={(e) => setForm({ ...form, grantToken: e.target.value })} className="h-8 text-xs" />
          <p className="text-[11px] text-slate-400 mt-0.5">Expires in 2 min — paste quickly</p>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Organization ID</label>
          <Input placeholder="123456789" value={form.orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })} className="h-8 text-xs tabular-nums" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Organization Name</label>
          <Input placeholder="My Bike Store" value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} className="h-8 text-xs" />
        </div>
        <div className="flex gap-2">
          {onSave && (
            <Button type="button" variant="outline" onClick={onSave} disabled={!form.clientId || (!form.clientSecret && !hasSavedSecret) || isSaving} className="flex-1 min-h-[48px] text-sm focus-ring">
              {isSaving ? "Saving..." : "Save details"}
            </Button>
          )}
          {/* The secret is only required when none is stored. Once saved, reconnecting needs
              a fresh grant token and nothing else — Zoho will not reissue a refresh token for
              a spent grant, so that step can never be removed. */}
          <Button type="submit" disabled={!form.clientId || (!form.clientSecret && !hasSavedSecret) || !form.grantToken || isConnecting} className="flex-1 min-h-[48px] bg-green-600 hover:bg-green-700 text-sm focus-ring">
            {isConnecting ? "Connecting..." : `Connect to ${label}`}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/more" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Zoho Settings</h1>
          <p className="text-xs text-slate-500">Manage Zoho connections</p>
        </div>
      </div>

      {loading ? (
        <SkeletonList count={3} />
      ) : (
        <>
          {/* 3-Source Connection Cards */}
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Connections</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mb-4">
            {/* Zoho Books Card */}
            <Card className={`border ${status?.connected ? "border-green-200 bg-green-50" : "border-slate-200"}`}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-slate-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">Zoho Books</p>
                    <p className="text-[11px] text-slate-500">Bills & Vendors</p>
                  </div>
                  <Badge variant={status?.connected ? "success" : "danger"} className="text-[11px] shrink-0">
                    {status?.connected ? "Connected" : "Not connected"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  {status?.connected ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  )}
                  <span className="text-[11px] text-slate-500 tabular-nums">1000 calls/day</span>
                  {status?.connected && status.lastSyncAt && (
                    <>
                      <span className="text-[11px] text-slate-300">|</span>
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        Last sync: {new Date(status.lastSyncAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </>
                  )}
                </div>
                <TokenRefusedNotice status={status} />
                {status?.connected ? (
                  <button onClick={handleDisconnect} className="mt-2 w-full min-h-[48px] flex items-center justify-center rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50 font-medium focus-ring">
                    Disconnect
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setBooksExpanded(!booksExpanded)}
                      className="mt-2 flex items-center gap-1 text-sm text-green-700 hover:text-green-800 font-medium focus-ring rounded-lg"
                    >
                      Connect {booksExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    {booksExpanded && (
                      <form onSubmit={handleConnect} className="mt-2 space-y-2">
                        {error && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                            <p className="text-xs text-red-700">{error}</p>
                          </div>
                        )}
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Client ID *</label>
                          <Input placeholder="1000.XXXX..." value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-8 text-xs" />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Client Secret *</label>
                          <Input type="password" placeholder="XXXX..." value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} className="h-8 text-xs" />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Grant Token *</label>
                          <Input type="password" placeholder="1000.XXXX..." value={grantToken} onChange={(e) => setGrantToken(e.target.value)} className="h-8 text-xs" />
                          <p className="text-[11px] text-slate-400 mt-0.5">Expires in 2 min — paste quickly</p>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Organization ID</label>
                          <Input placeholder="123456789" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="h-8 text-xs tabular-nums" />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Organization Name</label>
                          <Input placeholder="My Bike Store" value={orgName} onChange={(e) => setOrgName(e.target.value)} className="h-8 text-xs" />
                        </div>
                        <Button type="submit" disabled={!clientId || !clientSecret || !grantToken || connecting} className="w-full min-h-[48px] bg-green-600 hover:bg-green-700 text-sm focus-ring">
                          {connecting ? "Connecting..." : "Connect to Zoho Books"}
                        </Button>
                      </form>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Zakya POS Card */}
            <Card className={`border ${posStatus?.connected ? "border-green-200 bg-green-50" : "border-slate-200"}`}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <Store className="h-5 w-5 text-slate-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">Zakya POS</p>
                    <p className="text-[11px] text-slate-500">Sales & Invoices</p>
                  </div>
                  <Badge variant={posStatus?.connected ? "success" : "danger"} className="text-[11px] shrink-0">
                    {posStatus?.connected ? "Connected" : "Not connected"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  {posStatus?.connected ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  )}
                  <span className="text-[11px] text-slate-500 tabular-nums">2500 calls/day</span>
                  {posStatus?.connected && posStatus.lastSyncAt && (
                    <>
                      <span className="text-[11px] text-slate-300">|</span>
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        Last sync: {new Date(posStatus.lastSyncAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </>
                  )}
                </div>
                <TokenRefusedNotice status={posStatus} />
                {posStatus?.connected ? (
                  <button onClick={handleDisconnectPos} className="mt-2 w-full min-h-[48px] flex items-center justify-center rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50 font-medium focus-ring">
                    Disconnect
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setPosExpanded(!posExpanded)}
                      className="mt-2 flex items-center gap-1 text-sm text-green-700 hover:text-green-800 font-medium focus-ring rounded-lg"
                    >
                      Connect {posExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    {posExpanded && renderConnectForm(posForm, setPosForm, handleConnectPos, connectingPos, posError, "Zakya POS", Boolean(posStatus?.hasClientSecret), async () => {
                      setSavingPos(true);
                      const err = await saveDetails("ZAKYA_POS", posForm);
                      setPosError(err || "");
                      if (!err) { await fetchPosStatus(); setPosForm((f) => ({ ...f, clientSecret: "" })); }
                      setSavingPos(false);
                    }, savingPos)}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Zoho Inventory Card */}
            <Card className={`border ${invStatus?.connected ? "border-green-200 bg-green-50" : "border-slate-200"}`}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <Boxes className="h-5 w-5 text-slate-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">Zoho Inventory</p>
                    <p className="text-[11px] text-slate-500">Items & Stock</p>
                  </div>
                  <Badge variant={invStatus?.connected ? "success" : "danger"} className="text-[11px] shrink-0">
                    {invStatus?.connected ? "Connected" : "Not connected"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  {invStatus?.connected ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  )}
                  <span className="text-[11px] text-slate-500 tabular-nums">1000 calls/day</span>
                  {invStatus?.connected && invStatus.lastSyncAt && (
                    <>
                      <span className="text-[11px] text-slate-300">|</span>
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        Last sync: {new Date(invStatus.lastSyncAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </>
                  )}
                </div>
                <TokenRefusedNotice status={invStatus} />
                {invStatus?.connected ? (
                  <button onClick={handleDisconnectInv} className="mt-2 w-full min-h-[48px] flex items-center justify-center rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50 font-medium focus-ring">
                    Disconnect
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setInvExpanded(!invExpanded)}
                      className="mt-2 flex items-center gap-1 text-sm text-green-700 hover:text-green-800 font-medium focus-ring rounded-lg"
                    >
                      Connect {invExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    {invExpanded && renderConnectForm(invForm, setInvForm, handleConnectInv, connectingInv, invError, "Zoho Inventory", Boolean(invStatus?.hasClientSecret), async () => {
                      setSavingInv(true);
                      const err = await saveDetails("ZOHO_INVENTORY", invForm);
                      setInvError(err || "");
                      if (!err) { await fetchInvStatus(); setInvForm((f) => ({ ...f, clientSecret: "" })); }
                      setSavingInv(false);
                    }, savingInv)}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Books-specific sections — only when Books is connected. The manual pull card
              that used to live here is gone: it advertised an "Auto-Sync: Daily at 1 PM IST"
              that has not existed since the cron removal, and each of bills and invoices is
              now pulled from the screen that owns it (/inbound, /bills, /receivables,
              /deliveries), each with its own inline review. */}
          {status?.connected && (
            <>
          {/* Sync History */}
          {logs.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Sync History</h2>
              <div className="space-y-1">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-lg">
                    <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 capitalize">{log.syncType}</p>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        {new Date(log.startedAt).toLocaleString("en-IN")} — {log.synced}/{log.totalItems} synced
                      </p>
                    </div>
                    <Badge variant={log.status === "success" ? "success" : log.status === "partial" ? "warning" : "danger"} className="text-[11px]">
                      {log.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

            </>
          )}

          {/* Cleanup Section */}
          <CleanupSection />
        </>
      )}
    </div>
  );
}

function CleanupSection() {
  const [preview, setPreview] = useState<{ transactions: number; verifiedTransactions: number; vendorBills: number; previews: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");

  async function loadPreview() {
    setLoading(true);
    try {
      const res = await fetch("/api/inventory/cleanup").then((r) => r.json());
      if (res.success) setPreview(res.data.wouldDelete);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function runCleanup(reverse: boolean) {
    const msg = reverse
      ? "This will DELETE all Zoho transactions/bills AND REVERSE stock changes (undo all verified putaway). Stock counts are preserved. Continue?"
      : "This will DELETE all Zoho transactions/bills but KEEP current stock levels. Continue?";
    if (!confirm(msg)) return;
    setLoading(true);
    setResult("");
    try {
      const res = await fetch(`/api/inventory/cleanup?reverse=${reverse}`, { method: "DELETE" }).then((r) => r.json());
      if (res.success) {
        const d = res.data.deleted;
        setResult(
          `Deleted ${d.transactions} transactions, ${d.vendorBills} bills, ${d.previews} previews, ${d.pullLogs} pull logs` +
          (res.data.reversed ? ` | Reversed stock on ${res.data.stockReversals} items` : " | Stock kept as-is")
        );
        setPreview(null);
      } else {
        setResult(res.error || "Failed");
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Failed");
    }
    setLoading(false);
  }

  return (
    <Card className="mt-4 border-red-200">
      <CardContent className="p-3">
        <h2 className="text-sm font-semibold text-red-700 mb-1">Cleanup Zoho Imports</h2>
        <p className="text-[11px] text-slate-500 mb-2">
          Delete all Zoho-imported transactions and vendor bills. Stock count entries are preserved.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={loadPreview} disabled={loading} className="text-xs h-9 focus-ring">
            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null} Preview
          </Button>
          {preview && (
            <>
              <Button size="sm" variant="destructive" onClick={() => runCleanup(true)} disabled={loading} className="text-xs h-9 focus-ring">
                Delete & Reverse Stock ({preview.verifiedTransactions} verified)
              </Button>
              <Button size="sm" variant="outline" onClick={() => runCleanup(false)} disabled={loading} className="text-xs h-9 border-red-200 text-red-600 focus-ring">
                Delete & Keep Stock
              </Button>
            </>
          )}
        </div>
        {preview && (
          <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
            {preview.transactions} transactions ({preview.verifiedTransactions} verified) | {preview.vendorBills} bills | {preview.previews} previews
          </p>
        )}
        {result && <p className="text-xs text-green-700 mt-2">{result}</p>}
      </CardContent>
    </Card>
  );
}
