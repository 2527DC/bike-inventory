"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Upload, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { createLogger } from "@/lib/logger";
import { docLabelForMode, type TransferMode } from "./route-picker";

const log = createLogger("transfers:new");

interface Props {
  mode: TransferMode;
  file: File | null;
  number: string;
  date: string;
  /** True while the order is being submitted — nothing here may change mid-flight. */
  disabled: boolean;
  onFileChange: (file: File | null) => void;
  onNumberChange: (value: string) => void;
  onDateChange: (value: string) => void;
}

function isAcceptable(file: File): boolean {
  if (file.type === "application/pdf" || file.type.startsWith("image/")) return true;
  // Some browsers report no MIME type for a PDF picked from a file manager; the name is the
  // only other signal, and the server re-checks the content type on upload regardless.
  return !file.type && file.name.toLowerCase().endsWith(".pdf");
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * The document the transfer travels with, picked BEFORE the order exists.
 *
 * The file is required; the number and date are optional (owner, 9 Sep 2026). Nothing is
 * uploaded here — the page uploads on submit, so a person who changes their mind pays nothing
 * and no orphaned object lands in the bucket. Upload-only, on purpose: a tax invoice is raised
 * in Zoho Books, the tax system of record, and attached here. This app does not generate one.
 */
export function DocumentPicker({
  mode,
  file,
  number,
  date,
  disabled,
  onFileChange,
  onNumberChange,
  onDateChange,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  // Derived, not set in an effect: an object URL per file, revoked when the file changes or
  // the picker unmounts. (Under React's dev-only double render the first URL of a pair leaks
  // until the tab closes — a few bytes, dev only, and cheaper than a cascading render.)
  const previewUrl = useMemo(
    () => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [file]
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    // So the same file can be picked again after a Remove.
    e.target.value = "";
    if (!picked) return;
    if (!isAcceptable(picked)) {
      log.warn("document rejected in the browser", { contentType: picked.type || "unknown", bytes: picked.size });
      setPickError("Only a PDF or an image can be attached.");
      return;
    }
    setPickError(null);
    log.debug("document picked", { contentType: picked.type || "unknown", bytes: picked.size });
    onFileChange(picked);
  }

  const label = docLabelForMode(mode);

  return (
    <Card className={`mb-4 ${file ? "" : "border-amber-200"}`}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Document</p>
            <p className="text-xs text-slate-500">{label} — required</p>
          </div>
          <FileText className={`h-5 w-5 shrink-0 ${file ? "text-green-600" : "text-amber-500"}`} />
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          hidden
          onChange={handlePick}
          disabled={disabled}
        />

        {file ? (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="h-16 w-16 rounded-md object-cover border border-slate-200 shrink-0" />
            ) : (
              <div className="h-16 w-16 rounded-md bg-white border border-slate-200 flex items-center justify-center shrink-0">
                <FileText className="h-6 w-6 text-slate-400" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900 truncate" title={file.name}>{file.name}</p>
              <p className="text-xs text-slate-500 tabular-nums">{formatBytes(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={() => { setPickError(null); onFileChange(null); }}
              disabled={disabled}
              aria-label="Remove document"
              className="min-h-[44px] min-w-[44px] rounded-lg text-red-500 hover:bg-red-50 flex items-center justify-center disabled:opacity-50 focus-ring"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            className="w-full min-h-[44px]"
          >
            <Upload className="h-4 w-4 mr-2" /> Attach {label.toLowerCase()}
          </Button>
        )}
        {!file && <p className="text-[11px] text-slate-400 mt-1.5">PDF or a photo of the signed document.</p>}

        {pickError && (
          <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg border border-red-200 bg-red-50">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{pickError}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mt-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1" htmlFor="doc-number">
              Number (optional)
            </label>
            <Input
              id="doc-number"
              value={number}
              onChange={(e) => onNumberChange(e.target.value)}
              maxLength={40}
              placeholder={mode === "STORE_TO_STORE" ? "INV-00123" : "DC-00123"}
              disabled={disabled}
              className="min-h-[44px]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1" htmlFor="doc-date">
              Date (optional)
            </label>
            <Input
              id="doc-date"
              type="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              disabled={disabled}
              className="min-h-[44px]"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
