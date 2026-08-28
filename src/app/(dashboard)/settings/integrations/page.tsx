"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft, Cloud, CheckCircle2, XCircle,
  Package, Users, Loader2, Clock,
  RefreshCw, FileText, ShoppingCart, ChevronDown, ChevronUp,
  BookOpen, Store, Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";

interface ZohoStatus {
  connected: boolean;
  organizationId?: string;
  organizationName?: string;
  lastSyncAt?: string;
  tokenValid?: boolean;
}

interface SourceStatus {
  connected: boolean;
  organizationId?: string;
  organizationName?: string;
  lastSyncAt?: string;
  tokenValid?: boolean;
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

const PULL_STEPS = [
  { key: "init", label: "Connecting", icon: Cloud, apiStep: "init" },
  { key: "items", label: "Items", icon: Package, apiStep: "items" },
  { key: "contacts", label: "Vendors", icon: Users, apiStep: "contacts" },
  { key: "bills", label: "Bills", icon: FileText, apiStep: "bills" },
  { key: "invoices", label: "Invoices", icon: ShoppingCart, apiStep: "invoices" },
  { key: "finalize", label: "Saving", icon: CheckCircle2, apiStep: "finalize" },
];

export default function ZohoSettingsPage() {
  const [status, setStatus] = useState<ZohoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [error, setError] = useState("");

  // Pull state
  const [pulling, setPulling] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(-1);
  const [stepMessage, setStepMessage] = useState("");
  const [pullDone, setPullDone] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pullCounts, setPullCounts] = useState({ itemsNew: 0, contactsNew: 0, billsNew: 0, invoicesNew: 0 });
  const [pullErrors, setPullErrors] = useState<string[]>([]);
  const [fullImport, setFullImport] = useState(false);

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

  // Zoho Inventory state
  const [invStatus, setInvStatus] = useState<SourceStatus | null>(null);
  const [invForm, setInvForm] = useState({ clientId: "", clientSecret: "", grantToken: "", orgId: "", orgName: "" });
  const [connectingInv, setConnectingInv] = useState(false);
  const [invError, setInvError] = useState("");
  const [invExpanded, setInvExpanded] = useState(false);

  // Books connect form expand (for not-connected state)
  const [booksExpanded, setBooksExpanded] = useState(false);

