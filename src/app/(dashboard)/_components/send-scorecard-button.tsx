"use client";

import { useState } from "react";
import { Send, Loader2, Check, AlertTriangle } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";

// Sends the Daily Accountability scorecard on demand.
//
// This replaces the 08:00 cron that used to push it every morning. There are no scheduled
// jobs in this application, so the scorecard goes out when someone asks for it.
//
// The button is gated on `settings.edit` to match the API, which gates on the same grant
// because the recipients live in AlertConfig — see api/alerts/scorecard/route.ts. The
// client check is cosmetic; the route re-checks.

interface SendResult {
  alertSent: boolean;
  sent?: number;
  phones: string[];
  whatsappConfigured: boolean;
  whatsappErrors?: string[];
  reason?: string;
}

export function SendScorecardButton() {
  const { can, loading } = usePermissions();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // `loading` guards against rendering a denial before grants are known.
  if (loading || !can("settings", "edit")) return null;

  async function send() {
    setSending(true);
    setResult(null);

    const { data, error } = await apiTry<SendResult>("/api/alerts/scorecard", {
      method: "POST",
    });

    if (error || !data) {
      setResult({ ok: false, text: error || "Could not send the scorecard." });
    } else if (data.alertSent) {
      const n = data.sent ?? data.phones.length;
      const failed = data.whatsappErrors?.length ?? 0;
      setResult({
        ok: failed === 0,
        text: failed
          ? `Sent to ${n}, ${failed} failed.`
          : `Sent to ${n} ${n === 1 ? "number" : "numbers"}.`,
      });
    } else {
      // Not an error: no recipients, or WhatsApp is not configured. Say which.
      setResult({ ok: false, text: data.reason || "Nothing was sent." });
    }

    setSending(false);
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span
          className={`text-[11px] flex items-center gap-1 ${
            result.ok ? "text-green-700" : "text-amber-700"
          }`}
        >
          {result.ok ? (
            <Check className="h-3 w-3 shrink-0" />
          ) : (
            <AlertTriangle className="h-3 w-3 shrink-0" />
          )}
          {result.text}
        </span>
      )}
      <button
        onClick={send}
        disabled={sending}
        className="text-[11px] font-medium text-blue-600 hover:text-blue-700 disabled:text-slate-400 flex items-center gap-1 focus-ring rounded px-1.5 py-1 min-h-[32px]"
      >
        {sending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Send className="h-3.5 w-3.5" />
        )}
        {sending ? "Sending..." : "Send scorecard"}
      </button>
    </div>
  );
}
