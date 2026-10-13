"use client";

// A statement run under review (plan 1310 Parts C and D): the column mapping (sheets the AI
// planned), the balance check over the ticked rows, the rows themselves, the skipped lines, and
// Approve. A mapping change re-applies the plan to the kept cells in the browser — the same
// applyPlan the server ran — so amounts still come from cells, never from a model.
import { useCallback, useMemo, useState } from "react";
import type { StatementProposals } from "@/lib/brand-ledger/ai-run";
import { applyPlan, planProblem, tieOut, type SheetPlan, type SkippedRow } from "@/lib/brand-ledger/prompted-import";
import { createLogger } from "@/lib/logger";
import { ApproveBar, useBarState } from "./approve-bar";
import { BalanceCheck, parseMoney } from "./balance-check";
import { MappingEditor } from "./mapping-editor";
import { acceptRun } from "./review-api";
import {
  editToAcceptRow,
  findDuplicates,
  fmtMoney,
  parseRowAmount,
  plural,
  rowProblem,
  toAcceptRow,
  toEditRows,
  type EditRow,
  type ReviewRun,
} from "./review-types";
import type { PatchRow } from "./row-editors";
import { RowsList } from "./rows-list";
import { SkippedRows } from "./skipped-rows";

const log = createLogger("ledger:review");

const REBUILD_CONFIRM =
  "Changing the mapping rebuilds the rows, the opening and the closing from the sheet. Your ticks and edits will be lost. Continue?";

interface Built {
  rows: EditRow[];
  skipped: SkippedRow[] | undefined;
  skippedCount: number;
  opening: string;
  claimed: string;
}

