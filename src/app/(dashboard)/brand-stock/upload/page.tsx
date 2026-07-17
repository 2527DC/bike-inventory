"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface BrandOption {
  id: string;
  name: string;
  _count: { products: number };
}

export default function BrandStockUploadPage() {
  const router = useRouter();
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [brandId, setBrandId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ uploadId: string; totalItems: number; matchedItems: number; unmatchedItems: number } | null>(null);

  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then((res) => { if (res.success) setBrands(res.data); })
      .catch(() => {});
  }, []);

  const handleUpload = async () => {
    if (!brandId || !file) return;
    setUploading(true);
    setError("");
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("brandId", brandId);

      const res = await fetch("/api/brand-stock/upload", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.error || "Upload failed");
        return;
      }

      setResult(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="pb-24">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/brand-stock" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900 truncate">Upload Brand Stock</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {error}
          <button onClick={() => setError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {!result ? (
        <div className="space-y-4">
          {/* Brand Selector */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Select Brand</label>
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="w-full min-h-[44px] border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Choose a brand...</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b._count.products} products)
                </option>
              ))}
            </select>
          </div>

          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Stock Availability File</label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-6 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors">
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              {file ? (
                <div className="text-center">
                  <FileSpreadsheet className="h-8 w-8 text-green-600 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-900">{file.name}</p>
                  <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB</p>
                  <button onClick={(e) => { e.preventDefault(); setFile(null); }} className="text-xs text-red-500 mt-1 underline">Remove</button>
                </div>
              ) : (
                <div className="text-center">
                  <Upload className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-600">Tap to select file</p>
                  <p className="text-xs text-slate-400 mt-0.5">Excel, CSV, PDF, or Image</p>
                </div>
              )}
            </label>
          </div>

          {/* Upload Button */}
          <div>
            <button
              onClick={handleUpload}
              disabled={!brandId || !file || uploading}
              className="w-full min-h-[48px] bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Parsing & Matching...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Upload & Match
                </>
              )}
            </button>
            {(!brandId || !file) && !uploading && (
              <p className="text-xs text-slate-500 mt-1.5 text-center">
                {!brandId ? "Select a brand to continue" : "Choose a file to upload"}
              </p>
            )}
          </div>
        </div>
      ) : (
        /* Upload Result */
        <div className="space-y-4">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-2" />
              <p className="text-sm font-bold text-green-900">Upload Complete</p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-xl font-bold text-slate-900 tabular-nums">{result.totalItems}</p>
                <p className="text-[11px] text-slate-500">Total Items</p>
              </CardContent>
            </Card>
            <Card className="border-green-200">
              <CardContent className="p-3 text-center">
                <p className="text-xl font-bold text-green-600 tabular-nums">{result.matchedItems}</p>
                <p className="text-[11px] text-slate-500">Matched</p>
              </CardContent>
            </Card>
            <Card className={result.unmatchedItems > 0 ? "border-amber-200" : ""}>
              <CardContent className="p-3 text-center">
                <p className={`text-xl font-bold tabular-nums ${result.unmatchedItems > 0 ? "text-amber-600" : "text-slate-400"}`}>{result.unmatchedItems}</p>
                <p className="text-[11px] text-slate-500">Unmatched</p>
              </CardContent>
            </Card>
          </div>

          <button
            onClick={() => router.push(`/brand-stock/${result.uploadId}`)}
            className="w-full bg-slate-900 text-white py-3 rounded-lg text-sm font-medium"
          >
            Review & Create Order →
          </button>
        </div>
      )}
    </div>
  );
}
