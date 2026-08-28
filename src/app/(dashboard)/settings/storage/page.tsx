"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  HardDrive, Cloud, ChevronDown, ChevronRight, Loader2, Check, X,
  AlertTriangle, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiTry } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { SetupGuide } from "./_components/setup-guide";

type Provider = "S3" | "LOCAL";

interface StorageConfig {
  provider: Provider;
  bucket: string | null;
  region: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null; // masked
  hasSecret: boolean;
  publicBaseUrl: string | null;
  localDir: string | null;
  isConnected: boolean;
  lastTestedAt: string | null;
  lastTestError: string | null;
  configured: boolean;
}

interface TestStep { name: string; ok: boolean; detail?: string }
interface TestResult { ok: boolean; provider: Provider; steps: TestStep[]; error?: string }

export default function StorageSettingsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canEdit = can("settings_storage", "edit");
  const canApprove = can("settings_storage", "approve");

  const [config, setConfig] = useState<StorageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [expanded, setExpanded] = useState<Provider | null>(null);
  const [form, setForm] = useState({
    bucket: "", region: "", accessKeyId: "", secretAccessKey: "",
    publicBaseUrl: "", localDir: "",
  });

  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<"" | "test" | "cors" | "activate">("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await apiTry<StorageConfig>("/api/settings/storage");
    if (err || !data) {
      setError(err || "Could not load the storage settings.");
    } else {
      setConfig(data);
      setForm({
        bucket: data.bucket || "",
        region: data.region || "",
        accessKeyId: data.accessKeyId || "",
        secretAccessKey: data.secretAccessKey || "", // the mask; sending it back means "unchanged"
        publicBaseUrl: data.publicBaseUrl || "",
        localDir: data.localDir || "",
      });
      setError("");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true);
    setNotice(null);
    setResult(null);
    const { error: err } = await apiTry("/api/settings/storage", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setNotice(err ? { ok: false, text: err } : { ok: true, text: "Saved. Now run a connection test." });
    setSaving(false);
    if (!err) await load();
  }

  async function runTest(provider: Provider) {
    setBusy("test");
    setNotice(null);
    setResult(null);
    const { data, error: err } = await apiTry<TestResult>("/api/settings/storage/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    if (err || !data) setNotice({ ok: false, text: err || "The test could not run." });
    else setResult(data);
    setBusy("");
    await load();
  }

  async function applyCors() {
    setBusy("cors");
    setNotice(null);
    const { data, error: err } = await apiTry<{ origin: string; note: string }>(
      "/api/settings/storage/cors",
      { method: "POST" }
    );
    setNotice(
      err
        ? { ok: false, text: `${err} — you can paste the policy from the guide below instead.` }
        : { ok: true, text: data?.note || "CORS policy applied." }
    );
    setBusy("");
  }

  async function activate(provider: Provider) {
    setBusy("activate");
    setNotice(null);
    setResult(null);
    const { data, error: err } = await apiTry<{ provider: Provider; note: string }>(
      "/api/settings/storage/activate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      }
    );
    setNotice(
      err ? { ok: false, text: err } : { ok: true, text: data?.note || `${provider} is now live.` }
    );
    setBusy("");
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

  const live = config?.provider ?? "LOCAL";

  function card(provider: Provider, title: string, subtitle: string, Icon: typeof Cloud) {
    const isLive = live === provider;
    const isOpen = expanded === provider;

    return (
      <Card key={provider}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
              <Icon className="h-4.5 w-4.5 text-slate-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">{title}</p>
              <p className="text-[11px] text-slate-500">{subtitle}</p>
            </div>
            <span
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                isLive && config?.isConnected
                  ? "bg-green-100 text-green-800"
                  : isLive
                    ? "bg-amber-100 text-amber-800"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {isLive && config?.isConnected ? "Live" : isLive ? "Live · untested" : "Not active"}
            </span>
            <button
              onClick={() => setExpanded(isOpen ? null : provider)}
              className="p-1 focus-ring rounded shrink-0"
              aria-label={isOpen ? "Collapse" : "Expand"}
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400" />
              )}
            </button>
          </div>

          {isOpen && (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
              {provider === "S3" ? (
                <>
                  <Field label="Bucket" value={form.bucket} onChange={(v) => setForm({ ...form, bucket: v })} placeholder="bch-media" disabled={!canEdit} />
                  <Field label="Region" value={form.region} onChange={(v) => setForm({ ...form, region: v })} placeholder="ap-south-1" disabled={!canEdit} />
                  <Field label="Access key ID" value={form.accessKeyId} onChange={(v) => setForm({ ...form, accessKeyId: v })} placeholder="AKIA..." disabled={!canEdit} />
                  <Field label="Secret access key" value={form.secretAccessKey} onChange={(v) => setForm({ ...form, secretAccessKey: v })} placeholder={config?.hasSecret ? "unchanged" : "..."} disabled={!canEdit} />
                  <Field label="Public base URL" value={form.publicBaseUrl} onChange={(v) => setForm({ ...form, publicBaseUrl: v })} placeholder="https://cdn.example.com" disabled={!canEdit} />
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    The public base URL is stored with every uploaded file. Setting it now means
                    you can move to CloudFront later without rewriting database rows.
                  </p>
                </>
              ) : (
                <>
                  <Field label="Directory" value={form.localDir} onChange={(v) => setForm({ ...form, localDir: v })} placeholder=".storage" disabled={!canEdit} />
                  <p className="text-[10px] text-amber-700 leading-relaxed bg-amber-50 rounded-lg p-2">
                    Works on a VPS or a container with a mounted volume. <strong>Not on Vercel</strong> —
                    there the filesystem is read-only apart from /tmp, which is wiped between
                    requests, so uploaded files would vanish. The test below checks this and
                    refuses to activate if the directory is not writable.
                  </p>
                </>
              )}

              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button onClick={save} disabled={saving}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button variant="outline" onClick={() => void runTest(provider)} disabled={busy !== ""}>
                    {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Test connection
                  </Button>
                  {provider === "S3" && (
                    <Button variant="outline" onClick={() => void applyCors()} disabled={busy !== ""}>
                      {busy === "cors" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Apply CORS
                    </Button>
                  )}
                  {canApprove && !isLive && (
                    <Button onClick={() => void activate(provider)} disabled={busy !== ""}>
                      {busy === "activate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Make active
                    </Button>
                  )}
                </div>
              )}

              {!canEdit && (
                <p className="text-[10px] text-slate-400">
                  You can view these settings but not change them.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="p-1 focus-ring rounded">
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Storage</h1>
          <p className="text-[11px] text-slate-500">
            Where uploaded photos and videos are kept
          </p>
        </div>
      </div>

      {!config?.configured && (
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
          Storage is not configured yet, so uploads will fail with a message pointing here.
          Fill in a provider below, test it, then make it active.
        </div>
      )}

      {config?.lastTestError && (
        <div className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-xl p-3">
          <strong>Last test failed:</strong> {config.lastTestError}
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

      {result && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-slate-900 mb-2">
              {result.ok ? "Connection test passed" : "Connection test failed"}
            </p>
            <div className="space-y-1">
              {result.steps.map((s) => (
                <div key={s.name} className="flex items-start gap-2">
                  {s.ok ? (
                    <Check className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-700">{s.name}</p>
                    {s.detail && <p className="text-[10px] text-slate-500">{s.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {card("S3", "Amazon S3", "Object storage — recommended for production", Cloud)}
      {card("LOCAL", "Server filesystem", "Files on the server's own disk", HardDrive)}

      <SetupGuide />
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-slate-500 w-32 shrink-0">{label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="h-8 text-xs"
      />
    </div>
  );
}
