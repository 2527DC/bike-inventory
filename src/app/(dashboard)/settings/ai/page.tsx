"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles, Loader2, Check, X, AlertTriangle, ArrowLeft, ExternalLink,
  BarChart3, RefreshCw, Zap, Clock, Coins, Layers, ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiTry } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import type { AiProviderKey } from "@/lib/ai/models";

// Settings → AI.
//
// One card per catalogued provider. A key is write-only: the API never returns it in any
// form, so the input is always blank and its placeholder says whether one is stored. The
// typed key lives in state only until the save request returns, then the field is blanked
// whether or not the save succeeded. A reload after Test or Make live keeps whatever is
// typed, and both of those buttons are held off while an unsaved key is in the field.

interface ProviderEntry {
  key: AiProviderKey;
  label: string;
  model: string | null;
  defaultModel: string;
  models: { id: string; label: string }[];
  hasApiKey: boolean;
  isActive: boolean;
  isConnected: boolean;
  lastTestedAt: string | null;
  lastTestError: string | null;
  supports: { pdf: boolean; image: boolean };
  keyHint: string;
  keyUrl: string;
}

interface AiConfig {
  providers: ProviderEntry[];
  activeProvider: AiProviderKey | null;
  configured: boolean;
}

interface TestResult {
  ok: boolean;
  provider: AiProviderKey;
  model: string;
  latencyMs: number;
  error: string | null;
}

type Draft = { model: string; apiKey: string };
type Action = "save" | "remove" | "test" | "activate";

interface AnalyticsSummary {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  successRate: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  totalCostInr: number;
  avgLatencyMs: number;
}

interface AnalyticsPurpose {
  purpose: string;
  label: string;
  calls: number;
  tokens: number;
  costUsd: number;
  costInr: number;
}

interface AnalyticsProvider {
  providerKey: string;
  model: string;
  calls: number;
  tokens: number;
  costUsd: number;
  costInr: number;
}

interface AnalyticsDaily {
  date: string;
  calls: number;
  tokens: number;
  costUsd: number;
  costInr: number;
}

interface AnalyticsRecentLog {
  id: string;
  purpose: string;
  label: string;
  providerKey: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  costInr: number;
  latencyMs: number;
  ok: boolean;
  errorKind: string | null;
  createdAt: string;
}

interface AnalyticsResponse {
  summary: AnalyticsSummary;
  byPurpose: AnalyticsPurpose[];
  byProvider: AnalyticsProvider[];
  daily: AnalyticsDaily[];
  recentLogs: AnalyticsRecentLog[];
}

