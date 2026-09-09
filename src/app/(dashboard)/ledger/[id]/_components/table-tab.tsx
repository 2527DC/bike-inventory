"use client";

// App.jsx:998-1168 — Table view: Purchase | Payment | Discount | Gap | Balance
// Formula: ΣPurchase − ΣPayment − ΣDiscount = their-books balance; − ΣGap = TRUE PAYABLE.
// Recorded credits sit in Discount (their ledger); un-recorded claims sit in Gap (our ledger).
// Objective: drive every Gap → 0 by getting it recorded (it then moves to Discount).
import { useMemo, useState } from "react";
import type { LedgerBrandView, LedgerViewEntry, LedgerViewGap } from "@/lib/brand-ledger/view-types";
import { usePermissions } from "@/lib/use-permissions";
import { EntryExplain } from "./entry-explain";
import { Evidence } from "./evidence";
import { EvidenceUpload } from "./evidence-upload";
import { GapShots } from "./gap-shots";
import {
  downloadCSV,
  entryDir,
  fmtINR,
  gapAmount,
  gapId,
  openGaps,
  sortEntries,
  statusColor,
  today,
} from "./ledger-helpers";

type Row =
  | {
      kind: "entry";
      eid: string;
      e: LedgerViewEntry;
      date: string;
      ref: string;
      label: string;
      purchase?: number | null;
      payment?: number | null;
      discount?: number | null;
      gap?: number | null;
      balance: number;
      audit?: LedgerViewEntry["audit"];
    }
  | {
      kind: "gap";
      n: number;
      g: LedgerViewGap;
      date: string;
      ref: string;
      label: string;
      purchase?: number | null;
      payment?: number | null;
      discount?: number | null;
      gap: number | null;
      status: string;
      tier: string;
    };

