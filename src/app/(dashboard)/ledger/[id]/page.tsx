"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle2, Plus, ShieldAlert, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { formatINR } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";

type Tab = "ledger" | "gaps" | "terms";

interface Entry {
  id: string;
  entryDate: string;
  type: string;
  ref: string | null;
  amount: number;
  direction: number;
  side: string;
  note: string | null;
  source: string;
  auditStatus: string | null;
  auditNote: string | null;
  matchStatus: string;
  reviewNote: string | null;
  balance: number;
  match: { bookId: string | null; kind: string | null; dayGap: number | null; confidence: string } | null;
}

interface Gap {
  id: string;
  number: number;
  title: string;
  gapType: string;
  tier: string | null;
  status: string;
  amount: number | null;
  amountNote: string | null;
  promisedBy: string | null;
  promisedOn: string | null;
  evidenceText: string | null;
  action: string | null;
  result: string | null;
  evidence: { id: string; url: string; kind: string; note: string | null }[];
}

interface BookRecord {
  id: string;
  amount: number;
  kind: "bill" | "payment" | "credit";
  date?: string;
  reference?: string | null;
}

interface Payload {
  vendor: { id: string; name: string; code: string; gstin: string | null; openingBalance: number; brands: { brand: { id: string; name: string } }[] };
  entries: Entry[];
  theyMissing: BookRecord[];
  balance: { opening: number; computedClosing: number; claimedClosing: number | null; difference: number | null; tiesOut: boolean };
  latestStatement: { statementDate: string; claimedClosing: number | null; tiesOut: boolean } | null;
  coverage: { level: string; ourCount: number; theirCount: number; message: string };
  gaps: Gap[];
  canSeeGaps: boolean;
  discountTerms: { id: string; kind: string; percentage: number | null; perUnitAmount: number | null; appliesTo: string | null; effectiveFrom: string | null; isProven: boolean; agreedBy: string | null }[];
}

const STATUS_VARIANT: Record<string, "danger" | "warning" | "info" | "success" | "default"> = {
  OPEN: "danger", PROMISED: "warning", VERIFY: "info", RESOLVED: "success", REJECTED: "default",
};

const MATCH_LABEL: Record<string, { text: string; cls: string }> = {
  MATCHED: { text: "matched", cls: "text-emerald-600" },
  UNMATCHED: { text: "unmatched", cls: "text-slate-400" },
  NEEDS_REVIEW: { text: "needs review", cls: "text-amber-600" },
  THEY_MISSING: { text: "they haven't posted it", cls: "text-red-600" },
  WE_MISSING: { text: "not in our books", cls: "text-orange-600" },
  DISPUTED: { text: "disputed", cls: "text-red-600" },
  IGNORED: { text: "ignored", cls: "text-slate-400" },
};

