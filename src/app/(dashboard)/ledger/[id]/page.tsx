"use client";

// /ledger/[vendorId] — the ledger app's per-vendor screen (App.jsx BrandPage), reached only
// from the Ledger button on /vendors/[id]. The shell fetches the view and renders the port;
// every action inside re-fetches through `reload`.
// Plan: docs/implementation/pending/0909-vendor-ledger-screens-and-ai-import-plan.md Part C.
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiTry } from "@/lib/api-client";
import type { LedgerBrandView } from "@/lib/brand-ledger/view-types";
import { createLogger } from "@/lib/logger";
import { BrandPage } from "./_components/brand-page";
import "./ledger.css";

const log = createLogger("ledger:ui");

export default function VendorLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [brand, setBrand] = useState<LedgerBrandView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // A promise chain rather than an async body: state is set inside the callback, which is
  // what react-hooks/set-state-in-effect asks for when an effect kicks off the first load.
  const load = useCallback(
    () =>
      apiTry<LedgerBrandView>(`/api/ledger/vendors/${id}`).then(({ data, error: err, status }) => {
        if (err || !data) {
          log.warn("ledger view failed to load", { vendorId: id, status });
          setError(err || "Failed to load ledger");
        } else {
          setBrand(data);
          setError("");
        }
        setLoading(false);
      }),
    [id]
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <SkeletonList count={6} type="card" />;

  if (!brand) {
    return (
      <div className="text-center py-12">
        <ShieldAlert className="h-12 w-12 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">{error || "Ledger not found"}</p>
        <Link href={`/vendors/${id}`} className="text-sm text-blue-600 mt-2 inline-block">
          Back to vendor
        </Link>
      </div>
    );
  }

  return <BrandPage brand={brand} reload={load} />;
}
