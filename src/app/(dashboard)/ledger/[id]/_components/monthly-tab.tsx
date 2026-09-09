"use client";

// App.jsx:881-991 — Monthly view: opening & closing balance per month
// Buckets every entry into its calendar month, carries the running balance forward (prev
// month's close = next month's open) so each month can be verified in isolation against the
// vendor's month-end figure.
import { useMemo, useState } from "react";
import type { LedgerBrandView, LedgerViewEntry } from "@/lib/brand-ledger/view-types";
import { downloadCSV, entryDir, fmtINR, monthLabel, sortEntries, today } from "./ledger-helpers";

interface MonthBucket {
  ym: string;
  purchase: number;
  payment: number;
  credit: number;
  entries: LedgerViewEntry[];
  open: number;
  net: number;
  close: number;
}

export function MonthlyTab({ brand }: { brand: LedgerBrandView }) {
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const { months, opening, closing } = useMemo(() => {
    // IGNORED rows (plan D3) are left out here, exactly as computeThread leaves them out.
    const asc = sortEntries(brand.entries.filter((e) => !e.ignored));
    const opening = brand.ledger?.opening?.amount || 0;
    const map = new Map<string, MonthBucket>();
    for (const e of asc) {
      const ym = (e.date || "").slice(0, 7);
      if (!ym) continue;
      const g =
        map.get(ym) || ({ ym, purchase: 0, payment: 0, credit: 0, entries: [], open: 0, net: 0, close: 0 } as MonthBucket);
      if (e.type === "invoice" || e.type === "debit-note") g.purchase += e.amount || 0;
      else if (e.type === "payment") g.payment += e.amount || 0;
      else if (e.type !== "note") g.credit += e.amount || 0;
      g.entries.push(e);
      map.set(ym, g);
    }
    let bal = opening;
    const months = [...map.values()].sort((a, b) => a.ym.localeCompare(b.ym));
    for (const m of months) {
      m.open = bal;
      m.net = m.purchase - m.payment - m.credit;
      bal += m.net;
      m.close = bal;
    }
    return { months, opening, closing: bal };
  }, [brand]);

  const view = [...months].reverse(); // newest month on top
  const openDate = brand.ledger?.opening?.date;

  const exportCsv = () =>
    downloadCSV(`${brand.id}-monthly-${today()}.csv`, [
      ["Month", "Opening", "Purchases", "Payments", "Credits/Disc", "Net", "Closing", "Entries"],
      ...months.map((m) => [
        monthLabel(m.ym),
        Math.round(m.open),
        Math.round(m.purchase),
        Math.round(m.payment),
        Math.round(m.credit),
        Math.round(m.net),
        Math.round(m.close),
        m.entries.length,
      ]),
    ]);

  if (months.length === 0)
    return (
      <div className="card">
        <div className="empty">No dated ledger entries to bucket by month yet.</div>
      </div>
    );

  return (
    <>
      <div className="card matchbar">
        <div className="mrow">
          <div className="b">
            <div className="v">{fmtINR(opening)}</div>
            <div className="l">Opening {openDate ? `· ${openDate}` : ""}</div>
          </div>
          <div className="b" style={{ textAlign: "right" }}>
            <div className="v">{fmtINR(closing)}</div>
            <div className="l">Closing · {months.length} months</div>
          </div>
        </div>
        <div className="covnote">
          Each month carries forward: previous month&apos;s closing = next month&apos;s opening. Tap a month to see its
          transactions and verify against the vendor&apos;s month-end figure.
        </div>
      </div>

      <div className="tablewrap card">
        <table className="ltable">
          <thead>
            <tr>
              <th>Month</th>
              <th>Opening</th>
              <th>Purchases</th>
              <th>Payments</th>
              <th>Credits</th>
              <th>Closing</th>
            </tr>
          </thead>
          <tbody>
            {view.flatMap((m) => {
              const isOpen = openMonth === m.ym;
              const els = [
                <tr key={m.ym} className="clickable" onClick={() => setOpenMonth(isOpen ? null : m.ym)}>
                  <td className="td-ref">
                    <span className="gapcaret">{isOpen ? "▾" : "▸"}</span>
                    {monthLabel(m.ym)}
                    <div className="td-sub2">{m.entries.length} entries</div>
                  </td>
                  <td className="num">{fmtINR(m.open)}</td>
                  <td className="num red">{m.purchase ? fmtINR(m.purchase) : ""}</td>
                  <td className="num green">{m.payment ? fmtINR(m.payment) : ""}</td>
                  <td className="num green">{m.credit ? fmtINR(m.credit) : ""}</td>
                  <td className="num">
                    <b>{fmtINR(m.close)}</b>
                  </td>
                </tr>,
              ];
              if (isOpen) {
                els.push(
                  <tr key={m.ym + "-d"} className="gapdetailrow">
                    <td colSpan={6}>
                      <div className="monthdetail">
                        <div className="md-bal">
                          <span>
                            Opening <b>{fmtINR(m.open)}</b>
                          </span>
                          <span>
                            Closing <b>{fmtINR(m.close)}</b>
                          </span>
                        </div>
                        {[...m.entries]
                          .sort((a, b) => b.date.localeCompare(a.date))
                          .map((e) => {
                            const dir = e.dir ?? entryDir(e.type);
                            return (
                              <div key={e.id} className="md-entry">
                                <span className="md-date">{e.date}</span>
                                <span className={"chip " + (dir > 0 ? "red" : dir < 0 ? "green" : "")}>{e.type}</span>
                                <span className="md-ref">{e.ref || e.note || ""}</span>
                                <span
                                  className="md-amt"
                                  style={{ color: dir > 0 ? "var(--red)" : dir < 0 ? "var(--green)" : "var(--muted)" }}
                                >
                                  {dir !== 0 ? (dir > 0 ? "+" : "−") : ""}
                                  {fmtINR(e.amount)}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    </td>
                  </tr>
                );
              }
              return els;
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="td-ref">TOTAL</td>
              <td className="num">{fmtINR(opening)}</td>
              <td className="num red">{fmtINR(months.reduce((s, m) => s + m.purchase, 0))}</td>
              <td className="num green">{fmtINR(months.reduce((s, m) => s + m.payment, 0))}</td>
              <td className="num green">{fmtINR(months.reduce((s, m) => s + m.credit, 0))}</td>
              <td className="num">{fmtINR(closing)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button className="iconbtn reviewbtn" onClick={exportCsv}>
        Export monthly CSV
      </button>
    </>
  );
}
