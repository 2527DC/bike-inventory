"use client";

// /accounts/vendor-ledger — pick a supplier, read its ledger. Plan 1210 credit notes and
// payables, Part 6.3 (R7, R8, R9; X8, X12).
//
// The ledger itself is <VendorLedgerTab exportable />, the same component as the vendor page's
// Ledger tab: store chips from the Store table, Debit and Credit columns, credit notes tinted with
// "applied to …" under them, a Load-more pager whose balance is continuous, and an export of
// every line (`all=1`, up to 5,000) instead of the first 20.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Search, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { useDebounce } from "@/hooks/use-debounce";
import { VendorLedgerTab } from "@/app/(dashboard)/vendors/[id]/_components/vendor-ledger-tab";

const log = createLogger("accounts:vendor-ledger");

interface VendorItem {
  id: string;
  name: string;
  code: string;
  /** Σ (amount − paidAmount) over bills not PAID — no opening, no credit notes. */
  outstandingBalance: number;
  /** Unused part of the vendor's OPEN credit notes. */
  openCredit: number;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default function VendorLedgerPage() {
  const [vendors, setVendors] = useState<VendorItem[]>([]);
  const [selected, setSelected] = useState<VendorItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);

  const loadVendors = useCallback(
    () =>
      apiTry<VendorItem[]>("/api/vendors?limit=200").then(({ data, error: err }) => {
        if (err || !data) {
          log.warn("vendor list failed to load", { error: err });
          setError(err || "Could not load suppliers");
        } else {
          setVendors(data);
          setError(null);
        }
        setLoading(false);
      }),
    [],
  );

  useEffect(() => {
    void loadVendors();
  }, [loadVendors]);

  const q = debouncedSearch.trim().toLowerCase();
  const filteredVendors = vendors.filter((v) => !q || v.name.toLowerCase().includes(q) || v.code.toLowerCase().includes(q));

  if (selected) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => setSelected(null)} className="p-2 -ml-2 rounded-lg hover:bg-slate-100" aria-label="Back to suppliers">
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-slate-900 truncate">{selected.name}</h1>
            <p className="text-xs text-slate-500">
              {selected.code} ·{" "}
              <Link href={`/vendors/${selected.id}`} className="text-blue-600 hover:underline">Open supplier</Link>
            </p>
          </div>
        </div>
        <VendorLedgerTab key={selected.id} vendorId={selected.id} exportable />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/accounts" className="p-2 -ml-2 rounded-lg hover:bg-slate-100" aria-label="Back to accounts">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900">Vendor Ledger</h1>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input placeholder="Search supplier..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-sm text-red-600 mb-2">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              void loadVendors();
            }}
            className="min-h-[44px] px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Retry
          </button>
        </div>
      ) : filteredVendors.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">{q ? "No supplier matches that search" : "No suppliers yet"}</p>
      ) : (
        <div className="space-y-1">
          {filteredVendors.map((v) => (
            <button key={v.id} onClick={() => setSelected(v)} className="w-full text-left">
              <Card className="hover:border-slate-300 transition-colors mb-1">
                <CardContent className="p-3 flex items-center justify-between gap-2 min-h-[44px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{v.name}</p>
                      <p className="text-[11px] text-slate-500">{v.code}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right text-[11px] tabular-nums">
                      {v.outstandingBalance > 0.5 && <p className="text-red-600">Unpaid {formatCurrency(v.outstandingBalance)}</p>}
                      {v.openCredit > 0.5 && <p className="text-purple-700">Credit {formatCurrency(v.openCredit)}</p>}
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