export default function VendorLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { canEdit } = usePermissions();

  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<Tab>("ledger");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetch(`/api/ledger/vendors/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setData(res.data);
        else setError(res.error || "Failed to load");
      })
      .catch(() => setError("Failed to load ledger"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  async function classify(entryId: string, matchStatus: string) {
    await fetch(`/api/ledger/entries/${entryId}/review`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchStatus }),
    });
    load();
  }

  if (loading) return <SkeletonList count={6} type="card" />;

  if (!data) {
    return (
      <div className="text-center py-12">
        <ShieldAlert className="h-12 w-12 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">{error || "Ledger not found"}</p>
        <Link href="/ledger" className="text-sm text-blue-600 mt-2 inline-block">Back to ledgers</Link>
      </div>
    );
  }

  const { vendor, entries, theyMissing, balance, coverage, gaps, canSeeGaps, discountTerms } = data;
  const openGaps = gaps.filter((g) => ["OPEN", "PROMISED", "VERIFY"].includes(g.status));

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/ledger" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">{vendor.name}</h1>
          <p className="text-xs text-slate-500 truncate">
            {vendor.code}
            {vendor.gstin ? ` · ${vendor.gstin}` : ""}
            {vendor.brands.length ? ` · ${vendor.brands.map((b) => b.brand.name).join(", ")}` : ""}
          </p>
        </div>
      </div>

      {/* Both sides, side by side — the whole point of the tool */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-[11px] text-slate-500">Their statement says</p>
          <p className="text-base font-bold text-slate-900 tabular-nums">
            {balance.claimedClosing !== null ? formatINR(balance.claimedClosing) : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-[11px] text-slate-500">Their rows add up to</p>
          <p className="text-base font-bold text-slate-900 tabular-nums">
            {formatINR(balance.computedClosing)}
          </p>
        </div>
      </div>

      {balance.difference !== null && !balance.tiesOut && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="flex items-start gap-1.5 text-xs text-red-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              <b>Their statement doesn&apos;t tie by {formatINR(Math.abs(balance.difference))}.</b>{" "}
              Their own rows don&apos;t sum to the closing balance they quote — worth raising before
              anything else on this account.
            </span>
          </p>
        </div>
      )}

      {coverage.level !== "good" && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {coverage.message}
        </div>
      )}

      {/* Things we hold that never reached their statement */}
      {theyMissing.length > 0 && (
        <Card className="mb-3 border-l-4 border-l-orange-500">
          <CardContent className="p-3">
            <p className="text-xs font-semibold text-slate-900 mb-1">
              {theyMissing.length} record{theyMissing.length === 1 ? "" : "s"} in our books, absent
              from their statement
            </p>
            <p className="text-[11px] text-slate-500 mb-2">
              Usually payments they haven&apos;t posted yet. Confirm against the bank before raising it.
            </p>
            <div className="space-y-1">
              {theyMissing.slice(0, 6).map((b) => (
                <div key={b.id} className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-600 capitalize">
                    {b.kind}
                    {b.reference ? ` · ${b.reference}` : ""}
                  </span>
                  <span className="font-medium tabular-nums text-slate-900">
                    {formatINR(b.amount)}
                  </span>
                </div>
              ))}
              {theyMissing.length > 6 && (
                <p className="text-[11px] text-slate-400">+{theyMissing.length - 6} more</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-3 border-b border-slate-200">
        {([
          ["ledger", `Ledger (${entries.length})`],
          ...(canSeeGaps ? [["gaps", `Claims (${openGaps.length})`] as [Tab, string]] : []),
          ["terms", `Terms (${discountTerms.length})`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "ledger" && (
        <div className="space-y-1.5">
          {entries.length === 0 && (
            <p className="text-sm text-slate-500 py-8 text-center">
              No statement rows yet. Import a statement to begin.
            </p>
          )}
          {entries.map((e) => {
            const label = MATCH_LABEL[e.matchStatus] ?? MATCH_LABEL.UNMATCHED;
            const needsAttention = ["UNMATCHED", "NEEDS_REVIEW"].includes(e.matchStatus);
            return (
              <Card key={e.id} className={needsAttention ? "border-l-4 border-l-amber-400" : ""}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-slate-400 tabular-nums">
                          {new Date(e.entryDate).toLocaleDateString("en-IN")}
                        </span>
                        <Badge variant="default" className="text-[10px]">
                          {e.type.replace(/_/g, " ").toLowerCase()}
                        </Badge>
                        {e.ref && <span className="text-[11px] font-mono text-slate-600">{e.ref}</span>}
                        {e.source === "MANUAL" && (
                          <Badge variant="info" className="text-[10px]">manual</Badge>
                        )}
                      </div>
                      {e.note && <p className="text-[11px] text-slate-500 mt-0.5">{e.note}</p>}
                      {e.auditNote && (
                        <p className="text-[11px] text-amber-700 mt-0.5">{e.auditNote}</p>
                      )}
                      <p className={`text-[11px] mt-0.5 flex items-center gap-1 ${label.cls}`}>
                        {e.matchStatus === "MATCHED" && <Link2 className="h-3 w-3" />}
                        {label.text}
                        {e.match?.confidence === "likely" && e.match.dayGap !== null && (
                          <span className="text-slate-400">· {e.match.dayGap}d apart</span>
                        )}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p
                        className={`text-sm font-semibold tabular-nums ${
                          e.direction > 0 ? "text-slate-900" : "text-emerald-700"
                        }`}
                      >
                        {e.direction > 0 ? "" : "−"}
                        {formatINR(e.amount)}
                      </p>
                      <p className="text-[11px] text-slate-400 tabular-nums">
                        {formatINR(e.balance)}
                      </p>
                    </div>
                  </div>

                  {/* Safeguard 1: the system surfaces, the human classifies. */}
                  {needsAttention && canEdit("brand_ledger") && (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                      <button
                        onClick={() => classify(e.id, "THEY_MISSING")}
                        className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-100"
                      >
                        They haven&apos;t posted ours
                      </button>
                      <button
                        onClick={() => classify(e.id, "WE_MISSING")}
                        className="rounded border border-orange-200 bg-orange-50 px-2 py-1 text-[10px] font-medium text-orange-700 hover:bg-orange-100"
                      >
                        We never recorded it
                      </button>
                      <button
                        onClick={() => classify(e.id, "MATCHED")}
                        className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100"
                      >
                        Matched
                      </button>
                      <button
                        onClick={() => classify(e.id, "IGNORED")}
                        className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                      >
                        Ignore
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "gaps" && canSeeGaps && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {openGaps.length} open ·{" "}
              {formatINR(openGaps.reduce((s, g) => s + (g.amount ?? 0), 0))} being chased
            </p>
            {canEdit("brand_ledger_gaps") && (
              <Link href={`/ledger/${id}/gaps/new`}>
                <Button size="sm" variant="outline" className="text-xs">
                  <Plus className="h-3.5 w-3.5 mr-1" /> New claim
                </Button>
              </Link>
            )}
          </div>

          {gaps.length === 0 && (
            <p className="text-sm text-slate-500 py-8 text-center">No claims raised yet.</p>
          )}

          {gaps.map((g) => (
            <Card key={g.id}>
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <span className="text-[11px] font-mono text-slate-400 mt-0.5">#{g.number}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{g.title}</p>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <Badge variant={STATUS_VARIANT[g.status] ?? "default"} className="text-[10px]">
                        {g.status.toLowerCase()}
                      </Badge>
                      <span className="text-[10px] text-slate-400">
                        {g.gapType.replace(/_/g, " ").toLowerCase()}
                      </span>
                      {g.tier && (
                        <Badge variant="default" className="text-[10px]">{g.tier.toLowerCase()}</Badge>
                      )}
                    </div>
                    {g.promisedBy && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        promised by {g.promisedBy}
                        {g.promisedOn ? ` on ${new Date(g.promisedOn).toLocaleDateString("en-IN")}` : ""}
                      </p>
                    )}
                    {g.evidenceText && (
                      <p className="text-[11px] text-slate-500 mt-1 italic">{g.evidenceText}</p>
                    )}
                    {g.action && (
                      <p className="text-[11px] text-blue-700 mt-1">Next: {g.action}</p>
                    )}
                    {/* A claim with nothing behind it can't be pressed — say so up front. */}
                    {g.evidence.length === 0 && !g.evidenceText && (
                      <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> no evidence attached
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-slate-900 tabular-nums">
                      {g.amount !== null ? formatINR(g.amount) : g.amountNote || "TBD"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "terms" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            What was agreed with this supplier. Terms marked unproven can&apos;t be pressed in a
            dispute until something in writing is attached.
          </p>
          {discountTerms.length === 0 && (
            <p className="text-sm text-slate-500 py-8 text-center">
              No agreed terms recorded. Without these, discount shortfalls have to be worked out
              by hand.
            </p>
          )}
          {discountTerms.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {t.percentage !== null ? `${t.percentage}%` : ""}
                    {t.perUnitAmount ? ` ${formatINR(t.perUnitAmount)}/unit` : ""}{" "}
                    <span className="text-slate-500 text-xs">
                      {t.kind.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </p>
                  {t.appliesTo && <p className="text-[11px] text-slate-500">on {t.appliesTo}</p>}
                  <p className="text-[11px] text-slate-400">
                    {t.effectiveFrom
                      ? `from ${new Date(t.effectiveFrom).toLocaleDateString("en-IN")}`
                      : "no start date recorded"}
                    {t.agreedBy ? ` · agreed by ${t.agreedBy}` : ""}
                  </p>
                </div>
                {t.isProven ? (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-600 shrink-0">
                    <CheckCircle2 className="h-3 w-3" /> proven
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-amber-600 shrink-0">
                    <AlertTriangle className="h-3 w-3" /> unproven
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
