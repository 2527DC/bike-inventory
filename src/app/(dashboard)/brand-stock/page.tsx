"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Upload, FileSpreadsheet, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiTry } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { createLogger } from "@/lib/logger";

const log = createLogger("brand-stock:list");

interface UploadItem {
  id: string;
  fileName: string;
  fileType: string;
  status: string;
  totalItems: number;
  matchedItems: number;
  unmatchedItems: number;
  createdAt: string;
  brand: { name: string };
  uploadedBy: { name: string };
}

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  PROCESSING: { label: "Processing", color: "bg-blue-100 text-blue-700" },
  PARSED: { label: "Ready", color: "bg-green-100 text-green-700" },
  REVIEWED: { label: "Reviewed", color: "bg-slate-100 text-slate-700" },
  FAILED: { label: "Failed", color: "bg-red-100 text-red-700" },
};

export default function BrandStockPage() {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { canCreate } = usePermissions();
  const canUpload = canCreate("brand_stock");

  // The loader lives INSIDE the effect behind a `cancelled` guard — the shape P7's
  // `inbound/[id]` established as the one that lints clean under react-hooks.
  //
  // What was here read `fetch(...).then(r => r.json()).catch(() => {})`, which CLAUDE.md
  // bans outright and this screen demonstrated why: an expired session 307s to /login, which
  // returns HTML with status 200, so `res.success` was undefined, the catch swallowed it and
  // the page rendered "No stock uploads yet". A logged-out user was told their data did not
  // exist. `apiTry` reads the content type and reports the auth failure as one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await apiTry<UploadItem[]>("/api/brand-stock/uploads");
      if (cancelled) return;
      if (err) {
        log.error("uploads load failed", { error: err });
        setError(err);
      } else {
        setUploads(data ?? []);
        setError(null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  return (
    <div className="pb-24">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-slate-900">Brand Stock</h1>
        {/* Cosmetic only, as CLAUDE.md requires — POST /api/brand-stock/upload re-checks
            `brand_stock.create` server-side. Hiding it stops a viewer-only role walking into
            a 403 at the end of picking a file. */}
        {canUpload && (
          <Link href="/brand-stock/upload"
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-medium">
            <Plus className="h-3.5 w-3.5" /> Upload Stock
          </Link>
        )}
      </div>

      <p className="text-xs text-slate-500 mb-4">
        Upload brand availability sheets (Excel/CSV), match with your inventory, and generate purchase orders.
      </p>

      {error ? (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium text-red-700">Could not load uploads</p>
            <p className="text-xs text-red-600 mt-1">{error}</p>
            <button
              onClick={() => { setLoading(true); setError(null); setReloadKey((k) => k + 1); }}
              className="mt-3 text-xs font-medium text-red-700 underline"
            >
              Retry
            </button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 border border-slate-100 rounded-lg animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-3/4 mb-2" />
              <div className="h-3 bg-slate-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : uploads.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FileSpreadsheet className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500 mb-1">No stock uploads yet</p>
            <p className="text-xs text-slate-400 mb-4">Upload a brand&rsquo;s stock sheet to match with your inventory</p>
            {canUpload ? (
              <Link href="/brand-stock/upload"
                className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                <Upload className="h-4 w-4" /> Upload First Sheet
              </Link>
            ) : (
              // Without this branch a view-only role sees an empty page whose only call to
              // action has vanished, which reads as broken rather than as "not yours".
              <p className="text-xs text-slate-400">
                Ask an admin for Brand Stock &rsaquo; Create to upload one.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {uploads.map((u) => {
            const badge = STATUS_BADGE[u.status] || STATUS_BADGE.PARSED;
            return (
              <Link key={u.id} href={`/brand-stock/${u.id}`}>
                <Card className="hover:border-slate-300 transition-colors mb-2">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 mr-3">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="h-4 w-4 text-green-600 shrink-0" />
                          <p className="text-sm font-medium text-slate-900 truncate">{u.brand.name}</p>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{u.fileName}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400">
                          <span>{u.totalItems} items</span>
                          <span className="text-green-600">{u.matchedItems} matched</span>
                          {u.unmatchedItems > 0 && <span className="text-amber-600">{u.unmatchedItems} unmatched</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge className={`text-[10px] ${badge.color}`}>{badge.label}</Badge>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {new Date(u.createdAt).toLocaleDateString("en-IN")}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