export default function AiSettingsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canEdit = can("settings_ai", "edit");
  const canApprove = can("settings_ai", "approve");

  const [config, setConfig] = useState<AiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Per-provider drafts. The key field starts blank and is blanked again after every save.
  const [drafts, setDrafts] = useState<Partial<Record<AiProviderKey, Draft>>>({});
  const [busy, setBusy] = useState<{ provider: AiProviderKey; action: Action } | null>(null);
  const [results, setResults] = useState<Partial<Record<AiProviderKey, TestResult>>>({});
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [activeTab, setActiveTab] = useState<"config" | "analytics">("config");
  const [analyticsRange, setAnalyticsRange] = useState<"today" | "7d" | "30d" | "this_month" | "all">("30d");
  const [analyticsData, setAnalyticsData] = useState<AnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");

  const loadAnalytics = useCallback(async (range: string) => {
    setAnalyticsLoading(true);
    setAnalyticsError("");
    const { data, error: err } = await apiTry<AnalyticsResponse>(`/api/settings/ai/analytics?range=${range}`);
    if (err || !data) {
      setAnalyticsError(err || "Failed to load analytics data.");
    } else {
      setAnalyticsData(data);
    }
    setAnalyticsLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab === "analytics") {
      void loadAnalytics(analyticsRange);
    }
  }, [activeTab, analyticsRange, loadAnalytics]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await apiTry<AiConfig>("/api/settings/ai");
    if (err || !data) {
      setError(err || "Could not load the AI settings.");
    } else {
      setConfig(data);
      // Merge into the drafts, never replace them. Test and Make live reload afterwards, and
      // a key that was typed but not yet saved must survive that — otherwise the admin sees
      // the field go blank and believes the new key was tested, when it was never sent.
      // save() and removeKey() blank the field themselves before they reload.
      setDrafts((prev) => {
        const next: Partial<Record<AiProviderKey, Draft>> = {};
        for (const p of data.providers) {
          next[p.key] = {
            model: prev[p.key]?.model ?? (p.model || p.defaultModel),
            apiKey: prev[p.key]?.apiKey ?? "",
          };
        }
        return next;
      });
      setError("");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function draftOf(p: ProviderEntry): Draft {
    return drafts[p.key] ?? { model: p.model || p.defaultModel, apiKey: "" };
  }

  function setDraft(key: AiProviderKey, patch: Partial<Draft>) {
    setDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { model: "", apiKey: "" }), ...patch },
    }));
  }

  async function save(p: ProviderEntry) {
    const draft = draftOf(p);
    setBusy({ provider: p.key, action: "save" });
    setNotice(null);
    setResults((r) => ({ ...r, [p.key]: undefined }));
    const { data, error: err } = await apiTry<ProviderEntry>("/api/settings/ai", {
      method: "PUT",
      // The key goes only when something was typed — blank means "keep what is stored".
      json: {
        provider: p.key,
        model: draft.model,
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      },
    });
    // Blank the key field the moment the request is answered, success or not. On success the
    // model is pinned to what the server stored as well, so the merge in load() does not
    // keep a stale draft on top of it.
    setDraft(p.key, {
      apiKey: "",
      ...(!err && data ? { model: data.model || data.defaultModel } : {}),
    });
    setNotice(
      err ? { ok: false, text: err } : { ok: true, text: `${p.label} saved. Now run a test.` }
    );
    setBusy(null);
    if (!err) await load();
  }

  async function removeKey(p: ProviderEntry) {
    const warning = p.isActive
      ? `${p.label} is the live provider. Removing its key stops statement parsing, screenshot scanning and catalogue import until another provider is made live. Remove it?`
      : `Remove the saved ${p.label} key?`;
    if (!window.confirm(warning)) return;
    setBusy({ provider: p.key, action: "remove" });
    setNotice(null);
    setResults((r) => ({ ...r, [p.key]: undefined }));
    const { error: err } = await apiTry("/api/settings/ai", {
      method: "PUT",
      json: { provider: p.key, clearApiKey: true },
    });
    setDraft(p.key, { apiKey: "" });
    setNotice(err ? { ok: false, text: err } : { ok: true, text: `${p.label} key removed.` });
    setBusy(null);
    if (!err) await load();
  }

  async function runTest(p: ProviderEntry) {
    setBusy({ provider: p.key, action: "test" });
    setNotice(null);
    setResults((r) => ({ ...r, [p.key]: undefined }));
    const { data, error: err } = await apiTry<TestResult>("/api/settings/ai/test", {
      method: "POST",
      json: { provider: p.key },
    });
    if (err || !data) setNotice({ ok: false, text: err || "The test could not run." });
    else setResults((r) => ({ ...r, [p.key]: data }));
    setBusy(null);
    await load();
  }

  async function activate(p: ProviderEntry) {
    setBusy({ provider: p.key, action: "activate" });
    setNotice(null);
    setResults((r) => ({ ...r, [p.key]: undefined }));
    const { error: err } = await apiTry<{ activeProvider: AiProviderKey }>(
      "/api/settings/ai/activate",
      { method: "POST", json: { provider: p.key } }
    );
    setNotice(err ? { ok: false, text: err } : { ok: true, text: `${p.label} is now live.` });
    setBusy(null);
    await load();
  }

  if (loading || permsLoading) return <SkeletonList />;

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-6 w-6 text-amber-500 mx-auto mb-2" />
          <p className="text-sm text-slate-700">{error}</p>
          <Button className="mt-3" onClick={() => void load()}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  const live = config?.providers.find((p) => p.isActive) ?? null;

  function card(p: ProviderEntry) {
    const draft = draftOf(p);
    const mine = busy?.provider === p.key ? busy.action : null;
    const anyBusy = busy !== null;
    const result = results[p.key];
    // Test and Make live read the SAVED row. A key sitting unsaved in the input would be
    // ignored by both, and the admin would take the result as a verdict on the new key.
    const unsavedKey = draft.apiKey.trim() !== "";

    return (
      <Card key={p.key}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
              <Sparkles className="h-4.5 w-4.5 text-slate-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">{p.label}</p>
              <p className="text-[11px] text-slate-500 truncate">
                {p.hasApiKey ? "Key saved" : "No key saved"}
                {p.lastTestedAt && (
                  <> · last tested {new Date(p.lastTestedAt).toLocaleString()}</>
                )}
              </p>
            </div>
            <span
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                p.isActive && p.isConnected
                  ? "bg-green-100 text-green-800"
                  : p.isActive
                    ? "bg-amber-100 text-amber-800"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {p.isActive && p.isConnected ? "Live" : p.isActive ? "Live · untested" : "Not live"}
            </span>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
            <div className="flex items-center gap-2">
              <label htmlFor={`${p.key}-model`} className="text-[11px] text-slate-500 w-32 shrink-0">
                Model
              </label>
              <select
                id={`${p.key}-model`}
                value={draft.model}
                onChange={(e) => setDraft(p.key, { model: e.target.value })}
                disabled={!canEdit || anyBusy}
                className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs focus-ring disabled:opacity-50"
              >
                {p.models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor={`${p.key}-key`} className="text-[11px] text-slate-500 w-32 shrink-0">
                API key
              </label>
              <Input
                id={`${p.key}-key`}
                type="password"
                autoComplete="new-password"
                value={draft.apiKey}
                onChange={(e) => setDraft(p.key, { apiKey: e.target.value })}
                placeholder={p.hasApiKey ? "A key is saved — paste a new one to replace it" : p.keyHint}
                disabled={!canEdit || anyBusy}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-32 shrink-0" aria-hidden="true" />
              <a
                href={p.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-900 focus-ring rounded"
              >
                Get a key <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {!p.supports.pdf && (
              <p className="text-[10px] text-amber-700 leading-relaxed bg-amber-50 rounded-lg p-2">
                Cannot read PDF documents — the catalogue import needs another provider
              </p>
            )}

            {p.lastTestError && !result && (
              <p className="text-[10px] text-red-700 leading-relaxed bg-red-50 rounded-lg p-2">
                <strong>Last test failed:</strong> {p.lastTestError}
              </p>
            )}

            {result && (
              <div className="flex items-start gap-2">
                {result.ok ? (
                  <Check className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
                ) : (
                  <X className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-700">
                    {result.ok ? `Answered in ${result.latencyMs} ms` : result.error || "Test failed"}
                  </p>
                  <p className="text-[10px] text-slate-500">{result.model}</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={() => void save(p)} disabled={!canEdit || anyBusy}>
                {mine === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {mine === "save" ? "Saving..." : "Save"}
              </Button>
              {p.hasApiKey && (
                <Button variant="outline" onClick={() => void removeKey(p)} disabled={!canEdit || anyBusy}>
                  {mine === "remove" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Remove key
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => void runTest(p)}
                disabled={!canEdit || anyBusy || unsavedKey}
                title={unsavedKey ? "Save the key first" : undefined}
              >
                {mine === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Test
              </Button>
              <Button
                onClick={() => void activate(p)}
                disabled={!canApprove || anyBusy || p.isActive || !p.hasApiKey || unsavedKey}
                title={
                  p.isActive
                    ? "This is the live provider"
                    : unsavedKey
                      ? "Save the key first"
                      : !p.hasApiKey
                        ? "Save a key first"
                        : !canApprove
                          ? "Needs the approve permission"
                          : undefined
                }
              >
                {mine === "activate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {p.isActive ? "Live" : "Make live"}
              </Button>
            </div>

            {unsavedKey && (
              <p className="text-[10px] text-slate-500">Save the key before testing it.</p>
            )}

            {!canEdit && (
              <p className="text-[10px] text-slate-400">
                You can view these settings but not change them.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderAnalytics() {
    if (analyticsLoading && !analyticsData) {
      return (
        <Card className="border border-slate-200">
          <CardContent className="p-6">
            <SkeletonList count={4} />
          </CardContent>
        </Card>
      );
    }

    if (analyticsError && !analyticsData) {
      return (
        <div className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
          <span>{analyticsError}</span>
          <Button size="sm" variant="outline" onClick={() => void loadAnalytics(analyticsRange)}>
            Retry
          </Button>
        </div>
      );
    }

    const summary = analyticsData?.summary;
    const byPurpose = analyticsData?.byPurpose || [];
    const byProvider = analyticsData?.byProvider || [];
    const recentLogs = analyticsData?.recentLogs || [];

    const totalSpendInr = summary ? summary.totalCostInr : 0;
    const totalSpendUsd = summary ? summary.totalCostUsd : 0;

    return (
      <div className="space-y-4">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
            {(
              [
                { id: "today", label: "Today" },
                { id: "7d", label: "Last 7 Days" },
                { id: "30d", label: "Last 30 Days" },
                { id: "this_month", label: "This Month" },
                { id: "all", label: "All Time" },
              ] as const
            ).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setAnalyticsRange(r.id)}
                className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
                  analyticsRange === r.id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadAnalytics(analyticsRange)}
            disabled={analyticsLoading}
            className="h-8 text-xs gap-1.5 border-slate-200 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${analyticsLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* 4 KPI Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="border border-slate-200 shadow-sm bg-white">
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-[11px] font-medium uppercase tracking-wider">Total Spend</span>
                <Coins className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="text-xl font-bold text-slate-900">
                ₹{totalSpendInr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>${totalSpendUsd.toFixed(4)} USD</span>
                <span className="text-[10px] text-slate-400">@ ₹85 / $1</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 shadow-sm bg-white">
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-[11px] font-medium uppercase tracking-wider">Total Tokens</span>
                <Zap className="h-4 w-4 text-amber-500" />
              </div>
              <div className="text-xl font-bold text-slate-900">
                {summary?.totalTokens.toLocaleString() || 0}
              </div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <span>In: {summary?.promptTokens.toLocaleString() || 0}</span>
                <span>·</span>
                <span>Out: {summary?.completionTokens.toLocaleString() || 0}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 shadow-sm bg-white">
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-[11px] font-medium uppercase tracking-wider">API Requests</span>
                <Layers className="h-4 w-4 text-indigo-500" />
              </div>
              <div className="text-xl font-bold text-slate-900">
                {summary?.totalCalls.toLocaleString() || 0}
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <Badge variant={summary && summary.failedCalls > 0 ? "warning" : "success"} className="text-[10px] px-1.5 py-0">
                  {summary?.successRate ?? 100}% Success
                </Badge>
                {summary && summary.failedCalls > 0 && (
                  <span className="text-red-600 text-[10px]">{summary.failedCalls} failed</span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 shadow-sm bg-white">
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-[11px] font-medium uppercase tracking-wider">Avg Latency</span>
                <Clock className="h-4 w-4 text-blue-500" />
              </div>
              <div className="text-xl font-bold text-slate-900">
                {summary && summary.avgLatencyMs > 0 ? `${(summary.avgLatencyMs / 1000).toFixed(2)}s` : "0s"}
              </div>
              <div className="text-[11px] text-slate-500">
                {summary?.avgLatencyMs || 0} ms response time
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Breakdown by Feature & Provider in 2 columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Feature Spend Breakdown */}
          <Card className="border border-slate-200 shadow-sm bg-white">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">Spend by Feature</h2>
                <span className="text-[11px] text-slate-400">{byPurpose.length} features active</span>
              </div>

              {byPurpose.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">No AI calls recorded for this period.</p>
              ) : (
                <div className="space-y-3 pt-1">
                  {byPurpose.map((item) => {
                    const pct = totalSpendUsd > 0 ? Math.min(100, Math.round((item.costUsd / totalSpendUsd) * 100)) : 0;
                    return (
                      <div key={item.purpose} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-800">{item.label}</span>
                          <span className="font-semibold text-slate-900">
                            ₹{item.costInr.toFixed(2)}{" "}
                            <span className="text-[10px] font-normal text-slate-400">(${item.costUsd.toFixed(4)})</span>
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div className="bg-slate-900 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>{item.calls} requests · {item.tokens.toLocaleString()} tokens</span>
                          <span>{pct}% of spend</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Provider & Model Distribution */}
          <Card className="border border-slate-200 shadow-sm bg-white">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">Provider & Model Spend</h2>
                <span className="text-[11px] text-slate-400">{byProvider.length} models used</span>
              </div>

              {byProvider.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">No model usage recorded for this period.</p>
              ) : (
                <div className="space-y-2.5 pt-1">
                  {byProvider.map((item) => (
                    <div
                      key={`${item.providerKey}:${item.model}`}
                      className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 flex items-center justify-between"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="default" className="text-[10px] uppercase font-semibold">
                            {item.providerKey}
                          </Badge>
                          <span className="text-xs font-medium text-slate-800">{item.model}</span>
                        </div>
                        <p className="text-[10px] text-slate-500">
                          {item.calls} calls · {item.tokens.toLocaleString()} tokens
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-slate-900">₹{item.costInr.toFixed(2)}</div>
                        <div className="text-[10px] text-slate-400">${item.costUsd.toFixed(4)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Call Logs Table */}
        <Card className="border border-slate-200 shadow-sm bg-white">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">Recent AI Calls</h2>
                <p className="text-[11px] text-slate-500">Audit trail of the last 50 requests</p>
              </div>
              <Badge variant="default" className="text-[10px]">
                {recentLogs.length} logged
              </Badge>
            </div>

            {recentLogs.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">No recent calls recorded yet.</p>
            ) : (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-left text-xs text-slate-700 min-w-[650px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] uppercase text-slate-400">
                      <th className="pb-2 font-medium">Timestamp</th>
                      <th className="pb-2 font-medium">Feature</th>
                      <th className="pb-2 font-medium">Model</th>
                      <th className="pb-2 font-medium text-right">Tokens (In / Out)</th>
                      <th className="pb-2 font-medium text-right">Cost</th>
                      <th className="pb-2 font-medium text-right">Latency</th>
                      <th className="pb-2 font-medium text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentLogs.map((item) => {
                      const dateStr = new Date(item.createdAt).toLocaleTimeString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      });
                      return (
                        <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2.5 font-mono text-[10px] text-slate-500 whitespace-nowrap">{dateStr}</td>
                          <td className="py-2.5">
                            <span className="font-medium text-slate-800">{item.label}</span>
                          </td>
                          <td className="py-2.5 text-slate-600">
                            <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">
                              {item.model}
                            </span>
                          </td>
                          <td className="py-2.5 text-right font-mono text-[11px] whitespace-nowrap">
                            <span className="text-slate-500">{item.inputTokens.toLocaleString()}</span>
                            <span className="text-slate-300"> / </span>
                            <span className="text-slate-900 font-semibold">{item.outputTokens.toLocaleString()}</span>
                          </td>
                          <td className="py-2.5 text-right whitespace-nowrap">
                            <div className="font-semibold text-slate-900">₹{item.costInr.toFixed(3)}</div>
                            <div className="text-[10px] text-slate-400 font-mono">${item.costUsd.toFixed(5)}</div>
                          </td>
                          <td className="py-2.5 text-right font-mono text-[11px] text-slate-500 whitespace-nowrap">
                            {(item.latencyMs / 1000).toFixed(2)}s
                          </td>
                          <td className="py-2.5 text-center">
                            {item.ok ? (
                              <Badge variant="success" className="text-[10px] px-1.5 py-0">
                                OK
                              </Badge>
                            ) : (
                              <Badge variant="danger" className="text-[10px] px-1.5 py-0" title={item.errorKind || "Failed"}>
                                {item.errorKind || "FAIL"}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="p-1 focus-ring rounded">
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-slate-900">AI</h1>
          <p className="text-[11px] text-slate-500">
            Provider configuration, API keys, and spend analytics across all modules
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab("config")}
          className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "config"
              ? "border-slate-900 text-slate-900 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Providers & Keys
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("analytics")}
          className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "analytics"
              ? "border-slate-900 text-slate-900 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Usage & Spend Analytics
        </button>
      </div>

      {activeTab === "config" ? (
        <div className="space-y-3">
          {live ? (
            <div className="text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <strong>Live:</strong> {live.label} · {live.model || live.defaultModel}
              {!live.isConnected && " · untested since the last save"}
            </div>
          ) : (
            <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
              No provider is live — save a key, test it, then make it live.
            </div>
          )}

          {notice && (
            <div
              className={`text-[11px] rounded-xl p-3 border ${
                notice.ok
                  ? "text-green-800 bg-green-50 border-green-200"
                  : "text-red-800 bg-red-50 border-red-200"
              }`}
            >
              {notice.text}
            </div>
          )}

          {config?.providers.map((p) => card(p))}
        </div>
      ) : (
        renderAnalytics()
      )}
    </div>
  );
}
