"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { ArrowLeft, Warehouse, Plus, Trash2, ChevronRight, MapPin, Layers, Tag } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";

interface Bin {
  id: string;
  code: string;
  name: string;
  location: string;
}

function abbreviate(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

export default function BinsPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role || "";
  const isAdmin = role === "ADMIN" || role === "CEO";

  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [step, setStep] = useState(1);
  const [mainLocation, setMainLocation] = useState("");
  const [subLocation, setSubLocation] = useState("");
  const [binName, setBinName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState("");
  const [error, setError] = useState("");

  function fetchBins() {
    fetch("/api/bins")
      .then((r) => r.json())
      .then((res) => { if (res.success) setBins(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchBins(); }, []);

  // Extract unique main locations and sub-locations from existing bins
  const existingLocations = useMemo(() => {
    const mainSet = new Map<string, Set<string>>();
    bins.forEach((b) => {
      if (!b.location) return;
      const parts = b.location.split(" - ");
      const main = parts[0].trim();
      if (!mainSet.has(main)) mainSet.set(main, new Set());
      if (parts[1]) mainSet.get(main)!.add(parts[1].trim());
    });
    return mainSet;
  }, [bins]);

  // Generate bin code from inputs
  const generatedCode = useMemo(() => {
    if (!mainLocation.trim()) return "";
    const mainAbbr = abbreviate(mainLocation.trim());
    const subAbbr = subLocation.trim() ? abbreviate(subLocation.trim()) : "";
    const prefix = subAbbr ? `${mainAbbr}-${subAbbr}` : mainAbbr;

    // Find next sequential number for this prefix
    const existing = bins.filter((b) => b.code.startsWith(prefix + "-"));
    const maxNum = existing.reduce((max, b) => {
      const parts = b.code.split("-");
      const last = parseInt(parts[parts.length - 1], 10);
      return isNaN(last) ? max : Math.max(max, last);
    }, 0);

    return `${prefix}-${String(maxNum + 1).padStart(2, "0")}`;
  }, [mainLocation, subLocation, bins]);

  // Build location string for DB
  const locationString = useMemo(() => {
    if (!mainLocation.trim()) return "";
    if (!subLocation.trim()) return mainLocation.trim();
    return `${mainLocation.trim()} - ${subLocation.trim()}`;
  }, [mainLocation, subLocation]);

  function resetForm() {
    setStep(1);
    setMainLocation("");
    setSubLocation("");
    setBinName("");
    setError("");
  }

  async function handleAdd() {
    if (!binName.trim() || !generatedCode) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/bins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: generatedCode,
          name: binName.trim(),
          location: locationString,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to create bin");
      resetForm();
      setShowAdd(false);
      fetchBins();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(binId: string, binCode: string) {
    if (!confirm(`Delete bin "${binCode}"? This cannot be undone.`)) return;
    setDeleting(binId);
    setError("");
    try {
      const res = await fetch(`/api/bins/${binId}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to delete bin");
      fetchBins();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeleting("");
    }
  }

  // Sub-locations for selected main location
  const subLocationsForMain = useMemo(() => {
    const subs = existingLocations.get(mainLocation.trim());
    return subs ? Array.from(subs).sort() : [];
  }, [mainLocation, existingLocations]);

  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Link href="/more" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
          <h1 className="text-lg font-bold text-slate-900 flex-1">Bins &amp; Locations</h1>
        </div>
        <SkeletonList count={5} type="card" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/more" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <h1 className="text-lg font-bold text-slate-900 flex-1">Bins &amp; Locations</h1>
        {isAdmin && (
          <Button size="sm" onClick={() => { setShowAdd(!showAdd); if (showAdd) resetForm(); }} variant={showAdd ? "outline" : "default"}>
            <Plus className="h-4 w-4 mr-1" /> {showAdd ? "Cancel" : "Add Bin"}
          </Button>
        )}
      </div>

      {showAdd && (
        <Card className="mb-4">
          <CardContent className="p-4">
            {/* Step indicators */}
            <div className="flex items-center gap-1 mb-4">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex items-center gap-1">
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    s < step ? "bg-green-100 text-green-700" :
                    s === step ? "bg-slate-900 text-white" :
                    "bg-slate-100 text-slate-400"
                  }`}>
                    {s < step ? "\u2713" : s}
                  </div>
                  {s < 3 && <ChevronRight className="h-3 w-3 text-slate-300" />}
                </div>
              ))}
              <span className="text-xs text-slate-400 ml-2">
                {step === 1 ? "Location" : step === 2 ? "Sub-location" : "Bin Name"}
              </span>
            </div>

            {/* Step 1: Main Location */}
            {step === 1 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <MapPin className="h-4 w-4" /> Main Location
                </div>
                <Input
                  placeholder="e.g. Bharath Cycle Hub, Godown 3"
                  value={mainLocation}
                  onChange={(e) => setMainLocation(e.target.value)}
                  autoFocus
                />
                {Array.from(existingLocations.keys()).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(existingLocations.keys()).sort().map((loc) => (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => setMainLocation(loc)}
                        className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                          mainLocation === loc
                            ? "bg-slate-900 text-white border-slate-900"
                            : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                        }`}
                      >
                        {loc}
                      </button>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!mainLocation.trim()}
                  onClick={() => setStep(2)}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}

            {/* Step 2: Sub-location */}
            {step === 2 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <Layers className="h-4 w-4" /> Sub-location
                </div>
                <p className="text-xs text-slate-400">{mainLocation}</p>
                <Input
                  placeholder="e.g. Ground Floor, First Floor, Area A"
                  value={subLocation}
                  onChange={(e) => setSubLocation(e.target.value)}
                  autoFocus
                />
                {subLocationsForMain.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {subLocationsForMain.map((sub) => (
                      <button
                        key={sub}
                        type="button"
                        onClick={() => setSubLocation(sub)}
                        className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                          subLocation === sub
                            ? "bg-slate-900 text-white border-slate-900"
                            : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                        }`}
                      >
                        {sub}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setStep(1)} className="flex-1">
                    Back
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => setStep(3)}>
                    {subLocation.trim() ? "Next" : "Skip"} <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Bin Name + Review */}
            {step === 3 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <Tag className="h-4 w-4" /> Bin Name
                </div>
                <p className="text-xs text-slate-400">{locationString}</p>
                <Input
                  placeholder="e.g. Assembly Bin, Gear MTB Bin"
                  value={binName}
                  onChange={(e) => setBinName(e.target.value)}
                  autoFocus
                />

                {/* Preview */}
                {generatedCode && (
                  <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
                    <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Preview</p>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                        <span className="text-xs font-bold text-slate-700 tabular-nums">{generatedCode}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{binName || "—"}</p>
                        <p className="text-xs text-slate-500">{locationString}</p>
                      </div>
                    </div>
                  </div>
                )}

                {error && <p className="text-xs text-red-600">{error}</p>}

                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setStep(2)} className="flex-1">
                    Back
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={saving || !binName.trim() || !generatedCode}
                    onClick={handleAdd}
                  >
                    {saving ? "Saving..." : "Create Bin"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {bins.length === 0 ? (
        <div className="text-center py-12">
          <Warehouse className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No bins created yet</p>
          <p className="text-xs text-slate-300 mt-1">Add bins to organize product storage</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bins.map((bin) => (
            <Card key={bin.id}>
              <CardContent className="p-3 flex items-center gap-3 min-h-[44px]">
                <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
                  <span className="text-sm font-bold text-slate-600 tabular-nums">{bin.code}</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">{bin.name}</p>
                  {bin.location && <p className="text-xs text-slate-500">{bin.location}</p>}
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(bin.id, bin.code)}
                    disabled={deleting === bin.id}
                    aria-label={`Delete bin ${bin.code}`}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50 focus-ring"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
