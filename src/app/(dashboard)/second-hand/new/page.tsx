"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Camera, CheckCircle2, Loader2, Search, X, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { uploadImage } from "@/lib/media-upload";
import { compressImageFull } from "@/lib/media-compress";

type Condition = "EXCELLENT" | "GOOD" | "FAIR" | "SCRAP";

const MAX_PHOTOS = 5;

const CONDITIONS: { value: Condition; label: string; color: string }[] = [
  { value: "EXCELLENT", label: "Excellent", color: "bg-green-100 border-green-400 text-green-700" },
  { value: "GOOD", label: "Good", color: "bg-blue-100 border-blue-400 text-blue-700" },
  { value: "FAIR", label: "Fair", color: "bg-amber-100 border-amber-400 text-amber-700" },
  { value: "SCRAP", label: "Scrap", color: "bg-red-100 border-red-400 text-red-700" },
];

export default function NewSecondHandPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role || "";
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form fields
  const [zohoInvoiceNo, setZohoInvoiceNo] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [cycleName, setCycleName] = useState("");
  const [cycleSize, setCycleSize] = useState("");
  const [condition, setCondition] = useState<Condition | "">("");
  const [costPrice, setCostPrice] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  // UI state
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdSku, setCreatedSku] = useState("");

  // Search Zoho for customer details by invoice number
  const handleSearchInvoice = async () => {
    if (!zohoInvoiceNo.trim()) return;
    setSearching(true);
    setError("");
    try {
      const res = await fetch("/api/deliveries/search-zoho", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: zohoInvoiceNo.trim() }),
      });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      if (data.success && data.data.results?.length > 0) {
        const inv = data.data.results[0];
        setCustomerName(inv.customerName || "");
        setCustomerPhone(inv.phone || "");
      } else {
        setError("Invoice not found in Zoho. Enter customer details manually.");
      }
    } catch {
      setError("Could not search Zoho. Enter customer details manually.");
    } finally {
      setSearching(false);
    }
  };

  // Handle adding photos (camera or gallery)
  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remaining = MAX_PHOTOS - photos.length;
    const newFiles = Array.from(files).slice(0, remaining);

    // Generate previews for new files
    newFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setPreviews((prev) => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });

    setPhotos((prev) => [...prev, ...newFiles]);

    // Reset input so the same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const isValid = cycleName && cycleSize && condition && costPrice && parseFloat(costPrice) > 0 && photos.length >= 1 && customerName;

  const handleSubmit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    setError("");
    try {
      // First, create the cycle to get the SKU
      // We need the SKU for the image path, so create without photos first,
      // then upload images, then update with URLs.
      // OR: generate a temporary ID for the path.
      // Simpler: use a timestamp-based path, then update after creation.

      // Generate a temporary unique prefix for upload paths
      const tempPrefix = `sh-${Date.now()}`;

      // Compress and upload all photos to Supabase
      const uploadedUrls: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const { blob, ext, contentType } = await compressImageFull(photos[i], { maxEdge: 800, skipBelow: 0 });
        const file = new File([blob], `${i}.${ext}`, { type: contentType });
        const path = `second-hand/${tempPrefix}/${i}.${ext}`;
        const url = await uploadImage(file, path);
        uploadedUrls.push(url);
      }

      if (uploadedUrls.length === 0) {
        setError("Failed to upload images");
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/second-hand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cycleName,
          size: cycleSize,
          condition,
          costPrice: parseFloat(costPrice),
          photoUrl: uploadedUrls[0],
          photoUrls: uploadedUrls,
          customerName,
          customerPhone: customerPhone || undefined,
          zohoInvoiceNo: zohoInvoiceNo || undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCreatedSku(data.data.sku);
      } else {
        setError(data.error || "Failed to create");
      }
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  // Success screen — show SKU large
  if (createdSku) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
        <h2 className="text-lg font-bold text-slate-900 mb-2">Cycle Added!</h2>
        <p className="text-sm text-slate-500 mb-6">Write this SKU on the cycle</p>

        <div className="bg-orange-50 border-2 border-orange-400 rounded-2xl px-8 py-6 mb-6">
          <p className="text-5xl font-black text-orange-700 tracking-wider">{createdSku}</p>
        </div>

        <p className="text-xs text-slate-400 mb-6">
          {cycleName} | {cycleSize} | {condition}
        </p>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => {
            setCreatedSku("");
            setCycleName("");
            setCycleSize("");
            setCondition("");
            setCostPrice("");
            setPhotos([]);
            setPreviews([]);
            setCustomerName("");
            setCustomerPhone("");
            setZohoInvoiceNo("");
            setNotes("");
          }}>Add Another</Button>
          <Link href="/second-hand">
            <Button className="bg-orange-600 hover:bg-orange-700">View All</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/second-hand" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">Add Second-Hand Cycle</h1>
          <p className="text-xs text-slate-500">Exchange intake</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Step 1: Zoho Invoice Search */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Zoho Invoice No (new cycle sale)</label>
          <div className="flex gap-2">
            <Input placeholder="e.g. 017616" value={zohoInvoiceNo}
              onChange={(e) => setZohoInvoiceNo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearchInvoice()}
              className="min-h-[44px]" />
            <Button type="button" variant="outline" onClick={handleSearchInvoice} disabled={searching}
              className="shrink-0 min-h-[44px]">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Search to auto-fill customer details, or enter manually</p>
        </div>

        {/* Customer Info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Customer Name *</label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Who traded in" className="min-h-[44px]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
            <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Phone number" inputMode="tel" className="min-h-[44px] tabular-nums" />
          </div>
        </div>

        {/* Cycle Name */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Cycle Name *</label>
          <Input value={cycleName} onChange={(e) => setCycleName(e.target.value)}
            placeholder='e.g. "Hero Sprint 26" or "Firefox Road 700c"' className="min-h-[44px]" />
        </div>

        {/* Size */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Wheel Size *</label>
          <div className="grid grid-cols-4 gap-2">
            {['12"', '16"', '20"', '24"', '26"', '27.5"', '29"'].map((s) => (
              <button key={s} type="button" onClick={() => setCycleSize(s)}
                className={`min-h-[44px] rounded-lg text-xs font-semibold border-2 transition-all focus-ring ${
                  cycleSize === s ? "bg-indigo-100 border-indigo-400 text-indigo-700" : "bg-white border-slate-200 text-slate-500"
                }`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Condition */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Condition *</label>
          <div className="grid grid-cols-4 gap-2">
            {CONDITIONS.map((c) => (
              <button key={c.value} type="button" onClick={() => setCondition(c.value)}
                className={`min-h-[44px] rounded-lg text-xs font-semibold border-2 transition-all focus-ring ${
                  condition === c.value ? c.color + " border-current" : "bg-white border-slate-200 text-slate-500"
                }`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Exchange Price (Cost) */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Exchange Price (Cost) *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
            <Input type="number" inputMode="decimal" value={costPrice} onChange={(e) => setCostPrice(e.target.value)}
              placeholder="0" className="pl-7 text-lg font-semibold tabular-nums min-h-[44px]" min="0" />
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Amount given to customer for old cycle</p>
        </div>

        {/* Photos (up to 5, first required) */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Photos * <span className="text-slate-400 font-normal">({photos.length}/{MAX_PHOTOS})</span>
          </label>
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
            onChange={handlePhotoCapture} className="hidden" />

          <div className="grid grid-cols-3 gap-2">
            {/* Existing photo previews */}
            {previews.map((preview, index) => (
              <div key={index} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt={`Photo ${index + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                {index === 0 && (
                  <span className="absolute bottom-1 left-1 bg-orange-600 text-white text-[11px] px-1.5 py-0.5 rounded font-medium">
                    Main
                  </span>
                )}
              </div>
            ))}

            {/* Add photo slot */}
            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="aspect-square border-2 border-dashed border-orange-300 rounded-lg flex flex-col items-center justify-center gap-1 bg-orange-50/50 hover:bg-orange-50 transition-colors"
              >
                {photos.length === 0 ? (
                  <>
                    <Camera className="h-6 w-6 text-orange-400" />
                    <span className="text-[11px] font-medium text-orange-600">Take Photo</span>
                  </>
                ) : (
                  <>
                    <Plus className="h-5 w-5 text-orange-400" />
                    <span className="text-[11px] font-medium text-orange-600">Add More</span>
                  </>
                )}
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">First photo is required. Up to {MAX_PHOTOS} photos.</p>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional details..." rows={2}
            className="flex w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent" />
        </div>

        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}

        <Button type="button" size="lg" disabled={!isValid || submitting} onClick={handleSubmit}
          className="w-full min-h-[48px] rounded-lg font-medium bg-green-600 hover:bg-green-700 text-white">
          {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading & Saving...</> : "Add Second-Hand Cycle"}
        </Button>
        {!isValid && !submitting && (
          <p className="text-xs text-slate-500 text-center">
            Add customer name, cycle name, size, condition, exchange price and at least 1 photo to enable.
          </p>
        )}
      </div>
    </div>
  );
}
