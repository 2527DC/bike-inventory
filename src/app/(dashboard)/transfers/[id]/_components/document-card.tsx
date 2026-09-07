"use client";

import { useRef, useState } from "react";
import { FileText, FileCheck, Loader2, Upload, AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { compressImageFull } from "@/lib/media-compress";
import { uploadMedia } from "@/lib/media-upload";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfers:document-card");

type DocType = "DELIVERY_CHALLAN" | "TAX_INVOICE";

interface Props {
  orderId: string;
  orderNo: string;
  /** Null for an order raised before the document policy existed. */
  requiredDocType: DocType | null;
  docType: DocType | null;
  docNumber: string | null;
  docDate: string | null;
  docUrl: string | null;
  docUploadedByName: string | null;
  docUploadedAt: string | null;
  /** False once dispatched — the document is what the driver is carrying. */
  canAttach: boolean;
  onAttached: () => void;
}

function docLabel(d: DocType): string {
  return d === "TAX_INVOICE" ? "Tax invoice" : "Delivery challan";
}

/**
 * The document this transfer has to travel with (P15).
 *
 * ─── UPLOAD-ONLY, ON PURPOSE ──────────────────────────────────────────────────────────────
 *
 * A tax invoice is raised in Zoho Books — the tax system of record — and the PDF is attached
 * here. This app does not generate one, because a second invoice series against the same GSTIN
 * is the sort of thing discovered during an audit rather than during a release.
 *
 * ─── PDFs GO THROUGH compressImageFull UNTOUCHED ──────────────────────────────────────────
 *
 * `media-compress.ts` returns the original file unchanged for anything that is not an image,
 * so calling it unconditionally is safe and keeps one code path. A phone photograph of a signed
 * challan IS compressed, which is the common case on the shop floor.
 *
 * The key is `transfers/<orderNo>/…` and the server re-checks that prefix before it will record
 * the URL — `docUrl` is a client-supplied string the server never saw written, so without that
 * check one transfer's record could be pointed at another transfer's invoice.
 */
export function DocumentCard({
  orderId,
  orderNo,
  requiredDocType,
  docType,
  docNumber,
  docDate,
  docUrl,
  docUploadedByName,
  docUploadedAt,
  canAttach,
  onAttached,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState(docNumber ?? "");
  const [date, setDate] = useState(docDate ? docDate.slice(0, 10) : "");
  const [showForm, setShowForm] = useState(false);

  // A pre-policy order. NEVER rendered as "no document needed" — it means the rule did not
  // exist when this was raised, which is a different and less reassuring statement.
  if (!requiredDocType) {
    return (
      <Card className="mb-3">
        <CardContent className="p-4">
          <p className="text-sm font-semibold text-slate-900 mb-1">Document</p>
          <p className="text-xs text-slate-500">
            Raised before transfer documents were recorded, so none is required to dispatch it.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function handleFile(file: File) {
    if (!number.trim()) {
      setError("Enter the document number first.");
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const { blob, ext, contentType } = await compressImageFull(file);
      const key = `transfers/${orderNo}/${requiredDocType === "TAX_INVOICE" ? "tax-invoice" : "delivery-challan"}-${Date.now()}.${ext}`;
      const url = await uploadMedia(blob, key, contentType);

      const { data, error: err } = await apiTry<{ message: string }>(
        `/api/transfer-orders/${orderId}/document`,
        {
          method: "POST",
          json: {
            docType: requiredDocType,
            docNumber: number.trim(),
            ...(date ? { docDate: date } : {}),
            docUrl: url,
          },
        }
      );

      if (!data) {
        log.warn("document record failed", { orderId, message: err });
        setError(err ?? "The file uploaded but could not be recorded.");
        return;
      }

      setShowForm(false);
      onAttached();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      log.error("document upload failed", { orderId, message });
      setError(message);
    } finally {
      setBusy(false);
      // So the same file can be picked again after a failure.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const attached = Boolean(docUrl);

  return (
    <Card className={`mb-3 ${attached ? "" : "border-amber-200"}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Document</p>
            <p className="text-xs text-slate-500">{docLabel(requiredDocType)} required</p>
          </div>
          {attached ? (
            <FileCheck className="h-5 w-5 text-green-600 shrink-0" />
          ) : (
            <FileText className="h-5 w-5 text-amber-500 shrink-0" />
          )}
        </div>

        {attached ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">Number</span>
              <span className="text-xs font-medium text-slate-900 tabular-nums">{docNumber || "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">Date</span>
              <span className="text-xs font-medium text-slate-900 tabular-nums">
                {docDate ? new Date(docDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
              </span>
            </div>
            {docType && docType !== requiredDocType && (
              <p className="text-xs text-red-600">
                A {docLabel(docType).toLowerCase()} is attached, but this transfer needs a{" "}
                {docLabel(requiredDocType).toLowerCase()}. Replace it before dispatch.
              </p>
            )}
            {docUploadedByName && (
              <p className="text-[11px] text-slate-400">
                Attached by {docUploadedByName}
                {docUploadedAt ? ` on ${new Date(docUploadedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <a
                href={docUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-blue-600 font-medium min-h-[44px] focus-ring"
              >
                <ExternalLink className="h-4 w-4" /> View
              </a>
              {canAttach && (
                <button
                  type="button"
                  onClick={() => setShowForm((v) => !v)}
                  className="ml-auto text-xs text-slate-500 font-medium min-h-[44px] focus-ring"
                >
                  Replace
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-amber-700 mb-2">
            {requiredDocType === "TAX_INVOICE"
              ? "Raise the tax invoice in Zoho Books, then attach the PDF here. Dispatch is blocked until it is attached."
              : "Attach the delivery challan. Dispatch is blocked until it is attached."}
          </p>
        )}

        {canAttach && (!attached || showForm) && (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1" htmlFor="doc-number">
                  Number
                </label>
                <Input
                  id="doc-number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  maxLength={40}
                  placeholder="INV-00123"
                  className="min-h-[44px]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1" htmlFor="doc-date">
                  Date
                </label>
                <Input
                  id="doc-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="min-h-[44px]"
                />
              </div>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="w-full min-h-[44px]"
            >
              {busy ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading…</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" /> {attached ? "Replace document" : "Attach document"}</>
              )}
            </Button>
            <p className="text-[11px] text-slate-400">PDF or a photo of the signed document.</p>
          </div>
        )}

        {error && (
          <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg border border-red-200 bg-red-50">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700 break-words">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default DocumentCard;