export function TableTab({
  brand,
  reload,
  onOpenGap,
}: {
  brand: LedgerBrandView;
  reload: () => Promise<void> | void;
  onOpenGap?: (n: number) => void;
}) {
  const { canEdit } = usePermissions();
  const canEditGaps = canEdit("brand_ledger_gaps");
  const [open, setOpen] = useState<string | null>(null); // 'g<n>' for a gap row, 'e<id>' for an entry row

  const { rows, totals } = useMemo(() => {
    const col = (e: LedgerViewEntry) =>
      e.type === "invoice" || e.type === "debit-note"
        ? "purchase"
        : e.type === "payment"
          ? "payment"
          : e.type === "note"
            ? null
            : "discount";
    // ascending entries with running their-books balance (IGNORED rows left out — plan D3)
    const asc = sortEntries(brand.entries.filter((e) => !e.ignored));
    let bal = brand.ledger?.opening?.amount || 0;
    const entryRows: Row[] = [];
    for (const e of asc) {
      const c = col(e);
      if (!c) continue;
      bal += (e.dir ?? entryDir(e.type)) * (e.amount || 0);
      const row: Extract<Row, { kind: "entry" }> = {
        kind: "entry",
        eid: e.id,
        e,
        date: e.date,
        ref: e.ref,
        label: e.note,
        balance: bal,
        audit: e.audit,
      };
      row[c] = e.amount;
      entryRows.push(row);
    }
    // gap rows: anchor to linked invoice date (via audit) else brand.updated
    const anchorFor = (g: LedgerViewGap) => {
      const linked = asc.find((e) => e.audit?.g === g.n);
      // The app fell back to a fixed date here (App.jsx:1015, the day it was written). A literal
      // would render as a real date on every vendor with no `updated`, so the fallback is today:
      // an unanchored open gap sorts to the top of the table.
      return linked ? linked.date : brand.updated || today();
    };
    const gapRows: Row[] = openGaps(brand)
      .filter((g) => g.amt)
      .map((g) => ({
        kind: "gap" as const,
        n: g.n,
        g,
        date: anchorFor(g),
        ref: gapId(brand, g.n),
        label: g.title,
        gap: g.amt,
        status: g.status,
        tier: g.tier || "firm",
      }));
    const all = [...entryRows, ...gapRows].sort(
      (a, b) => b.date.localeCompare(a.date) || (a.kind === "gap" ? -1 : 1)
    );
    const tierSum = (t: string) =>
      gapRows.filter((r) => r.kind === "gap" && r.tier === t).reduce((s, r) => s + (r.gap || 0), 0);
    const t = {
      purchase: entryRows.reduce((s, r) => s + (r.purchase || 0), 0),
      payment: entryRows.reduce((s, r) => s + (r.payment || 0), 0),
      discount: entryRows.reduce((s, r) => s + (r.discount || 0), 0),
      gap: gapRows.reduce((s, r) => s + (r.gap || 0), 0),
      gapFirm: tierSum("firm"),
      gapCond: tierSum("conditional"),
      gapLev: tierSum("leverage"),
      gapVerify: tierSum("verify"),
      opening: brand.ledger?.opening?.amount || 0,
      closing: bal,
    };
    return { rows: all, totals: t };
  }, [brand]);

  const settleTarget = totals.closing - totals.gapFirm; // realistic (verify NOT deducted)
  const bestCase = settleTarget - totals.gapCond; // + conditional conceded to you
  const floor = bestCase - totals.gapLev; // + leverage won (long-shot)
  const hasTiers = totals.gapCond > 0 || totals.gapLev > 0 || totals.gapVerify > 0;

  const exportCsv = () =>
    downloadCSV(`${brand.id}-table-${today()}.csv`, [
      ["Date", "Ref", "Purchase", "Payment", "Discount", "Gap", "Balance", "Detail"],
      ...rows.map((r) => [
        r.date,
        r.ref,
        r.purchase || "",
        r.payment || "",
        r.discount || "",
        r.gap || "",
        r.kind === "entry" ? Math.round(r.balance) : "",
        r.label || "",
      ]),
      [],
      ["TOTALS", "", Math.round(totals.purchase), Math.round(totals.payment), Math.round(totals.discount), Math.round(totals.gap), "", ""],
      ["THEIR BOOKS BALANCE", "", "", "", "", "", Math.round(totals.closing), "opening " + totals.opening + " + purchases − payments − discounts"],
      ["SETTLE AT (− firm gaps)", "", "", "", "", "", Math.round(settleTarget), "their books − firm gaps"],
    ]);

  return (
    <>
      <div className="card matchbar">
        <div className="ladder">
          <div className="lrow">
            <span>Their books (Purchase − Payment − Discount)</span>
            <b>{fmtINR(totals.closing)}</b>
          </div>
          <div className="lrow sub">
            <span>− Firm gaps (high-confidence claims)</span>
            <b className="green">− {fmtINR(totals.gapFirm)}</b>
          </div>
          <div className="lrow target">
            <span>= SETTLE AT (realistic target)</span>
            <b>{fmtINR(settleTarget)}</b>
          </div>
          {totals.gapCond > 0 && (
            <div className="lrow sub">
              <span>− Conditional (kids bills, likely conceded)</span>
              <b className="muted">− {fmtINR(totals.gapCond)}</b>
            </div>
          )}
          {totals.gapCond > 0 && (
            <div className="lrow">
              <span>= Best case</span>
              <b>{fmtINR(bestCase)}</b>
            </div>
          )}
          {totals.gapLev > 0 && (
            <div className="lrow sub">
              <span>− Leverage upside (long-shot claims)</span>
              <b className="muted">− {fmtINR(totals.gapLev)}</b>
            </div>
          )}
          {totals.gapLev > 0 && (
            <div className="lrow floor">
              <span>= Aggressive floor (only if you win everything)</span>
              <b>{fmtINR(floor)}</b>
            </div>
          )}
          {totals.gapVerify > 0 && (
            <div className="lrow verify">
              <span>
                ⚠ Separately: {fmtINR(totals.gapVerify)} in figures to INVESTIGATE (balances/errors — not deducted, not
                money you&apos;re owed)
              </span>
            </div>
          )}
        </div>
        <div className="covnote">
          {hasTiers
            ? "Settle at the realistic target. Firm = what the vendor will actually post; conditional & leverage are negotiating room; verify = discrepancies to chase, not recoverables."
            : "Purchase − Payment − Discount − Gaps. Every gap told → recorded → moves to Discount → Gap hits zero."}
        </div>
      </div>

      <div className="tablewrap card">
        <table className="ltable">
          <thead>
            <tr>
              <th>Date</th>
              <th>Ref</th>
              <th>Purchase</th>
              <th>Payment</th>
              <th>Discount</th>
              <th>Gap</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r, i) => {
              const isGap = r.kind === "gap";
              const key = r.kind === "gap" ? "g" + r.n : "e" + r.eid;
              const isOpen = open === key;
              const els = [
                <tr
                  key={i}
                  className={
                    (r.kind === "gap" ? "gaprow tier-" + r.tier + " " : "") + "clickable" + (isOpen ? " rowopen" : "")
                  }
                  onClick={() => setOpen(isOpen ? null : key)}
                >
                  <td className="td-date">
                    <span className="gapcaret">{isOpen ? "▾" : "▸"}</span>
                    {r.date}
                  </td>
                  <td className="td-ref">
                    {r.ref || <span className="td-plain">{(r.label || (r.kind === "entry" ? r.e.type : "") || "").slice(0, 40)}</span>}
                    {r.kind === "gap" && <span className="tiertag">{r.tier}</span>}
                    {r.kind === "gap" && <div className="td-sub">{(r.label || "").slice(0, 55)}</div>}
                    {!isGap && r.ref && r.label && <div className="td-sub2">{(r.label || "").slice(0, 55)}</div>}
                  </td>
                  <td className="num red">{r.purchase ? fmtINR(r.purchase) : ""}</td>
                  <td className="num green">{r.payment ? fmtINR(r.payment) : ""}</td>
                  <td className="num green">{r.discount ? fmtINR(r.discount) : ""}</td>
                  <td className="num amber">{r.gap ? fmtINR(r.gap) : ""}</td>
                  <td className="num">{r.kind === "entry" ? fmtINR(r.balance) : ""}</td>
                </tr>,
              ];
              if (isOpen && r.kind === "gap") {
                const g = r.g;
                els.push(
                  <tr key={i + "-d"} className="gapdetailrow">
                    <td colSpan={7}>
                      <div className="gapdetail">
                        <div className="gd-head">
                          <b>{gapId(brand, g.n)}</b>
                          <span className={"chip " + (statusColor[g.status] || "")}>{g.status}</span>
                          <span className="chip">{g.type}</span>
                          <span className="gd-amt">{gapAmount(g)}</span>
                        </div>
                        <div className="gd-title">{g.title}</div>
                        {g.result && (
                          <div className="result">
                            <span className="result-lbl">✓ Result</span> {g.result}
                          </div>
                        )}
                        {g.evidence && (
                          <div className="gd-sec">
                            <span className="gd-lbl">Evidence · reference &amp; chat proof</span>
                            <Evidence text={g.evidence} />
                          </div>
                        )}
                        {g.action && (
                          <div className="gd-sec">
                            <span className="gd-lbl">Action</span>
                            {g.action}
                          </div>
                        )}
                        <GapShots gap={g} />
                        {canEditGaps && <EvidenceUpload gapId={g.id} reload={reload} />}
                        {(g.progress || []).length > 0 && (
                          <div className="gd-sec">
                            <span className="gd-lbl">History ({(g.progress || []).length})</span>
                            {(g.progress || []).map((p, j) => (
                              <div key={p.id || j} className="gd-note">
                                <b>{p.date}</b> — {p.text}
                              </div>
                            ))}
                          </div>
                        )}
                        {onOpenGap && (
                          <button
                            className="iconbtn primary gd-open"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              onOpenGap(g.n);
                            }}
                          >
                            Open full gap (edit / history) →
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }
              if (isOpen && r.kind === "entry") {
                els.push(
                  <tr key={i + "-d"} className="gapdetailrow">
                    <td colSpan={7}>
                      <div className="entrydetail">
                        <EntryExplain e={r.e} brand={brand} onOpenGap={onOpenGap} />
                        <div className="ed-foot">
                          Posted {r.date} · running balance {fmtINR(r.balance)}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              }
              return els;
            })}
            {totals.opening > 0 && (
              <tr className="openrow">
                <td className="td-date"></td>
                <td className="td-ref">OPENING</td>
                <td />
                <td />
                <td />
                <td />
                <td className="num">{fmtINR(totals.opening)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td className="td-ref">TOTALS</td>
              <td className="num red">{fmtINR(totals.purchase)}</td>
              <td className="num green">{fmtINR(totals.payment)}</td>
              <td className="num green">{fmtINR(totals.discount)}</td>
              <td className="num amber">{fmtINR(totals.gap)}</td>
              <td className="num">{fmtINR(totals.closing)}</td>
            </tr>
            <tr className="truerow">
              <td colSpan={6} className="td-ref" style={{ textAlign: "right" }}>
                − Firm gaps ({fmtINR(totals.gapFirm)}) = SETTLE AT
              </td>
              <td className="num" style={{ color: "var(--green)", fontWeight: 700 }}>
                {fmtINR(settleTarget)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button className="iconbtn reviewbtn" onClick={exportCsv}>
        Export table CSV
      </button>
    </>
  );
}