export function StatementReview({
  run,
  editable,
  onApproved,
  onDiscarded,
  onReload,
}: {
  run: ReviewRun;
  /** DONE, and the person holds Create on Brand Ledgers. */
  editable: boolean;
  onApproved: (added: number) => void;
  onDiscarded: () => void;
  onReload: () => void;
}) {
  const p = run.proposals as StatementProposals;
  const sheets = run.source?.kind === "sheet" ? run.source.sheets : null;
  const aiPlan = p.importPlan ?? null;
  const mappable = editable && !!aiPlan && !!sheets;

  const fromProposals = useCallback(
    (): Built => ({
      rows: toEditRows(p.rows, run.existing),
      skipped: p.skippedRows,
      skippedCount: p.skipped,
      opening: String(p.opening ?? 0),
      claimed: p.claimedClosing === null ? "" : String(p.claimedClosing),
    }),
    [p, run.existing]
  );

  const [plan, setPlan] = useState<SheetPlan | null>(aiPlan);
  const [built, setBuilt] = useState<Built>(fromProposals);
  const [touched, setTouched] = useState(false);
  const [acceptedDiff, setAcceptedDiff] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);
  const bar = useBarState(run.id, onDiscarded);
  const { rows } = built;

  const problem = plan && sheets ? planProblem(plan, sheets) : null;

  /** Replace the rows; false when the person kept their edits instead. */
  const rebuild = (next: Built, nextPlan: SheetPlan | null): boolean => {
    if (touched && !confirm(REBUILD_CONFIRM)) return false;
    setPlan(nextPlan);
    setBuilt(next);
    setTouched(false);
    setAcceptedDiff(null);
    setGeneration((g) => g + 1);
    return true;
  };

  const changeMapping = (next: SheetPlan) => {
    if (!sheets) return;
    const prob = planProblem(next, sheets);
    if (prob) {
      if (rebuild({ rows: [], skipped: [], skippedCount: 0, opening: built.opening, claimed: built.claimed }, next)) {
        log.debug("mapping changed — not usable yet", { runId: run.id });
      }
      return;
    }
    const a = applyPlan(next, sheets);
    const applied = rebuild(
      {
        rows: toEditRows(a.rows, run.existing),
        skipped: a.skipped,
        skippedCount: a.skipped.length,
        opening: String(a.opening),
        claimed: a.claimedClosing === null ? "" : String(a.claimedClosing),
      },
      next
    );
    if (applied) log.debug("mapping re-applied", { runId: run.id, rows: a.rows.length, skipped: a.skipped.length });
  };

  const onPatch: PatchRow = useCallback((key, patch) => {
    setBuilt((b) => ({ ...b, rows: b.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
    setTouched(true);
  }, []);
  const onTickMany = useCallback((keys: Set<number>, ticked: boolean) => {
    setBuilt((b) => ({ ...b, rows: b.rows.map((r) => (keys.has(r.key) && r.ticked !== ticked ? { ...r, ticked } : r)) }));
    setTouched(true);
  }, []);
  const setBalance = (patch: Partial<Pick<Built, "opening" | "claimed">>) => {
    setBuilt((b) => ({ ...b, ...patch }));
    setTouched(true);
  };

  const dups = useMemo(
    () =>
      findDuplicates(
        rows.map((r) => ({ date: r.date, amount: parseRowAmount(r.amount), direction: r.direction, ref: r.ref })),
        run.existing ?? []
      ),
    [rows, run.existing]
  );
  const ticked = useMemo(() => rows.filter((r) => r.ticked), [rows]);
  const unticked = useMemo(() => {
    const out = rows.filter((r) => !r.ticked);
    const signed = out.reduce((sum, r) => sum + r.direction * (parseRowAmount(r.amount) ?? 0), 0);
    return { count: out.length, signed: Math.round(signed * 100) / 100 };
  }, [rows]);
  const openingNum = parseMoney(built.opening);
  const claimedNum = built.claimed.trim() === "" ? null : parseMoney(built.claimed);
  const check = useMemo(
    () =>
      tieOut(
        ticked.map((r) => ({ amount: parseRowAmount(r.amount) ?? 0, direction: r.direction })),
        Number.isNaN(openingNum) ? 0 : openingNum,
        claimedNum === null || Number.isNaN(claimedNum) ? null : claimedNum
      ),
    [ticked, openingNum, claimedNum]
  );
  // The tick covers the difference it was given for; a later edit that moves it un-ticks it.
  const acceptDiff = acceptedDiff !== null && check.difference !== null && Math.abs(acceptedDiff - check.difference) < 0.005;

  const blocked = (() => {
    if (problem) return "Fix the column mapping first.";
    if (ticked.length === 0) return "Tick at least one row.";
    const bad = ticked.find((r) => rowProblem(r));
    if (bad) return `${bad.sourceRow ? `Row ${bad.sourceRow}` : `Line ${rows.indexOf(bad) + 1}`}: ${rowProblem(bad)}.`;
    if (Number.isNaN(openingNum)) return "The opening balance is not a number.";
    if (claimedNum === null) return "Enter the closing balance the statement shows.";
    if (Number.isNaN(claimedNum)) return "The closing balance is not a number.";
    if (!check.tiesOut && !acceptDiff) return "It does not tie out — fix the rows or the balances, or accept the difference.";
    return null;
  })();

  const approve = async () => {
    if (blocked) return;
    const payload = ticked.map(editToAcceptRow);
    // Rows go only when the review changed them; the route notes "rows edited in review" on the
    // statement whenever rows are sent, and that note must stay true.
    const unchanged = JSON.stringify(payload) === JSON.stringify(p.rows.map((r) => toAcceptRow(r)));
    bar.setBusy("approve");
    bar.setError(null);
    const r = await acceptRun(run.id, {
      ...(unchanged ? {} : { rows: payload }),
      opening: openingNum,
      claimedClosing: claimedNum,
      ...(acceptDiff && !check.tiesOut ? { acceptDifference: true } : {}),
    });
    if ("error" in r) {
      bar.setBusy(null);
      bar.setError({ text: r.error, status: r.status });
      return;
    }
    onApproved(r.result.entries ?? payload.length);
  };

  return (
    <div>
      {mappable && plan && aiPlan && sheets && (
        <MappingEditor
          plan={plan}
          aiPlan={aiPlan}
          sheets={sheets}
          problem={problem}
          disabled={bar.busy !== null}
          onChange={changeMapping}
          onReset={() => rebuild(fromProposals(), aiPlan)}
        />
      )}

      <BalanceCheck
        opening={built.opening}
        claimed={built.claimed}
        check={check}
        ticked={ticked.length}
        unticked={unticked}
        acceptDiff={acceptDiff}
        readOnly={!editable || bar.busy !== null}
        onOpening={(v) => setBalance({ opening: v })}
        onClaimed={(v) => setBalance({ claimed: v })}
        onAcceptDiff={(v) => setAcceptedDiff(v ? check.difference : null)}
      />

      <RowsList
        key={generation}
        rows={rows}
        dups={dups}
        aiTyped={!!p.aiTyped}
        readOnly={!editable || bar.busy !== null}
        onPatch={onPatch}
        onTickMany={onTickMany}
      />

      <SkippedRows rows={built.skipped} count={built.skippedCount} />

      {editable && (
        <ApproveBar
          label={`Add ${plural(ticked.length, "row")} to the ledger`}
          status={`${ticked.length.toLocaleString("en-IN")} of ${plural(rows.length, "row")} ticked · ${
            claimedNum === null
              ? "closing not entered"
              : check.tiesOut
                ? "ties out ✓"
                : `off by ${fmtMoney(Math.abs(check.difference ?? 0))}${acceptDiff ? " (accepted)" : ""}`
          }`}
          blocked={blocked}
          busy={bar.busy}
          error={bar.error}
          onApprove={approve}
          onDiscard={bar.discard}
          onReload={onReload}
        />
      )}
    </div>
  );
}
