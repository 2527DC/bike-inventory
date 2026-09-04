"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Search, QrCode, Camera, X, Package, AlertCircle, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";

interface SerialResult {
  id: string;
  serialCode: string;
  status: string;
  condition: string;
  receivedAt: string;
  soldAt: string | null;
  customerName: string | null;
  product: { name: string; sku: string; sellingPrice: number; mrp: number };
  bin: { code: string; location: string } | null;
}

interface ProductResult {
  id: string;
  sku: string;
  name: string;
  currentStock: number;
  sellingPrice: number;
  mrp: number;
  bin: { code: string; location: string } | null;
}

function fmt(val: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);
}

export default function ScannerPage() {
  const [search, setSearch] = useState("");
  const [serials, setSerials] = useState<SerialResult[]>([]);
  const [products, setProducts] = useState<ProductResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [lastScanned, setLastScanned] = useState("");
  const scannerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html5ScannerRef = useRef<any>(null);

  const handleSearch = useCallback(async (code: string) => {
    if (code.length < 2) return;
    setLoading(true);
    setSearched(true);
    setSearchError("");
    try {
      const res = await fetch(`/api/serials/search?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (data.success) {
        setSerials(data.data.serials || []);
        setProducts(data.data.products || []);
      } else {
        setSearchError(data.error || "Search failed");
      }
    } catch {
      setSearchError("Network error — check your connection");
    } finally {
      setLoading(false);
    }
  }, []);

  const stopCamera = useCallback(async () => {
    if (html5ScannerRef.current) {
      try {
        await html5ScannerRef.current.stop();
      } catch { /* already stopped */ }
      html5ScannerRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (html5ScannerRef.current) {
        html5ScannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const startCamera = async () => {
    try {
      setCameraError("");
      setCameraActive(true);

      // Dynamic import to avoid SSR issues
      const { Html5Qrcode } = await import("html5-qrcode");

      // Wait for DOM element to be ready
      await new Promise((r) => setTimeout(r, 100));

      const scannerId = "barcode-scanner-region";
      const scanner = new Html5Qrcode(scannerId);
      html5ScannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 120 },
          aspectRatio: 1.5,
        },
        (decodedText) => {
          // Barcode successfully decoded
          setLastScanned(decodedText);
          setSearch(decodedText);
          handleSearch(decodedText);
          // Brief vibration feedback if available
          if (navigator.vibrate) navigator.vibrate(100);
        },
        () => {
          // Scanning in progress — no match yet (expected, not an error)
        }
      );
    } catch (err) {
      setCameraActive(false);
      if (err instanceof Error && err.message.includes("NotAllowed")) {
        setCameraError("Camera access denied. Please allow camera permissions in your browser settings.");
      } else {
        setCameraError("Camera could not be started. Make sure no other app is using the camera.");
      }
    }
  };

  const totalResults = serials.length + products.length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/more" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900">Search & Scanner</h1>
      </div>

      {/* Camera View */}
      {cameraActive ? (
        <div className="relative mb-4">
          <div id="barcode-scanner-region" ref={scannerRef} className="rounded-xl overflow-hidden" />
          <button onClick={stopCamera} aria-label="Stop camera"
            className="absolute top-2 right-2 z-10 bg-black/50 text-white p-2 rounded-full focus-ring">
            <X className="h-5 w-5" />
          </button>
          {lastScanned && (
            <div className="flex items-center gap-3 mt-2 bg-green-50 border border-green-200 rounded-xl p-3">
              <CheckCircle2 className="h-7 w-7 text-green-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-green-800 uppercase tracking-wide">Scanned</p>
                <p className="text-base font-mono font-bold text-green-700 tabular-nums truncate">{lastScanned}</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <button onClick={startCamera}
          className="w-full min-h-[56px] flex items-center justify-center gap-2 bg-slate-100 rounded-xl py-6 mb-4 font-medium hover:bg-slate-200 transition-colors focus-ring">
          <Camera className="h-6 w-6 text-slate-500" />
          <span className="text-sm font-medium text-slate-600">Tap to scan barcode</span>
        </button>
      )}

      {cameraError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{cameraError}</p>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search by serial, SKU, or product name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSearch(search); }}
          className="pl-9 pr-16"
        />
        <button onClick={() => handleSearch(search)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-slate-900 text-white px-3.5 py-2 rounded-md text-xs font-medium focus-ring">
          Search
        </button>
      </div>

      {/* Search Error */}
      {searchError && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-700">{searchError}</p>
          <button onClick={() => setSearchError("")} className="text-amber-500 ml-auto text-xs underline">dismiss</button>
        </div>
      )}

      {/* Results */}
      {loading ? (
        <SkeletonList count={3} type="card" />
      ) : totalResults > 0 ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">{totalResults} result{totalResults !== 1 ? "s" : ""}</p>

          {/* Product Results */}
          {products.length > 0 && (
            <>
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Products</p>
              {products.map((p) => (
                <Link key={p.id} href={`/stock/${p.id}`}>
                  <Card className="hover:bg-slate-50 transition-colors">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between mb-1">
                        <div className="flex-1 min-w-0 mr-2">
                          <p className="text-sm font-medium text-slate-900">{p.name}</p>
                          <p className="text-xs text-slate-500">{p.sku}</p>
                        </div>
                        <Badge variant={p.currentStock > 0 ? "success" : "danger"}>
                          {p.currentStock > 0 ? `${p.currentStock} in stock` : "Out of stock"}
                        </Badge>
                      </div>
                      <div className="flex gap-3 text-xs mt-1.5 tabular-nums">
                        <span className="text-green-600">Sell: {fmt(p.sellingPrice)}</span>
                        <span className="text-slate-500">MRP: {fmt(p.mrp)}</span>
                        {p.bin && <span className="text-slate-500">Bin: {p.bin.code} ({p.bin.location})</span>}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </>
          )}

          {/* Serial Results */}
          {serials.length > 0 && (
            <>
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mt-2">Serial Items</p>
              {serials.map((s) => (
                <Card key={s.id}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between mb-1.5">
                      <div className="flex-1 min-w-0 mr-2">
                        <p className="text-lg font-mono font-bold text-slate-900 tabular-nums break-all">{s.serialCode}</p>
                        <p className="text-sm text-slate-700">{s.product.name}</p>
                        <p className="text-xs text-slate-500">{s.product.sku}</p>
                      </div>
                      <Badge variant={s.status === "IN_STOCK" ? "success" : s.status === "SOLD" ? "info" : s.status === "DAMAGED" ? "danger" : "warning"}>
                        {s.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="flex gap-3 text-xs mt-2 tabular-nums">
                      <span className="text-green-600">Sell: {fmt(s.product.sellingPrice)}</span>
                      <span className="text-slate-500">MRP: {fmt(s.product.mrp)}</span>
                      {s.bin && <span className="text-slate-500">Bin: {s.bin.code}</span>}
                    </div>
                    {s.customerName && (
                      <p className="text-xs text-slate-500 mt-1">Customer: {s.customerName}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">
                      Received: {new Date(s.receivedAt).toLocaleDateString("en-IN")}
                      {s.soldAt && ` | Sold: ${new Date(s.soldAt).toLocaleDateString("en-IN")}`}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </div>
      ) : searched && !loading ? (
        <div className="text-center py-8">
          <QrCode className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No results found</p>
          <p className="text-xs text-slate-300">Try a different search term</p>
        </div>
      ) : (
        <div className="text-center py-8">
          <Package className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Scan a barcode or search manually</p>
          <p className="text-xs text-slate-400 mt-1">Find stock, check location, and view pricing</p>
        </div>
      )}
    </div>
  );
}
