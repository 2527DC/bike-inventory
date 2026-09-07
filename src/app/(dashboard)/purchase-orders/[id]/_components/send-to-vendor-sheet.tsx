"use client";

import { useState, useEffect, useRef } from "react";
import { X, Loader2, AlertTriangle, FileText, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:send-sheet");

export interface SendResult {
  sent: true;
  to: string;
  filename: string;
  sendCount: number;
  messageId: string | null;
}

interface Props {
  open: boolean;
  poId: string;
  poNumber: string;
  vendorName: string;
  /** Prefilled recipient — the vendor's address, or a primary contact's. May be absent. */
  defaultTo: string | null;
  /** True on a resend, which only changes the wording. */
  alreadySent: boolean;
  onClose: () => void;
  onSent: (result: SendResult) => void;
}

/**
 * Send this purchase order to the vendor.
 *
 * ─── WHY THIS IS NOT BUILT ON ui/bottom-sheet.tsx ────────────────────────────────────────
 *
 * The plan says "P8's `src/components/ui/bottom-sheet.tsx` hosts" this sheet. That file was
 * never created — in P8 the owner chose not to add a shared primitive, because the repo
 * already had fifteen overlay sites across four named components and the focus trap the plan
 * wanted to lift out of `filter-sheet.tsx` does not exist there (or anywhere). So this follows
 * `components/reorder-sheet.tsx`, which followed `customer-edit-sheet.tsx`.
 *
 * TWO DELIBERATE DIFFERENCES from reorder-sheet, both about the keyboard:
 *
 *   `max-h-[90dvh]`, not `88vh`. `vh` does not shrink when the soft keyboard opens, so on a
 *   360 px phone with the keyboard up the whole panel — footer included — can sit below the
 *   fold. `dvh` does shrink. `deliveries/_components/bottom-sheet-modal.tsx` already uses it.
 *
 *   The body is `flex-1 overflow-y-auto`, not `overflow-visible`. reorder-sheet needs the
 *   overflow visible because SearchableSelect renders its list unportalled; there is no such
 *   control here, and this sheet is taller — so the body scrolls and the `shrink-0 pb-safe`
 *   footer stays pinned, which is what keeps Send reachable with a keyboard open.
 */
export function SendToVendorSheet({
  open,
  poId,
  poNumber,
  vendorName,
  defaultTo,
  alreadySent,
  onClose,
  onSent,
}: Props) {
  // Initialised from the prop rather than reset by an effect. The caller renders this only
  // while it is open, so every open is a fresh mount and these initialisers run again — which
  // is the same behaviour a reset effect gave, without the cascading render.
  const [to, setTo] = useState(defaultTo ?? "");
  const [cc, setCc] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onClose();
    };
    document.addEventListener("keydown", onKey);
    firstFieldRef.current?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, sending, onClose]);

  if (!open) return null;

  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  const ccOk = cc.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cc.trim());
  const canSend = looksLikeEmail && ccOk && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);

    const { data, error: err } = await apiTry<SendResult>(`/api/purchase-orders/${poId}/send`, {
      method: "POST",
      json: { to: to.trim(), ...(cc.trim() ? { cc: cc.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) },
      // The route renders a PDF and waits on SMTP. The default client timeout would give up
      // while the send is still genuinely in progress — and a client that stops listening does
      // NOT stop the email, so the person would retry something that had already worked.
      timeoutMs: 60_000,
    });

    setSending(false);

    if (!data) {
      // The sheet STAYS OPEN on failure, with the message inside it. Closing would take away
      // the address and the note they just typed, and every one of the route's refusals — no
      // address, sent moments ago, email not configured, SMTP rejected it — is something to
      // act on here rather than somewhere else.
      log.warn("send failed", { poId, message: err });
      setError(err ?? "Could not send the purchase order");
      return;
    }

    onSent(data);
  }

  const label = "block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={() => !sending && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Send purchase order to vendor"
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100 shrink-0">
          <div className="pr-3 min-w-0">
            <h2 className="text-base font-bold text-slate-900">
              {alreadySent ? "Send again" : "Send to vendor"}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {poNumber} · {vendorName}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2 text-slate-400 hover:text-slate-600 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {alreadySent && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              This order has already been sent. Sending again delivers another copy of the same
              PDF — the vendor will see the same order number.
            </p>
          )}

          <div>
            <label className={label} htmlFor="send-to">
              To <span className="text-red-500">*</span>
            </label>
            <Input
              id="send-to"
              ref={firstFieldRef}
              type="email"
              inputMode="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="orders@vendor.com"
              className="min-h-[44px]"
            />
            {!defaultTo && (
              <p className="text-[11px] text-amber-600 mt-1">
                This vendor has no email address saved. Adding one on the vendor&apos;s page
                fills this in next time.
              </p>
            )}
          </div>

          <div>
            <label className={label} htmlFor="send-cc">Cc</label>
            <Input
              id="send-cc"
              type="email"
              inputMode="email"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="Optional"
              className="min-h-[44px]"
            />
            {!ccOk && <p className="text-[11px] text-red-600 mt-1">That does not look like an email address.</p>}
          </div>

          <div>
            <label className={label} htmlFor="send-note">Note to the vendor</label>
            <textarea
              id="send-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Anything to say alongside the order…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">Appears in the email, not on the PDF.</p>
          </div>

          {/* Opens the same render the vendor will be sent. Worth checking once before the
              first send of the day, especially while the company details are still blank. */}
          <a
            href={`/api/purchase-orders/${poId}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 font-medium min-h-[44px]"
          >
            <FileText className="h-4 w-4" /> Preview {poNumber}.pdf
          </a>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 break-words">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-100 shrink-0 pb-safe">
          <Button variant="outline" onClick={onClose} disabled={sending} className="flex-1 min-h-[44px]">
            Cancel
          </Button>
          <Button onClick={send} disabled={!canSend} className="flex-1 min-h-[44px]">
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Mail className="h-4 w-4 mr-1.5" /> {alreadySent ? "Send again" : "Send"}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default SendToVendorSheet;
