"use client";

// The customer self-fill link (plan 1609 §2.9). Needs the saved customer — the button says so
// and the server refuses too (A5). The link lasts 24 hours (A7); WhatsApp goes to the main
// phone only (A9); Copy stays (R11).

import { useState } from "react";
import { Link2, Copy, Check, ExternalLink, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { whatsappDigits } from "@/lib/phone";

const log = createLogger("deliveries:self-fill");

interface SelfFillLinkButtonProps {
  deliveryId: string;
  customerPhone: string | null;
  /** `data.customerId` is set. Without it the link cannot be generated (A5). */
  customerSaved: boolean;
  selfFillCompletedAt: string | null;
}

export function SelfFillLinkButton({
  deliveryId,
  customerPhone,
  customerSaved,
  selfFillCompletedAt,
}: SelfFillLinkButtonProps) {
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const waDigits = whatsappDigits(customerPhone);

  const generateLink = async () => {
    if (loading || !customerSaved) return;
    setLoading(true);
    setError("");
    const res = await apiTry<{ token: string; expiresAt: string }>(
      `/api/deliveries/${deliveryId}/generate-token`,
      { method: "POST" }
    );
    setLoading(false);
    if (res.error || !res.data) {
      log.warn("self-fill link refused", { deliveryId, status: res.status });
      setError(res.error || "Could not generate the link.");
      return;
    }
    log.info("self-fill link generated", { deliveryId });
    setLink(`${window.location.origin}/fill/${res.data.token}`);
  };

  const markCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      markCopied();
    } catch (e) {
      // Clipboard API is unavailable on some mobile browsers / non-HTTPS origins.
      log.warn("clipboard write failed, using fallback", {
        deliveryId,
        error: e instanceof Error ? e.message : String(e),
      });
      const input = document.createElement("input");
      input.value = link;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      markCopied();
    }
  };

  const sendViaWhatsApp = () => {
    if (!link || !waDigits) return;
    const msg = encodeURIComponent(
      `Hi! Please fill in your delivery address using this link:\n${link}\n\nThis link expires in 24 hours.\n\n— Bharath Cycle Hub`
    );
    log.info("self-fill link opened in whatsapp", { deliveryId });
    window.open(`https://wa.me/${waDigits}?text=${msg}`, "_blank");
  };

  if (selfFillCompletedAt) {
    return (
      <Card className="mb-3 border-green-200 bg-green-50">
        <CardContent className="p-3 flex items-center gap-2">
          <Check className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-700 font-medium">Customer filled delivery details</span>
          <span className="text-xs text-green-500 ml-auto shrink-0">
            {new Date(selfFillCompletedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-3">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
            <Link2 className="h-4 w-4 text-blue-500" />
            Customer Self-Fill Link
          </span>
        </div>

        {error && (
          <p className="text-xs text-red-600 mb-2" role="alert">
            {error}
          </p>
        )}

        {!link ? (
          <>
            <button
              onClick={generateLink}
              disabled={loading || !customerSaved}
              className="w-full py-2.5 min-h-[44px] bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:hover:bg-blue-50"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating...
                </span>
              ) : (
                "Generate Link for Customer"
              )}
            </button>
            {!customerSaved && (
              <p className="text-xs text-amber-600 font-medium mt-1.5">Save the customer first</p>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
              <input
                readOnly
                value={link}
                aria-label="Self-fill link"
                className="flex-1 min-w-0 text-xs text-slate-600 bg-transparent outline-none truncate"
              />
              <button
                onClick={copyLink}
                aria-label="Copy link"
                className="p-1.5 rounded-md bg-white border border-slate-200 hover:bg-slate-100 shrink-0"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-slate-500" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">This link expires in 24 hours.</p>

            <div className="flex gap-2">
              <button
                onClick={copyLink}
                className="flex-1 py-2 min-h-[44px] bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
              >
                {copied ? "Copied!" : "Copy Link"}
              </button>
              {waDigits && (
                <button
                  onClick={sendViaWhatsApp}
                  className="flex-1 py-2 min-h-[44px] bg-green-100 text-green-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" /> Send via WhatsApp
                </button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
