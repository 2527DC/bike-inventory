"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Mail, Smartphone, Loader2, Check, X, AlertTriangle, RefreshCw, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiTry } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { createLogger } from "@/lib/logger";
import { EnablePushButton } from "@/components/enable-push-button";
import type {
  Channel,
  DeviceView,
  EventSettingUpdate,
  EventSettingView,
  NotificationConfigUpdate,
  NotificationConfigView,
  TestSendInput,
  TestSendResult,
} from "@/lib/notify/types";

const log = createLogger("settings:notifications");

// /settings/notifications — how the business is told about things (plan §E.1).
//
// Two tabs, Email and Push, each with its provider credentials, a master switch, a Save and
// a "send me a test" button; under both, the per-event table that decides which events go out
// on which channel. Both tab panels stay MOUNTED and are merely hidden, so half-typed SMTP
// details survive a peek at the Push tab.
//
// Secrets never arrive here. GET returns a mask for the SMTP password and the FCM service
// account; the form keeps those two fields empty and the API treats empty as "unchanged", so
// pressing Save after editing the port cannot wipe a password the browser never had.
//
// `can("settings_notifications", "edit")` is cosmetic — it greys the controls. Every route
// behind them re-checks.

type Notice = { ok: boolean; text: string } | null;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function NotificationSettingsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canEdit = can("settings_notifications", "edit");

  const [tab, setTab] = useState<Channel>("EMAIL");
  const [config, setConfig] = useState<NotificationConfigView | null>(null);
  const [events, setEvents] = useState<EventSettingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [cfg, ev] = await Promise.all([
      apiTry<NotificationConfigView>("/api/notifications/config"),
      apiTry<EventSettingView[]>("/api/notifications/events"),
    ]);
    if (cfg.error || !cfg.data || ev.error || !ev.data) {
      log.error("load failed", { config: cfg.error, events: ev.error });
      setError(cfg.error || ev.error || "Could not load the notification settings.");
    } else {
      setConfig(cfg.data);
      setEvents(ev.data);
      setError("");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // After a test send the row's connected / lastTested fields changed on the server; re-read
  // the view without disturbing whatever the admin has typed but not saved.
  const refreshConfig = useCallback(async () => {
    const { data, error: err } = await apiTry<NotificationConfigView>("/api/notifications/config");
    if (err || !data) {
      log.warn("config refresh failed", { error: err });
      return;
    }
    setConfig(data);
  }, []);

  if (loading || permsLoading) return <SkeletonList />;

  if (error || !config) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-6 w-6 text-amber-500 mx-auto mb-2" />
          <p className="text-sm text-slate-700">{error || "Could not load the notification settings."}</p>
          <Button className="mt-3 min-h-[44px]" onClick={() => void load()}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="p-1 focus-ring rounded" aria-label="Back to settings">
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Notifications</h1>
          <p className="text-[11px] text-slate-500">
            Email and push delivery — providers, credentials and per-event switches
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Channel" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        <TabButton active={tab === "EMAIL"} onClick={() => setTab("EMAIL")} icon={Mail} label="Email" />
        <TabButton active={tab === "PUSH"} onClick={() => setTab("PUSH")} icon={Smartphone} label="Push" />
      </div>

      <div role="tabpanel" hidden={tab !== "EMAIL"}>
        <EmailTab config={config} canEdit={canEdit} onConfigChange={setConfig} refreshConfig={refreshConfig} />
      </div>
      <div role="tabpanel" hidden={tab !== "PUSH"}>
        <PushTab config={config} canEdit={canEdit} onConfigChange={setConfig} refreshConfig={refreshConfig} />
      </div>

      <EventsTable events={events} canEdit={canEdit} onSaved={setEvents} />

      {!canEdit && (
        <p className="text-[10px] text-slate-400 text-center">
          You can view these settings but not change them.
        </p>
      )}
    </div>
  );
}