  useEffect(() => {
    fetchStatus();
    fetchLogs();
    fetch("/api/integrations/ZAKYA_POS/status").then(r => r.json()).then(d => { if (d.success) setPosStatus(d.data); }).catch(() => {});
    fetch("/api/integrations/ZOHO_INVENTORY/status").then(r => r.json()).then(d => { if (d.success) setInvStatus(d.data); }).catch(() => {});
  }, []);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/integrations/ZOHO_BOOKS/status");
      const data = await res.json();
      if (data.success) setStatus(data.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
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
      setStatus({ connected: false });
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
      setPosStatus({ connected: false });
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
      setInvStatus({ connected: false });
    } catch { /* ignore */ }
  }

  async function callStep(step: string, pullId: string, extras?: Record<string, unknown>) {
    const res = await fetch("/api/zoho/trigger-pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, pullId, ...extras }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || `Step ${step} failed`);
    return data.data;
  }

  async function handleTriggerPull() {
    if (!confirm("Pull new data from Zoho into preview for review?")) return;

    setPulling(true);
    setPullDone(false);
    setPullError(null);
    setPullCounts({ itemsNew: 0, contactsNew: 0, billsNew: 0, invoicesNew: 0 });
    setPullErrors([]);

    try {
      // Step 0: Init
      setCurrentStepIdx(0);
      setStepMessage("Connecting to Zoho...");
      const initResult = await callStep("init", "");
      const pullId = initResult.pullId;

      // Step 1: Items
      setCurrentStepIdx(1);
      setStepMessage(fullImport ? "Fetching ALL items (full import)..." : "Fetching items...");
      const itemsResult = await callStep("items", pullId, fullImport ? { fullImport: true } : undefined);
      const counts = { itemsNew: itemsResult.itemsNew || 0, contactsNew: 0, billsNew: 0, invoicesNew: 0 };
      const allErrors: string[] = [...(itemsResult.errors || [])];
      let totalApiCalls = itemsResult.apiCalls || 0;
      setPullCounts({ ...counts });
      setStepMessage(`${counts.itemsNew} new items found`);

      // Step 2: Contacts
      setCurrentStepIdx(2);
      setStepMessage("Fetching vendors...");
      const contactsResult = await callStep("contacts", pullId);
      counts.contactsNew = contactsResult.contactsNew || 0;
      allErrors.push(...(contactsResult.errors || []));
      totalApiCalls += contactsResult.apiCalls || 0;
      setPullCounts({ ...counts });
      setStepMessage(`${counts.contactsNew} new vendors found`);

      // Step 3: Bills
      setCurrentStepIdx(3);
      setStepMessage("Fetching bills...");
      const billsResult = await callStep("bills", pullId);
      counts.billsNew = billsResult.billsNew || 0;
      allErrors.push(...(billsResult.errors || []));
      totalApiCalls += billsResult.apiCalls || 0;
      setPullCounts({ ...counts });
      setStepMessage(`${counts.billsNew} new bills found`);

      // Step 4: Invoices
      setCurrentStepIdx(4);
      setStepMessage("Fetching invoices...");
      const invoicesResult = await callStep("invoices", pullId);
      counts.invoicesNew = invoicesResult.invoicesNew || 0;
      allErrors.push(...(invoicesResult.errors || []));
      totalApiCalls += invoicesResult.apiCalls || 0;
      setPullCounts({ ...counts });
      setStepMessage(`${counts.invoicesNew} new invoices found`);

      // Step 5: Finalize
      setCurrentStepIdx(5);
      setStepMessage("Saving pull log...");
      await callStep("finalize", pullId, {
        itemsNew: counts.itemsNew,
        contactsNew: counts.contactsNew,
        billsNew: counts.billsNew,
        invoicesNew: counts.invoicesNew,
        apiCalls: totalApiCalls,
        allErrors,
      });

      // Done!
      setPullCounts(counts);
      setPullErrors(allErrors);
      setPullDone(true);
      const total = counts.itemsNew + counts.contactsNew + counts.billsNew + counts.invoicesNew;
      setStepMessage(total > 0 ? "Pull complete! Review the data." : "No new data — everything synced!");
      setCurrentStepIdx(6); // All done
      fetchLogs();
    } catch (e) {
      setPullError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPulling(false);
    }
  }

  function dismissPull() {
    setPullDone(false);
    setPullError(null);
    setCurrentStepIdx(-1);
    setStepMessage("");
    setPullCounts({ itemsNew: 0, contactsNew: 0, billsNew: 0, invoicesNew: 0 });
    setPullErrors([]);
  }


  const showPullUI = pulling || pullDone || pullError;
  const progress = currentStepIdx >= 0 ? Math.min(Math.round(((pullDone ? 6 : currentStepIdx) / 6) * 100), 100) : 0;
  const totalNew = pullCounts.itemsNew + pullCounts.contactsNew + pullCounts.billsNew + pullCounts.invoicesNew;

  // Helper to render a connect form
  function renderConnectForm(
    form: { clientId: string; clientSecret: string; grantToken: string; orgId: string; orgName: string },
    setForm: (f: { clientId: string; clientSecret: string; grantToken: string; orgId: string; orgName: string }) => void,
    onSubmit: (e: React.FormEvent) => void,
    isConnecting: boolean,
    formError: string,
    label: string,
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
          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Client Secret *</label>
          <Input type="password" placeholder="XXXX..." value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} className="h-8 text-xs" />
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
        <Button type="submit" disabled={!form.clientId || !form.clientSecret || !form.grantToken || isConnecting} className="w-full min-h-[48px] bg-green-600 hover:bg-green-700 text-sm focus-ring">
          {isConnecting ? "Connecting..." : `Connect to ${label}`}
        </Button>
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
                    {posExpanded && renderConnectForm(posForm, setPosForm, handleConnectPos, connectingPos, posError, "Zakya POS")}
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
                    {invExpanded && renderConnectForm(invForm, setInvForm, handleConnectInv, connectingInv, invError, "Zoho Inventory")}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Books-specific sections (Pull, Import, History) — only when Books is connected */}
          {status?.connected && (
            <>
          {/* Pull from Zoho */}
          <Card className="mb-4 border-blue-200 bg-blue-50">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-blue-600" />
                <p className="text-sm font-semibold text-blue-900">Auto-Sync: Daily at 1 PM IST</p>
              </div>
              <p className="text-[11px] text-blue-700 mb-3">
                Pulls new vendors, items, bills, and invoices. All data goes to preview for approval first.
              </p>

              {/* Progress UI */}
              {showPullUI && (
                <div className="bg-white rounded-lg border border-blue-200 p-3 mb-3">
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-2">
                    {pullError ? (
                      <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                    ) : pullDone ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
                    )}
                    <p className="text-xs font-medium text-slate-700 flex-1">
                      {pullError || stepMessage}
                    </p>
                    {!pullError && (
                      <span className="text-xs font-bold text-blue-600 tabular-nums">{progress}%</span>
                    )}
                  </div>

                  {/* Progress bar */}
                  {!pullError && (
                    <div className="w-full bg-slate-100 rounded-full h-2 mb-3 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ease-out ${
                          pullDone ? "bg-green-500" : "bg-blue-500"
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}

                  {/* Step indicators */}
                  <div className="grid grid-cols-6 gap-1">
                    {PULL_STEPS.map((s, idx) => {
                      const Icon = s.icon;
                      const isDone = pullDone || idx < currentStepIdx;
                      const isActive = !pullDone && !pullError && idx === currentStepIdx;
                      return (
                        <div key={s.key} className="flex flex-col items-center">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center mb-0.5 transition-colors ${
                            isDone ? "bg-green-100" : isActive ? "bg-blue-100" : "bg-slate-100"
                          }`}>
                            {isDone ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                            ) : isActive ? (
                              <Loader2 className="h-3 w-3 text-blue-600 animate-spin" />
                            ) : (
                              <Icon className="h-3 w-3 text-slate-300" />
                            )}
                          </div>
                          <span className={`text-[11px] text-center leading-tight ${
                            isDone ? "text-green-600 font-medium" : isActive ? "text-blue-600 font-medium" : "text-slate-400"
                          }`}>{s.label}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Results grid */}
                  {pullDone && totalNew > 0 && (
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {[
                        { label: "Items", count: pullCounts.itemsNew, icon: Package },
                        { label: "Vendors", count: pullCounts.contactsNew, icon: Users },
                        { label: "Bills", count: pullCounts.billsNew, icon: FileText },
                        { label: "Invoices", count: pullCounts.invoicesNew, icon: ShoppingCart },
                      ].map((r) => {
                        const RIcon = r.icon;
                        return (
                          <div key={r.label} className="text-center p-1.5 rounded-lg bg-green-50 border border-green-100">
                            <RIcon className="h-3.5 w-3.5 text-green-600 mx-auto mb-0.5" />
                            <p className="text-sm font-bold text-green-800 tabular-nums">{r.count}</p>
                            <p className="text-[11px] text-green-600">{r.label}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Errors */}
                  {pullErrors.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-[11px] text-orange-600 cursor-pointer">{pullErrors.length} warning(s)</summary>
                      <div className="mt-1 space-y-0.5">
                        {pullErrors.map((e, i) => (
                          <p key={i} className="text-[11px] text-orange-500">{e}</p>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* Actions */}
                  {(pullDone || pullError) && !pulling && (
                    <div className="mt-3 flex gap-2">
                      <button onClick={dismissPull}
                        className="flex-1 min-h-[48px] text-sm text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50 focus-ring">
                        Dismiss
                      </button>
                      {pullDone && totalNew > 0 && (
                        <Link href="/settings/integrations/pull-review"
                          className="flex-1 min-h-[48px] flex items-center justify-center text-sm text-center text-white bg-green-600 rounded-lg font-medium hover:bg-green-700 focus-ring">
                          Review & Approve
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Full import toggle */}
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fullImport}
                  onChange={(e) => setFullImport(e.target.checked)}
                  disabled={pulling}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-600 tabular-nums">
                  Full import (all items, ~27 API calls for 5000+ items)
                </span>
              </label>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleTriggerPull}
                  disabled={pulling}
                  className="flex-1 min-h-[48px] flex items-center justify-center gap-1.5 bg-green-600 text-white px-3 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors focus-ring"
                >
                  {pulling ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {pulling ? "Pulling..." : fullImport ? "Full Import" : "Pull Now"}
                </button>
                <Link href="/settings/integrations/pull-review"
                  className="flex-1 min-h-[48px] flex items-center justify-center gap-1.5 border border-slate-200 text-slate-700 px-3 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors focus-ring">
                  <CheckCircle2 className="h-4 w-4" /> Review Pulls
                </Link>
              </div>
            </CardContent>
          </Card>


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
