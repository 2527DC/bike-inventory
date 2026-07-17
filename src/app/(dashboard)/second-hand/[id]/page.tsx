"use client";

import { useState, useEffect, use } from "react";
import { useSession } from "next-auth/react";
import { ArrowLeft, Bike, Loader2, Phone, CheckCircle2, X, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { usePermissions } from "@/lib/use-permissions";

interface SecondHandDetail {
  id: string;
  sku: string;
  name: string;
  condition: string;
  status: string;
  costPrice?: number;
  sellingPrice?: number | null;
  size?: string | null;
  photoUrl: string;
  photoUrls: string[];
  customerName: string;
  customerPhone: string | null;
  zohoInvoiceNo: string | null;
  zohoItemId: string | null;
  binId: string | null;
  bin: { code: string; name: string; location: string } | null;
  soldAt: string | null;
  soldToName: string | null;
  soldToPhone: string | null;
  soldInvoiceNo: string | null;
  notes: string | null;
  createdBy: { name: string };
  createdAt: string;
}

const CONDITION_COLORS: Record<string, string> = {
  EXCELLENT: "bg-green-100 text-green-700",
  GOOD: "bg-blue-100 text-blue-700",
  FAIR: "bg-amber-100 text-amber-700",
  SCRAP: "bg-red-100 text-red-700",
};

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function SecondHandDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role || "";
  const { canEdit: canEditCheck } = usePermissions(role);
  const isAdmin = role === "ADMIN" || role === "CEO";
  const canSell = canEditCheck("second_hand");

  const [cycle, setCycle] = useState<SecondHandDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Image gallery state
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Edit states
  const [sellingPrice, setSellingPrice] = useState("");
  const [savingPrice, setSavingPrice] = useState(false);

  // Sell states
  const [showSellForm, setShowSellForm] = useState(false);
  const [soldToName, setSoldToName] = useState("");
  const [soldToPhone, setSoldToPhone] = useState("");
  const [soldInvoiceNo, setSoldInvoiceNo] = useState("");
  const [selling, setSelling] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/second-hand/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setCycle(res.data);
          if (res.data.sellingPrice) setSellingPrice(String(res.data.sellingPrice));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const handleSetPrice = async () => {
    const price = parseFloat(sellingPrice);
    if (!price || price <= 0) return;
    setSavingPrice(true);
    setError("");
    try {
      const res = await fetch(`/api/second-hand/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellingPrice: price }),
      }).then((r) => r.json());
      if (res.success) setCycle(res.data);
      else setError(res.error || "Failed");
    } catch { setError("Network error"); }
    finally { setSavingPrice(false); }
  };

  const handleMarkSold = async () => {
    if (!soldToName) { setError("Buyer name is required"); return; }
    setSelling(true);
    setError("");
    try {
      const res = await fetch(`/api/second-hand/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "SOLD",
          soldToName,
          soldToPhone: soldToPhone || undefined,
          soldInvoiceNo: soldInvoiceNo || undefined,
        }),
      }).then((r) => r.json());
      if (res.success) {
        setCycle(res.data);
        setShowSellForm(false);
      } else setError(res.error || "Failed");
    } catch { setError("Network error"); }
    finally { setSelling(false); }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonList count={5} type="card" />
      </div>
    );
  }

  if (!cycle) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-slate-400">Cycle not found</p>
        <Link href="/second-hand"><Button variant="outline" size="sm" className="mt-3">Back</Button></Link>
      </div>
    );
  }

  // Build the image list: prefer photoUrls, fall back to single photoUrl
  const images: string[] =
    cycle.photoUrls && cycle.photoUrls.length > 0
      ? cycle.photoUrls
      : cycle.photoUrl
        ? [cycle.photoUrl]
        : [];

  const margin = isAdmin && cycle.sellingPrice && cycle.costPrice ? cycle.sellingPrice - cycle.costPrice : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/second-hand" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate tabular-nums">{cycle.sku}</h1>
          <p className="text-xs text-slate-500 truncate">{cycle.name}</p>
        </div>
        <Badge variant={cycle.status === "IN_STOCK" ? "success" : "default"} className="shrink-0">
          {cycle.status === "IN_STOCK" ? "In Stock" : "Sold"}
        </Badge>
      </div>

      {/* Image Gallery */}
      {images.length > 0 ? (
        <div className="mb-4">
          {/* Main image (first) */}
          <div
            className="rounded-xl overflow-hidden bg-slate-100 cursor-pointer"
            onClick={() => setLightboxIndex(0)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images[0]} alt={cycle.name} className="w-full h-64 object-cover" />
          </div>

          {/* Thumbnail strip (horizontal scroll) */}
          {images.length > 1 && (
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1 scrollbar-hide">
              {images.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  className="shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 border-slate-200 hover:border-orange-400 transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden mb-4 bg-slate-100">
          <div className="w-full h-48 flex items-center justify-center">
            <Bike className="h-12 w-12 text-slate-300" />
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxIndex !== null && images.length > 0 && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Close button */}
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10"
            onClick={() => setLightboxIndex(null)}
          >
            <X className="h-7 w-7" />
          </button>

          {/* Previous */}
          {images.length > 1 && (
            <button
              className="absolute left-2 top-1/2 -translate-y-1/2 text-white/70 hover:text-white z-10 p-2"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((lightboxIndex - 1 + images.length) % images.length);
              }}
            >
              <ChevronLeft className="h-8 w-8" />
            </button>
          )}

          {/* Image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[lightboxIndex]}
            alt={`Photo ${lightboxIndex + 1}`}
            className="max-h-[85vh] max-w-[95vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Next */}
          {images.length > 1 && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/70 hover:text-white z-10 p-2"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((lightboxIndex + 1) % images.length);
              }}
            >
              <ChevronRight className="h-8 w-8" />
            </button>
          )}

          {/* Counter */}
          {images.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-sm">
              {lightboxIndex + 1} / {images.length}
            </div>
          )}
        </div>
      )}

      {/* Details */}
      <Card className="mb-3">
        <CardContent className="p-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Condition</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONDITION_COLORS[cycle.condition] || ""}`}>
              {cycle.condition}
            </span>
          </div>
          {cycle.size && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Wheel Size</span>
              <span className="text-sm font-semibold text-indigo-700 tabular-nums">{cycle.size}</span>
            </div>
          )}
          {isAdmin && cycle.costPrice != null && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Cost Price (Exchange)</span>
              <span className="text-sm font-semibold text-slate-900 tabular-nums">{formatINR(cycle.costPrice)}</span>
            </div>
          )}
          {isAdmin && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Selling Price</span>
              <span className={`text-sm font-semibold tabular-nums ${cycle.sellingPrice ? "text-green-600" : "text-slate-400"}`}>
                {cycle.sellingPrice ? formatINR(cycle.sellingPrice) : "Not set"}
              </span>
            </div>
          )}
          {margin !== null && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Margin</span>
              <span className={`text-sm font-semibold tabular-nums ${margin >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatINR(margin)}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Location</span>
            <span className="text-xs text-slate-700 tabular-nums">{cycle.bin ? `${cycle.bin.code} (${cycle.bin.name})` : "—"}</span>
          </div>
          {cycle.zohoItemId && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Zoho Item</span>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Source Customer */}
      <Card className="mb-3">
        <CardContent className="p-3">
          <p className="text-xs text-slate-500 mb-1">Traded in by</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900">{cycle.customerName}</p>
              {cycle.zohoInvoiceNo && <p className="text-xs text-slate-500 tabular-nums">Invoice: {cycle.zohoInvoiceNo}</p>}
            </div>
            {cycle.customerPhone && (
              <a href={`https://wa.me/91${cycle.customerPhone.replace(/\D/g, "").slice(-10)}`}
                target="_blank" rel="noopener noreferrer"
                className="p-2 rounded-full hover:bg-green-50">
                <Phone className="h-4 w-4 text-green-600" />
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sold Details */}
      {cycle.status === "SOLD" && (
        <Card className="mb-3 border-slate-300 bg-slate-50">
          <CardContent className="p-3">
            <p className="text-xs text-slate-500 mb-1">Sold to</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900">{cycle.soldToName || "—"}</p>
                {cycle.soldInvoiceNo && <p className="text-xs text-slate-500 tabular-nums">Invoice: {cycle.soldInvoiceNo}</p>}
                {cycle.soldAt && <p className="text-[11px] text-slate-400 tabular-nums">{new Date(cycle.soldAt).toLocaleDateString("en-IN")}</p>}
              </div>
              {cycle.soldToPhone && (
                <a href={`https://wa.me/91${cycle.soldToPhone.replace(/\D/g, "").slice(-10)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="p-2 rounded-full hover:bg-green-50">
                  <Phone className="h-4 w-4 text-green-600" />
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Admin: Set Selling Price */}
      {isAdmin && cycle.status === "IN_STOCK" && (
        <Card className="mb-3 border-blue-200 bg-blue-50/50">
          <CardContent className="p-3">
            <p className="text-xs font-semibold text-blue-800 mb-2">Set Selling Price</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                <Input type="number" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)}
                  placeholder="0" className="pl-7" min="0" />
              </div>
              <Button onClick={handleSetPrice} disabled={savingPrice || !sellingPrice}
                className="bg-blue-600 hover:bg-blue-700">
                {savingPrice ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mark Sold */}
      {canSell && cycle.status === "IN_STOCK" && (
        <>
          {!showSellForm ? (
            <Button onClick={() => setShowSellForm(true)} size="lg"
              className="w-full min-h-[48px] rounded-lg font-medium bg-green-600 hover:bg-green-700 text-white mb-3">
              <CheckCircle2 className="h-4 w-4 mr-2" />Mark as Sold
            </Button>
          ) : (
            <Card className="mb-3 border-green-200 bg-green-50/50">
              <CardContent className="p-3 space-y-3">
                <p className="text-xs font-semibold text-green-800">Buyer Details</p>
                <Input value={soldToName} onChange={(e) => setSoldToName(e.target.value)}
                  placeholder="Buyer name *" />
                <Input value={soldToPhone} onChange={(e) => setSoldToPhone(e.target.value)}
                  placeholder="Buyer phone" />
                <Input value={soldInvoiceNo} onChange={(e) => setSoldInvoiceNo(e.target.value)}
                  placeholder="Sale invoice number" />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowSellForm(false)} className="flex-1">Cancel</Button>
                  <Button onClick={handleMarkSold} disabled={selling || !soldToName}
                    className="flex-1 min-h-[48px] rounded-lg font-medium bg-green-600 hover:bg-green-700 text-white">
                    {selling ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Sale"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {/* Meta */}
      <p className="text-[11px] text-slate-400 text-center mt-4">
        Added by {cycle.createdBy.name} on <span className="tabular-nums">{new Date(cycle.createdAt).toLocaleDateString("en-IN")}</span>
        {cycle.notes && ` | ${cycle.notes}`}
      </p>
    </div>
  );
}