function TabButton({
  active, onClick, icon: Icon, label,
}: {
  active: boolean; onClick: () => void; icon: typeof Mail; label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-[44px] rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 focus-ring transition-colors ${
        active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

// ─── Email ─────────────────────────────────────────────────────────────────────

interface EmailForm {
  provider: string;
  smtpHost: string;
  smtpPort: string; // text while editing; validated to an integer on save
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string; // "" = unchanged — the browser never sees the stored value
  fromName: string;
  fromEmail: string;
  enabled: boolean;
}

function emailFormFrom(c: NotificationConfigView): EmailForm {
  return {
    provider: c.email.provider,
    smtpHost: c.email.smtpHost ?? "",
    smtpPort: c.email.smtpPort === null ? "" : String(c.email.smtpPort),
    smtpSecure: c.email.smtpSecure,
    smtpUser: c.email.smtpUser ?? "",
    smtpPassword: "",
    fromName: c.email.fromName ?? "",
    fromEmail: c.email.fromEmail ?? "",
    enabled: c.email.enabled,
  };
}

interface TabProps {
  config: NotificationConfigView;
  canEdit: boolean;
  onConfigChange: (c: NotificationConfigView) => void;
  refreshConfig: () => Promise<void>;
}

function EmailTab({ config, canEdit, onConfigChange, refreshConfig }: TabProps) {
  const [form, setForm] = useState<EmailForm>(() => emailFormFrom(config));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [test, setTest] = useState<TestSendResult | null>(null);

  const set = <K extends keyof EmailForm>(key: K, value: EmailForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    const portText = form.smtpPort.trim();
    const port = portText === "" ? undefined : Number(portText);
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      setNotice({ ok: false, text: "Port must be a whole number between 1 and 65535." });
      return;
    }

    const body: NotificationConfigUpdate = {
      email: {
        provider: form.provider,
        smtpHost: form.smtpHost.trim(),
        smtpSecure: form.smtpSecure,
        smtpUser: form.smtpUser.trim(),
        fromName: form.fromName.trim(),
        fromEmail: form.fromEmail.trim(),
        enabled: form.enabled,
        // Omitted when blank: the stored port stays. Omitted when empty: the stored password stays.
        ...(port !== undefined ? { smtpPort: port } : {}),
        ...(form.smtpPassword ? { smtpPassword: form.smtpPassword } : {}),
      },
    };

    setSaving(true);
    setNotice(null);
    setTest(null);
    const { data, error } = await apiTry<NotificationConfigView>("/api/notifications/config", {
      method: "PUT",
      json: body,
    });
    if (error || !data) {
      log.error("email settings save failed", { error });
      setNotice({ ok: false, text: error || "Could not save the email settings." });
    } else {
      onConfigChange(data);
      setForm(emailFormFrom(data));
      setNotice({ ok: true, text: "Saved. Send a test email to confirm the connection." });
    }
    setSaving(false);
  }

  async function runTest() {
    setTesting(true);
    setNotice(null);
    setTest(null);
    const { data, error } = await apiTry<TestSendResult>("/api/notifications/test", {
      method: "POST",
      json: { channel: "EMAIL" } satisfies TestSendInput,
    });
    if (error || !data) {
      log.error("test email could not run", { error });
      setNotice({ ok: false, text: error || "The test could not run." });
    } else {
      if (!data.ok) log.warn("test email failed", { reason: data.detail });
      setTest(data);
    }
    setTesting(false);
    await refreshConfig();
  }

  const busy = saving || testing;
  const e = config.email;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <StatusLine connected={e.connected} enabled={e.enabled} lastTestedAt={e.lastTestedAt} lastTestError={e.lastTestError} />

        <div>
          <label htmlFor="email-provider" className="text-[11px] text-slate-500">Provider</label>
          <select
            id="email-provider"
            value={form.provider}
            onChange={(ev) => set("provider", ev.target.value)}
            disabled={!canEdit || busy}
            className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus-ring disabled:opacity-50"
          >
            <option value="SMTP">SMTP (Gmail App Password)</option>
            <option value="GMAIL_OAUTH" disabled>Gmail OAuth — not implemented</option>
            <option value="SES" disabled>Amazon SES — not implemented</option>
          </select>
        </div>

        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label="SMTP host" value={form.smtpHost} onChange={(v) => set("smtpHost", v)} placeholder="smtp.gmail.com" disabled={!canEdit || busy} autoComplete="off" />
          <Field label="Port" value={form.smtpPort} onChange={(v) => set("smtpPort", v)} placeholder="587" disabled={!canEdit || busy} inputMode="numeric" autoComplete="off" />
        </div>

        <Toggle
          label="Implicit TLS (port 465)"
          description="Off for port 587, which upgrades with STARTTLS. Gmail uses 587."
          checked={form.smtpSecure}
          onChange={(v) => set("smtpSecure", v)}
          disabled={!canEdit || busy}
        />

        <Field label="Username" value={form.smtpUser} onChange={(v) => set("smtpUser", v)} placeholder="you@gmail.com" disabled={!canEdit || busy} inputMode="email" autoComplete="off" />
        <Field
          label="Password"
          type="password"
          value={form.smtpPassword}
          onChange={(v) => set("smtpPassword", v)}
          placeholder={e.smtpPasswordMasked ? `${e.smtpPasswordMasked} stored — leave blank to keep` : "16-character App Password"}
          disabled={!canEdit || busy}
          autoComplete="new-password"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="From name" value={form.fromName} onChange={(v) => set("fromName", v)} placeholder="Bharath Cycle Hub" disabled={!canEdit || busy} autoComplete="off" />
          <Field label="From address" value={form.fromEmail} onChange={(v) => set("fromEmail", v)} placeholder="you@gmail.com" disabled={!canEdit || busy} inputMode="email" autoComplete="off" />
        </div>

        <Toggle
          label="Email enabled"
          description="The master switch. Off, and no event mails anyone regardless of the table below."
          checked={form.enabled}
          onChange={(v) => set("enabled", v)}
          disabled={!canEdit || busy}
        />

        <p className="text-[10px] text-slate-400 leading-relaxed">
          Gmail: turn on 2-Step Verification, then Google Account → Security → App Passwords.
          Host <code>smtp.gmail.com</code>, port <code>587</code>, TLS off, username = the full
          address, password = the 16-character App Password. A free account sends about 500
          messages a day, so email is off for most events by default.
        </p>

        <NoticeBox notice={notice} />
        <TestOutcome result={test} />

        {canEdit && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button className="min-h-[44px]" onClick={() => void save()} disabled={busy}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" className="min-h-[44px]" onClick={() => void runTest()} disabled={busy}>
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Mail className="h-3.5 w-3.5 mr-1.5" />}
              {testing ? "Sending..." : "Send test email"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Push ──────────────────────────────────────────────────────────────────────

interface PushForm {
  projectId: string;
  serviceAccountJson: string; // "" = unchanged
  webApiKey: string;
  messagingSenderId: string;
  webAppId: string;
  vapidKey: string;
  enabled: boolean;
}

function pushFormFrom(c: NotificationConfigView): PushForm {
  return {
    projectId: c.push.projectId ?? "",
    serviceAccountJson: "",
    webApiKey: c.push.webApiKey ?? "",
    messagingSenderId: c.push.messagingSenderId ?? "",
    webAppId: c.push.webAppId ?? "",
    vapidKey: c.push.vapidKey ?? "",
    enabled: c.push.enabled,
  };
}

function PushTab({ config, canEdit, onConfigChange, refreshConfig }: TabProps) {
  const [form, setForm] = useState<PushForm>(() => pushFormFrom(config));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [test, setTest] = useState<TestSendResult | null>(null);

  const set = <K extends keyof PushForm>(key: K, value: PushForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    const body: NotificationConfigUpdate = {
      push: {
        projectId: form.projectId.trim(),
        webApiKey: form.webApiKey.trim(),
        messagingSenderId: form.messagingSenderId.trim(),
        webAppId: form.webAppId.trim(),
        vapidKey: form.vapidKey.trim(),
        enabled: form.enabled,
        // Omitted when empty so the stored file stays. The API parses and rejects a bad paste
        // with the missing field named — better now than at the first real send.
        ...(form.serviceAccountJson.trim() ? { serviceAccountJson: form.serviceAccountJson.trim() } : {}),
      },
    };

    setSaving(true);
    setNotice(null);
    setTest(null);
    const { data, error } = await apiTry<NotificationConfigView>("/api/notifications/config", {
      method: "PUT",
      json: body,
    });
    if (error || !data) {
      log.error("push settings save failed", { error });
      setNotice({ ok: false, text: error || "Could not save the push settings." });
    } else {
      onConfigChange(data);
      setForm(pushFormFrom(data));
      setNotice({ ok: true, text: "Saved. Send a test push to confirm the connection." });
    }
    setSaving(false);
  }

  async function runTest() {
    setTesting(true);
    setNotice(null);
    setTest(null);
    const { data, error } = await apiTry<TestSendResult>("/api/notifications/test", {
      method: "POST",
      json: { channel: "PUSH" } satisfies TestSendInput,
    });
    if (error || !data) {
      log.error("test push could not run", { error });
      setNotice({ ok: false, text: error || "The test could not run." });
    } else {
      if (!data.ok) log.warn("test push failed", { reason: data.detail });
      setTest(data);
    }
    setTesting(false);
    await refreshConfig();
  }

  const busy = saving || testing;
  const p = config.push;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 space-y-3">
          <StatusLine connected={p.connected} enabled={p.enabled} lastTestedAt={p.lastTestedAt} lastTestError={p.lastTestError} />

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">Provider</span>
            <span className="text-xs font-medium text-slate-900">Firebase Cloud Messaging ({p.provider})</span>
          </div>

          <Field label="Firebase project id" value={form.projectId} onChange={(v) => set("projectId", v)} placeholder="Filled from the service account if left blank" disabled={!canEdit || busy} autoComplete="off" />

          <div>
            <label htmlFor="push-sa" className="text-[11px] text-slate-500">Service-account JSON</label>
            <textarea
              id="push-sa"
              value={form.serviceAccountJson}
              onChange={(ev) => set("serviceAccountJson", ev.target.value)}
              disabled={!canEdit || busy}
              rows={5}
              spellCheck={false}
              placeholder={
                p.serviceAccountMasked
                  ? `${p.serviceAccountMasked} — paste a new file to replace it`
                  : 'Paste the whole file: {"type": "service_account", "project_id": ..., "private_key": ..., "client_email": ..., "token_uri": ...}'
              }
              className="mt-1 w-full text-xs font-mono border border-slate-300 rounded-lg px-3 py-2 focus-ring disabled:opacity-50 resize-y"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Firebase console → Project settings → Service accounts → Generate new private key.
              Stored on the server only; this page never shows it again.
            </p>
          </div>

          <p className="text-[11px] font-medium text-slate-700 pt-1">Web app config</p>
          <p className="text-[10px] text-slate-400 -mt-2">
            Project settings → General → Your apps → Web app. These four are not secret — every
            Firebase web app ships them — and browsers need them to register for push.
          </p>
          <Field label="Web API key" value={form.webApiKey} onChange={(v) => set("webApiKey", v)} placeholder="AIza..." disabled={!canEdit || busy} autoComplete="off" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="Messaging sender id" value={form.messagingSenderId} onChange={(v) => set("messagingSenderId", v)} placeholder="123456789012" disabled={!canEdit || busy} inputMode="numeric" autoComplete="off" />
            <Field label="Web app id" value={form.webAppId} onChange={(v) => set("webAppId", v)} placeholder="1:123456789012:web:abcdef" disabled={!canEdit || busy} autoComplete="off" />
          </div>
          <Field label="VAPID public key" value={form.vapidKey} onChange={(v) => set("vapidKey", v)} placeholder="Cloud Messaging → Web Push certificates → key pair" disabled={!canEdit || busy} autoComplete="off" />

          <Toggle
            label="Push enabled"
            description="The master switch. Off, and no event pushes anyone regardless of the table below."
            checked={form.enabled}
            onChange={(v) => set("enabled", v)}
            disabled={!canEdit || busy}
          />

          <NoticeBox notice={notice} />
          <TestOutcome result={test} />

          {canEdit && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button className="min-h-[44px]" onClick={() => void save()} disabled={busy}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" className="min-h-[44px]" onClick={() => void runTest()} disabled={busy}>
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Smartphone className="h-3.5 w-3.5 mr-1.5" />}
                {testing ? "Sending..." : "Send test push to my devices"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-semibold text-slate-900">This device</p>
          <p className="text-[11px] text-slate-500">
            Register this browser so it receives push — and so the test button above has
            somewhere to send.
          </p>
          <EnablePushButton />
        </CardContent>
      </Card>

      <DevicesCard />
    </div>
  );
}

// The caller's OWN registered devices. Not gated on `edit`: these are the person's devices, not
// the business's settings, and the route behind them answers to the session, not to a role.
function DevicesCard() {
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await apiTry<DeviceView[]>("/api/notifications/devices");
    if (err || !data) {
      log.warn("devices load failed", { error: err });
      setError(err || "Could not load your devices.");
    } else {
      setDevices(data);
      setError("");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function revoke(d: DeviceView) {
    const kind = d.platform === "WEB" ? "browser" : "Android device";
    if (!confirm(`Revoke this ${kind} (…${d.tokenTail})? It stops receiving notifications until push is enabled on it again.`)) return;
    setRevoking(d.id);
    const { error: err } = await apiTry(`/api/notifications/devices?id=${encodeURIComponent(d.id)}`, {
      method: "DELETE",
    });
    if (err) {
      log.error("device revoke failed", { deviceId: d.id, error: err });
      setError(err);
    } else {
      log.info("device revoked", { deviceId: d.id });
      await load();
    }
    setRevoking("");
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900">My devices</p>
          <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => void load()} disabled={loading} aria-label="Refresh devices">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {error && (
          <div className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-xl p-3">{error}</div>
        )}

        {loading && devices.length === 0 ? (
          <SkeletonList count={2} />
        ) : devices.length === 0 ? (
          <p className="text-[11px] text-slate-500">
            No devices yet. Use the button above to register this one.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <Badge variant={d.platform === "WEB" ? "info" : "default"}>{d.platform}</Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-900 truncate" title={d.userAgent ?? undefined}>
                    {d.userAgent || "Unknown device"}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    token …{d.tokenTail} · last seen {fmtDate(d.lastSeenAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-[44px] min-w-[44px] text-red-600 hover:bg-red-50"
                  onClick={() => void revoke(d)}
                  disabled={revoking !== ""}
                  aria-label={`Revoke device ending ${d.tokenTail}`}
                >
                  {revoking === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Events ────────────────────────────────────────────────────────────────────

function EventsTable({
  events, canEdit, onSaved,
}: {
  events: EventSettingView[];
  canEdit: boolean;
  onSaved: (rows: EventSettingView[]) => void;
}) {
  const [draft, setDraft] = useState<EventSettingView[]>(events);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  // The parent re-reads after a save; the draft follows so "(default)" markers stay honest.
  useEffect(() => { setDraft(events); }, [events]);

  function toggle(eventKey: string, channel: "push" | "email") {
    setDraft((rows) =>
      rows.map((r) => (r.eventKey === eventKey ? { ...r, [channel]: !r[channel] } : r))
    );
  }

  // Only rows that differ from what was loaded are written. Sending every row would create a
  // DB row for each event and turn every "(default)" into an explicit setting for no reason.
  const changed: EventSettingUpdate[] = draft
    .filter((r) => {
      const orig = events.find((e) => e.eventKey === r.eventKey);
      return !orig || orig.push !== r.push || orig.email !== r.email;
    })
    .map((r) => ({ eventKey: r.eventKey, push: r.push, email: r.email }));

  async function save() {
    if (changed.length === 0) {
      setNotice({ ok: true, text: "Nothing changed." });
      return;
    }
    setSaving(true);
    setNotice(null);
    const { data, error } = await apiTry<EventSettingView[]>("/api/notifications/events", {
      method: "PUT",
      json: changed,
    });
    if (error || !data) {
      log.error("event settings save failed", { error, count: changed.length });
      setNotice({ ok: false, text: error || "Could not save the event settings." });
    } else {
      onSaved(data);
      setNotice({ ok: true, text: `Saved ${changed.length} event${changed.length === 1 ? "" : "s"}.` });
    }
    setSaving(false);
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">Events</p>
          <p className="text-[11px] text-slate-500">
            Which events go out, and on which channel. A master switch that is off wins over
            a tick here.
          </p>
        </div>

        <div className="grid grid-cols-[1fr_3rem_3rem] items-center gap-x-2">
          <span />
          <span className="text-[10px] font-medium text-slate-500 text-center">Push</span>
          <span className="text-[10px] font-medium text-slate-500 text-center">Email</span>

          {draft.map((row) => (
            <div key={row.eventKey} className="contents">
              <div className="min-w-0 py-2 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-900">
                  {row.label}
                  {row.isDefault && <span className="ml-1 text-[10px] font-normal text-slate-400">(default)</span>}
                </p>
                <p className="text-[10px] text-slate-500">{row.description}</p>
              </div>
              <EventCheckbox
                checked={row.push}
                onChange={() => toggle(row.eventKey, "push")}
                disabled={!canEdit || saving}
                label={`${row.label} by push`}
              />
              <EventCheckbox
                checked={row.email}
                onChange={() => toggle(row.eventKey, "email")}
                disabled={!canEdit || saving}
                label={`${row.label} by email`}
              />
            </div>
          ))}
        </div>

        <NoticeBox notice={notice} />

        {canEdit && (
          <div className="flex items-center gap-2 pt-1">
            <Button className="min-h-[44px]" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              {saving ? "Saving..." : "Save events"}
            </Button>
            {changed.length > 0 && !saving && (
              <span className="text-[11px] text-slate-500">{changed.length} unsaved</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EventCheckbox({
  checked, onChange, disabled, label,
}: {
  checked: boolean; onChange: () => void; disabled: boolean; label: string;
}) {
  return (
    <label className="flex items-center justify-center min-h-[44px] min-w-[44px] border-t border-slate-100 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-label={label}
        className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 disabled:opacity-50"
      />
    </label>
  );
}

// ─── Shared bits ───────────────────────────────────────────────────────────────

function StatusLine({
  connected, enabled, lastTestedAt, lastTestError,
}: {
  connected: boolean; enabled: boolean; lastTestedAt: string | null; lastTestError: string | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <Badge variant={connected ? "success" : lastTestError ? "danger" : "warning"}>
          {connected ? "Connected" : lastTestError ? "Test failed" : "Untested"}
        </Badge>
        <Badge variant={enabled ? "info" : "default"}>{enabled ? "Enabled" : "Disabled"}</Badge>
        <span>Last tested: {lastTestedAt ? fmtDate(lastTestedAt) : "never"}</span>
      </div>
      {lastTestError && (
        <div className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-xl p-3 break-words">
          <strong>Last test failed:</strong> {lastTestError}
        </div>
      )}
    </div>
  );
}

function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <div
      className={`text-[11px] rounded-xl p-3 border ${
        notice.ok ? "text-green-800 bg-green-50 border-green-200" : "text-red-800 bg-red-50 border-red-200"
      }`}
    >
      {notice.text}
    </div>
  );
}

function TestOutcome({ result }: { result: TestSendResult | null }) {
  if (!result) return null;
  return (
    <div className="flex items-start gap-2 text-[11px] rounded-xl p-3 border bg-slate-50 border-slate-200">
      {result.ok ? (
        <Check className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
      ) : (
        <X className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
      )}
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{result.ok ? "Test message sent" : "Test failed"}</p>
        <p className="text-slate-600 break-words">{result.detail}</p>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, disabled, type = "text", inputMode, autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: "text" | "password";
  inputMode?: "text" | "numeric" | "email";
  autoComplete?: string;
}) {
  return (
    <div className="min-w-0">
      <label className="text-[11px] text-slate-500">{label}</label>
      <Input
        type={type}
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
        autoComplete={autoComplete}
        className="mt-1 h-11 text-sm"
      />
    </div>
  );
}

function Toggle({
  label, description, checked, onChange, disabled,
}: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="w-full min-h-[44px] flex items-center gap-3 text-left focus-ring rounded-lg disabled:opacity-50"
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-900">{label}</p>
        {description && <p className="text-[10px] text-slate-500">{description}</p>}
      </div>
      <span
        aria-hidden
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-slate-900" : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}
