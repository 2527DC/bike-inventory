"use client";

import { useState } from "react";
import Link from "next/link";
import { Link2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { accountChipLabel, dayLabel, type BankAccountRow, type StatementRow } from "./types";

const log = createLogger("accounts:bank-upload");

interface AssignResult {
  id: string;
  bankAccountId: string;
  accountName: string | null;
  lines: number;
  unchanged?: boolean;
}

/**
 * Statements uploaded before bank accounts existed carry only "HDFC" or "ICICI" (plan Q7). Each
 * gets an account select filtered to its bank — pre-selected when exactly one account matches,
 * so an ICICI file is one tap; an HDFC file must be chosen, because Hub and Centre cannot be told
 * apart from the file. Shown only with Bank Reconciliation › Edit (cosmetic; PATCH re-checks).
 */
export function AssignSection({
  statements, accounts, onAssigned,
}: { statements: StatementRow[]; accounts: BankAccountRow[]; onAssigned: (message: string) => void }) {
  if (statements.length === 0) return null;
  return (
    <section aria-labelledby="assign-account" className="mb-5">
      <h2 id="assign-account" className="text-sm font-semibold text-slate-900">Assign an account</h2>
      <p className="text-[11px] text-slate-500 mb-2">
        Uploaded before bank accounts existed. Until each has its account, the weekly status does not count it.
      </p>
      <div className="space-y-2">
        {statements.map((s) => (
          <AssignRow key={s.id} s={s} accounts={accounts.filter((a) => a.bank === s.bank)} onAssigned={onAssigned} />
        ))}
      </div>
    </section>
  );
}

function AssignRow({
  s, accounts, onAssigned,
}: { s: StatementRow; accounts: BankAccountRow[]; onAssigned: (message: string) => void }) {
  // Exactly one account at this bank → pre-selected. Two (HDFC Hub, HDFC Centre) → a person picks.
  const [choice, setChoice] = useState(accounts.length === 1 ? accounts[0].id : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (!choice || busy) return; // a double tap sends once
    setBusy(true);
    setError(null);
    const { data, error: err, status } = await apiTry<AssignResult>(`/api/bank-statements/${encodeURIComponent(s.id)}`, {
      method: "PATCH",
      json: { bankAccountId: choice },
    });
    setBusy(false);
    if (err || !data) {
      log.error("assign account failed", { statementId: s.id, bankAccountId: choice, status, message: err });
      setError(err || "The statement could not be assigned.");
      return;
    }
    log.info("statement assigned", { statementId: s.id, bankAccountId: data.bankAccountId, lines: data.lines });
    onAssigned(
      data.unchanged
        ? `${s.fileName} was already on ${data.accountName ?? "that account"}.`
        : `${s.fileName} is now on ${data.accountName ?? "the account"} — ${data.lines} line${data.lines === 1 ? "" : "s"} moved with it.`
    );
  }

  const period =
    s.fromDate && s.toDate ? `${dayLabel(s.fromDate, { year: false })} – ${dayLabel(s.toDate)}` : `Uploaded ${dayLabel(s.createdAt)}`;

  return (
    <Card className="border-amber-200">
      <CardContent className="p-3 space-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Badge variant="warning" className="text-[10px]">{s.bank}</Badge>
            <p className="text-sm font-medium text-slate-900 truncate" title={s.fileName}>{s.fileName}</p>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            {period} · {s.progress.total} lines · by {s.uploadedBy.name}
          </p>
        </div>

        {accounts.length === 0 ? (
          <p className="text-[11px] text-slate-600">
            No {s.bank} account yet —{" "}
            <Link href="/accounts/bank-accounts" className="text-blue-600 underline">add one on Bank accounts</Link>.
          </p>
        ) : (
          <div className="flex gap-2">
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              disabled={busy}
              aria-label={`Account for ${s.fileName}`}
              className="flex-1 min-w-0 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-ring disabled:opacity-60"
            >
              <option value="">Pick the {s.bank} account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{accountChipLabel(a)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void assign()}
              disabled={!choice || busy}
              className="shrink-0 min-h-[44px] px-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-50 focus-ring"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Assign
            </button>
          </div>
        )}
        {error && <p role="alert" className="text-[11px] text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
