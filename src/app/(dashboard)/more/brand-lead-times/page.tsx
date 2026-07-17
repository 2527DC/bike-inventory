"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Loader2, Save, Clock } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";

interface BrandLead {
  brandId: string;
  brandName: string;
  leadDays: number;
}

export default function BrandLeadTimesPage() {
  const [brands, setBrands] = useState<BrandLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/brand-lead-time")
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setBrands(res.data);
          const vals: Record<string, string> = {};
          res.data.forEach((b: BrandLead) => { vals[b.brandId] = String(b.leadDays); });
          setEditValues(vals);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (brandId: string) => {
    const leadDays = parseInt(editValues[brandId]);
    if (!leadDays || leadDays < 1) return;

    setSaving(brandId);
    try {
      await fetch("/api/brand-lead-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, leadDays }),
      }).then((r) => r.json());

      setBrands((prev) => prev.map((b) => b.brandId === brandId ? { ...b, leadDays } : b));
    } catch { /* */ }
    finally { setSaving(null); }
  };

  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Link href="/more" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring">
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Brand Lead Times</h1>
            <p className="text-xs text-slate-500">Set delivery days per brand for inbound tracking</p>
          </div>
        </div>
        <SkeletonList count={6} type="card" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/more" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Brand Lead Times</h1>
          <p className="text-xs text-slate-500">Set delivery days per brand for inbound tracking</p>
        </div>
      </div>

      <div className="space-y-2">
        {brands.map((b) => {
          const changed = editValues[b.brandId] !== String(b.leadDays);
          return (
            <Card key={b.brandId}>
              <CardContent className="p-3 flex items-center gap-3">
                <Clock className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="text-sm font-medium text-slate-900 flex-1">{b.brandName}</span>
                <div className="flex items-center gap-2">
                  <Input type="number" min="1" max="90" inputMode="numeric"
                    value={editValues[b.brandId] || ""}
                    onChange={(e) => setEditValues((prev) => ({ ...prev, [b.brandId]: e.target.value }))}
                    className="w-16 text-center text-sm tabular-nums" />
                  <span className="text-xs text-slate-400">days</span>
                  {changed && (
                    <Button size="sm" variant="outline" onClick={() => handleSave(b.brandId)}
                      disabled={saving === b.brandId}>
                      {saving === b.brandId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {brands.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">No brands found. Add brands first.</p>
        )}
      </div>
    </div>
  );
}
