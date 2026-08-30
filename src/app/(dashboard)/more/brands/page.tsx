"use client";

import { useState, useEffect } from "react";
import { usePermissions } from "@/lib/use-permissions";
import { ArrowLeft, Trash2, Tag, ChevronDown } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";

interface BrandItem {
  id: string;
  name: string;
  _count: { products: number };
}

export default function BrandsPage() {
  // canCreate, not canView: this page's whole purpose is merging brands, which
  // api/brands/[id]/merge guards with requireFeature("brands", "create").
  const { canCreate, loading: permsLoading } = usePermissions();
  const isAdmin = canCreate("brands");

  const [brands, setBrands] = useState<BrandItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState("");

  function fetchBrands() {
    setLoading(true);
    fetch("/api/brands")
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setBrands(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchBrands();
  }, []);

  async function handleMerge() {
    if (!mergeSource || !mergeTarget) return;
    setMerging(true);
    setError("");
    try {
      const res = await fetch(`/api/brands/${mergeSource}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetBrandId: mergeTarget }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to merge brand");
      setMergeSource(null);
      setMergeTarget("");
      fetchBrands();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setMerging(false);
    }
  }

  // `permsLoading` first, always. Rendering a denial before the grants arrive produces a
  // flash of "access required" on every visit — the same symptom as the bug being fixed.
  if (permsLoading) return null;

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-400">You do not have permission to merge brands</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Link
            href="/more"
            aria-label="Back"
            className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"
          >
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </Link>
          <h1 className="text-lg font-bold text-slate-900 flex-1">Brand Management</h1>
        </div>
        <SkeletonList count={6} type="card" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link
          href="/more"
          aria-label="Back"
          className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900 flex-1">
          Brand Management
        </h1>
        <Badge variant="info" className="tabular-nums">{brands.length} brands</Badge>
      </div>

      {error && (
        <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {brands.length === 0 ? (
        <div className="text-center py-12">
          <Tag className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No brands found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {brands.map((brand) => (
            <Card key={brand.id}>
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
                    <span className="text-sm font-bold text-slate-600">
                      {brand.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {brand.name}
                    </p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {brand._count.products} product
                      {brand._count.products !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {mergeSource === brand.id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setMergeSource(null);
                        setMergeTarget("");
                        setError("");
                      }}
                    >
                      Cancel
                    </Button>
                  ) : (
                    <button
                      aria-label={`Merge and delete ${brand.name}`}
                      onClick={() => {
                        setMergeSource(brand.id);
                        setMergeTarget("");
                        setError("");
                      }}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors focus-ring shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {mergeSource === brand.id && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-xs text-slate-500 mb-2">
                      Move {brand._count.products} product
                      {brand._count.products !== 1 ? "s" : ""} to:
                    </p>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <select
                          value={mergeTarget}
                          onChange={(e) => setMergeTarget(e.target.value)}
                          className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 pr-8 text-sm text-slate-900 appearance-none focus:outline-none focus:ring-2 focus:ring-slate-400"
                        >
                          <option value="">Select brand...</option>
                          {brands
                            .filter((b) => b.id !== brand.id)
                            .map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name} ({b._count.products})
                              </option>
                            ))}
                        </select>
                        <ChevronDown className="h-4 w-4 text-slate-400 absolute right-2 top-2.5 pointer-events-none" />
                      </div>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!mergeTarget || merging}
                        onClick={handleMerge}
                      >
                        {merging ? "Moving..." : "Merge & Delete"}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
