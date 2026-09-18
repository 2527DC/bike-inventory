"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { usePermissions } from "@/lib/use-permissions";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("settings:approvals");

/**
 * Settings → Approvals (plan 1709-priority-build-and-stock-flow, R26, Q18).
 *
 * Two halves of one question: what counts as an approver's mistake, and who is making them.
 * The rule is editable with `settings.edit`; the table needs `reports.view` and is simply
 * absent without it — the server refuses either way, these checks only decide what is drawn.
 *
 * The rate is NOT a score to manage people by and the copy says so. It is here to find a
 * pattern — one approver whose shipments are corrected every week is usually a training or a
 * paperwork problem, not a dishonest person.
 */

interface ApprovalRules {
  countCorrection: boolean;
  countShortReceive: boolean;
  countReversal: boolean;
  countFlag: boolean;
  windowDays: number;
}

interface ApproverRow {
  approverId: string;
  approverName: string;
  approvals: number;
  errors: { corrections: number; shortReceives: number; reversals: number; flags: number };
  totalErrors: number;
  rate: number | null;
}

interface ErrorRateResponse {
  days: number;
  rules: ApprovalRules;
  approvers: ApproverRow[];
  unmatchedCorrections: number;
}

const TOGGLES: Array<{ key: keyof ApprovalRules; label: string; help: string }> = [
  {
    key: "countCorrection",
    label: "A correction soon after an approval",
    help: "A stock audit changed the quantity of something this approver had let in, within the window below",
  },
  {
    key: "countShortReceive",
    label: "A short receipt",
    help: "A transfer they approved arrived with less than was dispatched",
  },
  {
    key: "countReversal",
    label: "A reversal",
    help: "An approval of theirs was undone — a cancelled approved transfer, a deleted approved shipment",
  },
  {
    key: "countFlag",
    label: "A customer flag",
    help: "Recorded either way. Off by default: a complaint is usually about the goods, not the approval",
  },
];

const WINDOWS = [1, 3, 7, 14, 30];

export default function ApprovalSettingsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canEdit = can("settings", "edit");
  const canSeeReport = can("reports", "view");

  const [rules, setRules] = useState<ApprovalRules | null>(null);
  const [report, setReport] = useState<ErrorRateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    const { data, error: err } = await apiTry<ErrorRateResponse>("/api/approvals/error-rate");
    if (err) {
      log.warn("error rate failed", { message: err });
      return;
    }
    setReport(data);
  }, []);

  useEffect(() => {
    if (permsLoading) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await apiTry<ApprovalRules>("/api/approvals/rules");
      if (!cancelled) {
        if (err) {
          log.warn("approval rules failed", { message: err });
          setError(err);
        } else {
          setRules(data);
        }
      }
      if (canSeeReport) await loadReport();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [permsLoading, canSeeReport, loadReport]);

  async function save() {
    if (!rules) return;
    setSaving(true);
    setError(null);
    const { data, error: err } = await apiTry<ApprovalRules>("/api/approvals/rules", {
      method: "PUT",
      json: rules,
    });
    setSaving(false);
    if (err || !data) {
      log.warn("approval rule save failed", { message: err });
      setError(err ?? "Could not save the rule");
      return;
    }
    setRules(data);
    setBanner("Rule saved — the table below is recalculated from it");
    // The rule changes what counts, so the numbers must be read again, not patched.
    if (canSeeReport) await loadReport();
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-7 w-40 bg-slate-100 rounded animate-pulse" />
        <div className="h-40 rounded-xl bg-slate-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="pb-8">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/settings" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Approvals</h1>
          <p className="text-[11px] text-slate-500">What counts as an approver error, and who is making them</p>
        </div>
      </div>

      {banner && (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-lg border border-green-200 bg-green-50 p-2.5">
          <p className="text-xs text-green-800">{banner}</p>
          <button onClick={() => setBanner(null)} aria-label="Dismiss" className="text-green-600 focus-ring">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {rules && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-slate-900 mb-1">What counts as an error</p>
            <p className="text-[11px] text-slate-500 mb-3">
              Every approval and every outcome is recorded whatever this says. These switches only
              decide what the rate counts.
            </p>

            <div className="space-y-2">
              {TOGGLES.map((t) => (
                <label
                  key={t.key}
                  className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${canEdit ? "cursor-pointer" : "opacity-70"} border-slate-200`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={!canEdit}
                    checked={Boolean(rules[t.key])}
                    onChange={(e) => setRules({ ...rules, [t.key]: e.target.checked })}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-900">{t.label}</span>
                    <span className="block text-[11px] text-slate-500">{t.help}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-4">
              <p className="text-sm text-slate-900">How soon after an approval a correction counts</p>
              <p className="text-[11px] text-slate-500 mb-2">
                A miscount found two months later says nothing about who approved the shipment.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {WINDOWS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setRules({ ...rules, windowDays: d })}
                    className={`min-h-[40px] rounded-lg border px-3 text-sm tabular-nums focus-ring ${
                      rules.windowDays === d
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 text-slate-600"
                    }`}
                  >
                    {d} day{d === 1 ? "" : "s"}
                  </button>
                ))}
              </div>
            </div>

            {canEdit && (
              <Button onClick={save} disabled={saving} className="mt-4 min-h-[44px] w-full">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1.5" /> Save rule</>}
              </Button>
            )}
            {!canEdit && (
              <p className="mt-3 text-[11px] text-slate-400">
                You can read this rule but not change it — that needs the settings edit permission.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {canSeeReport && report && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-slate-900 mb-1">Approver error rate</p>
            <p className="text-[11px] text-slate-500 mb-3">
              Last <span className="tabular-nums">{report.days}</span> days, applying the rule above.
              This is here to find a pattern, not to rank people.
            </p>

            {report.approvers.length === 0 ? (
              <p className="text-sm text-slate-500">Nobody has approved anything in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="py-1.5 pr-2 font-medium">Approver</th>
                      <th className="py-1.5 px-2 font-medium text-right">Approvals</th>
                      <th className="py-1.5 px-2 font-medium text-right">Errors</th>
                      <th className="py-1.5 pl-2 font-medium text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.approvers.map((row) => (
                      <tr key={row.approverId} className="border-t border-slate-100">
                        <td className="py-2 pr-2">
                          <span className="block text-slate-900">{row.approverName}</span>
                          {row.totalErrors > 0 && (
                            <span className="block text-[10px] text-slate-400">
                              {[
                                row.errors.corrections ? `${row.errors.corrections} corrected` : null,
                                row.errors.shortReceives ? `${row.errors.shortReceives} short` : null,
                                row.errors.reversals ? `${row.errors.reversals} reversed` : null,
                                row.errors.flags ? `${row.errors.flags} flagged` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-slate-700">{row.approvals}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-slate-700">{row.totalErrors}</td>
                        <td
                          className={`py-2 pl-2 text-right tabular-nums font-medium ${
                            row.rate !== null && row.rate >= 0.2 ? "text-red-600" : "text-slate-900"
                          }`}
                        >
                          {row.rate === null ? "—" : `${Math.round(row.rate * 100)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {report.unmatchedCorrections > 0 && (
              <p className="mt-3 text-[11px] text-slate-400">
                <span className="tabular-nums">{report.unmatchedCorrections}</span> correction
                {report.unmatchedCorrections === 1 ? "" : "s"} matched no approval inside the window
                and count against nobody — stock that drifted with no approval behind it.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
