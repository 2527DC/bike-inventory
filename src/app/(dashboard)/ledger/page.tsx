"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { formatINR } from "@/lib/utils";

interface Coverage {
  level: "good" | "partial" | "sparse" | "empty";
  ourCount: number;
  theirCount: number;
  message: string;
}

interface LedgerVendor {
  id: string;
  name: string;
  code: string;
  gstin: string | null;
  brands: { id: string; name: string; isPrimary: boolean }[];
  entryCount: number;
  latestStatement: {
    id: string;
    statementDate: string;
    claimedClosing: number | null;
    computedClosing: number | null;
    tiesOut: boolean;
  } | null;
  openClaims: number;
  openClaimValue: number;
  coverage: Coverage;
}

const COVERAGE_STYLE: Record<Coverage["level"], string> = {
  good: "text-emerald-700 bg-emerald-50 border-emerald-200",
  partial: "text-amber-700 bg-amber-50 border-amber-200",
  sparse: "text-orange-700 bg-orange-50 border-orange-200",
  empty: "text-red-700 bg-red-50 border-red-200",
};

export default function LedgerDashboard() {
  const [vendors, setVendors] = useState<LedgerVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/ledger/vendors")
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setVendors(res.data.vendors);
        else setError(res.error || "Failed to load");
      })
      .catch(() => setError("Failed to load ledgers"))
      .finally(() => setLoading(false));
  }, []);

  const totalClaims = vendors.reduce((s, v) => s + v.openClaimValue, 0);
  const totalOpen = vendors.reduce((s, v) => s + v.openClaims, 0);

  if (loading) return <SkeletonList count={5} type="card" />;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-slate-900">Brand Ledgers</h1>
        <p className="text-xs text-slate-500">
          What each supplier says we owe, against what our books say — and what they promised
          but haven&apos;t credited.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {vendors.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-lg font-bold text-slate-900 tabular-nums">{totalOpen}</p>
            <p className="text-[11px] text-slate-500">Open claims</p>
          </div>
          <div className="rounded-lg bg-amber-50 p-3">
            <p className="text-lg font-bold text-amber-900 tabular-nums">
              {formatINR(totalClaims)}
            </p>
            <p className="text-[11px] text-amber-700">Value being chased</p>
          </div>
        </div>
      )}

      {vendors.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No brand ledgers yet</p>
          <p className="text-xs text-slate-400 mt-1">
            Import a supplier statement from a vendor&apos;s page to start reconciling.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {vendors.map((v) => {
            const stmt = v.latestStatement;
            return (
              <Link key={v.id} href={`/ledger/${v.id}`} className="block rounded-xl focus-ring">
                <Card>
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-slate-900 truncate">{v.name}</p>
                          {v.brands.map((b) => (
                            <Badge key={b.id} variant="default" className="text-[10px]">
                              {b.name}
                            </Badge>
                          ))}
                        </div>

                        <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500 tabular-nums">
                          <span>{v.entryCount} statement rows</span>
                          {stmt && (
                            <span>
                              latest {new Date(stmt.statementDate).toLocaleDateString("en-IN")}
                            </span>
                          )}
                        </div>

                        {/* A statement that doesn't add up is a finding in itself. */}
                        {stmt && !stmt.tiesOut && stmt.claimedClosing !== null && (
                          <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-red-600">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            Their statement doesn&apos;t tie: they claim{" "}
                            {formatINR(stmt.claimedClosing)}, their own rows sum to{" "}
                            {formatINR(stmt.computedClosing ?? 0)}
                          </p>
                        )}

                        {v.coverage.level !== "good" && (
                          <p
                            className={`mt-1.5 inline-block rounded border px-1.5 py-0.5 text-[10px] ${COVERAGE_STYLE[v.coverage.level]}`}
                          >
                            {v.coverage.message}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        {v.openClaims > 0 ? (
                          <>
                            <p className="text-sm font-bold text-amber-700 tabular-nums">
                              {formatINR(v.openClaimValue)}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {v.openClaims} open claim{v.openClaims === 1 ? "" : "s"}
                            </p>
                          </>
                        ) : (
                          <p className="flex items-center gap-1 text-[11px] text-emerald-600">
                            <CheckCircle2 className="h-3 w-3" /> nothing open
                          </p>
                        )}
                      </div>

                      <ChevronRight className="h-4 w-4 text-slate-300 shrink-0 mt-1" />
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
