"use client";

// App.jsx:496-694 — Ledger: chat-style two-sided thread
import { useMemo, useState } from "react";
import type { LedgerBrandView, LedgerViewEntry } from "@/lib/brand-ledger/view-types";
import { usePermissions } from "@/lib/use-permissions";
import { BalanceEditor } from "./balance-editor";
import { EntryExplain } from "./entry-explain";
import { EntryForm } from "./entry-form";
import { ledgerApi } from "./ledger-api";
import {
  AUDIT_CHIP,
  AUDIT_LABEL,
  PAGE,
  computeThread,
  entryDir,
  entrySide,
  fmtINR,
  fmtLakh,
  gapAmount,
  gapId,
  monthLabel,
  openGaps,
  statusColor,
} from "./ledger-helpers";

export function LedgerTab({
  brand,
  reload,
  onOpenGap,
}: {
  brand: LedgerBrandView;
  reload: () => Promise<void> | void;
  onOpenGap?: (n: number) => void;
}) {
  const { canEdit } = usePermissions();
  const canEditLedger = canEdit("brand_ledger");

  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | "vendor" | "bch" | "nodisc">("all");
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { sorted, balances, closing } = useMemo(() => computeThread(brand), [brand]);

  // discount audit rollup (entries carry .audit from the consolidation)
  const audit = useMemo(() => {
    const inv = sorted.filter((e) => e.type === "invoice" && e.audit);
    const by = (s: string) => inv.filter((e) => e.audit!.s === s);
    const gapAmt = (list: LedgerViewEntry[]) => {
      const ns = [...new Set(list.map((e) => e.audit!.g).filter((g): g is number => typeof g === "number"))];
      return ns.reduce((sum: number, n) => sum + (brand.gaps.find((g) => g.n === n)?.amt || 0), 0);
    };
    return inv.length
      ? {
          total: inv.length,
          ok: by("ok").length,
          short: by("short").length,
          missing: by("missing").length,
          kids: by("kids").length,
          era20: by("era20").length,
          missingAmt: gapAmt(by("missing")),
          shortAmt: gapAmt(by("short")),
        }
      : null;
  }, [sorted, brand]);

  const linkedGapNs = useMemo(
    () => new Set(sorted.flatMap((e) => (e.audit?.g ? [e.audit.g] : []))),
    [sorted]
  );
  const unlinkedOpenGaps = openGaps(brand).filter((g) => !linkedGapNs.has(g.n));

  const filtered = useMemo(() => {
    let list = sorted;
    if (filter === "vendor") list = list.filter((e) => (e.side ?? entrySide(e.type)) === "vendor");
    else if (filter === "bch") list = list.filter((e) => (e.side ?? entrySide(e.type)) === "bch");
    else if (filter === "nodisc") list = list.filter((e) => e.audit && (e.audit.s === "missing" || e.audit.s === "short"));
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((e) => `${e.ref} ${e.note} ${e.type} ${e.amount}`.toLowerCase().includes(needle));
    }
    return list;
  }, [sorted, filter, q]);

  const visible = showAll || filtered.length <= PAGE ? filtered : filtered.slice(-PAGE);
  const hidden = filtered.length - visible.length;

  const stated = brand.theirBal?.amount;
  const diff = brand.ledger?.matchable && stated != null ? Math.round(closing - stated) : null;

  return (
    <>
      {/* Reconciliation bar: computed closing vs their stated figure */}
      <div className="card matchbar">
        <div className="mrow">
          <div className="b">
            <div className="v">{fmtINR(closing)}</div>
            <div className="l">Computed closing ({brand.entries.length} entries)</div>
          </div>
          {brand.ledger?.matchable ? (
            <div className="b" style={{ textAlign: "right" }}>
              <div className="v" style={{ color: diff === 0 ? "var(--green)" : "var(--amber)" }}>
                {diff === 0 ? "✓ MATCHED" : (diff! > 0 ? "+" : "−") + fmtINR(Math.abs(diff!))}
              </div>
              <div className="l">vs {brand.theirBal?.label}</div>
            </div>
          ) : (
            <div className="b" style={{ textAlign: "right" }}>
              <div className="v" style={{ color: "var(--muted)" }}>
                one-sided
              </div>
              <div className="l">not comparable yet</div>
            </div>
          )}
        </div>
        {brand.ledger?.note && <div className="covnote">{brand.ledger.note}</div>}
        {brand.ledger?.coverage && (
          <div className="covnote" style={{ marginTop: 2 }}>
            Coverage: {brand.ledger.coverage}
          </div>
        )}
      </div>

      {audit && (
        <div className="card auditbar">
          <b>Discount audit — {audit.total} invoices:</b> <span className="chip green">✓ ok {audit.ok}</span>{" "}
          <span className="chip amber">
            ⚠ short {audit.short} ({fmtINR(audit.shortAmt)})
          </span>{" "}
          <span className="chip red">
            ✗ no disc {audit.missing} ({fmtINR(audit.missingAmt)})
          </span>{" "}
          {audit.kids > 0 && <span className="chip">kids-0% {audit.kids}</span>}{" "}
          {audit.era20 > 0 && <span className="chip blue">20%-era {audit.era20}</span>}
          <div className="covnote">Tap any entry for its explanation; red/amber invoices carry their gap inline.</div>
        </div>
      )}

      <div className="filters">
        <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
          all
        </button>
        <button className={filter === "vendor" ? "on" : ""} onClick={() => setFilter("vendor")}>
          ← {brand.name}
        </button>
        <button className={filter === "bch" ? "on" : ""} onClick={() => setFilter("bch")}>
          BCH →
        </button>
        {audit && (
          <button className={filter === "nodisc" ? "on" : ""} onClick={() => setFilter("nodisc")}>
            ✗/⚠ discount gaps
          </button>
        )}
        <input className="search" placeholder="Search ref / note…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="thread">
        {brand.ledger?.opening && (showAll || hidden === 0) && filter === "all" && !q && (
          <div className="opening">
            Opening balance <b>{fmtINR(brand.ledger.opening.amount)}</b> · {brand.ledger.opening.date}
          </div>
        )}
        {hidden > 0 && (
          <button className="iconbtn reviewbtn" onClick={() => setShowAll(true)}>
            ↑ Show {hidden.toLocaleString("en-IN")} earlier entries (from the beginning)
          </button>
        )}
        {visible.length === 0 && <div className="empty">No entries match</div>}
        {visible.map((e, i) => {
          const side = e.side ?? entrySide(e.type);
          const dir = e.dir ?? entryDir(e.type);
          const prev = visible[i - 1];
          const month = e.date?.slice(0, 7);
          const newMonth = !prev || prev.date?.slice(0, 7) !== month;
          return (
            <div key={e.id}>
              {newMonth && <div className="monthsep">{monthLabel(month)}</div>}
              <div className={"msg " + side}>
                <div
                  className={
                    "bubble" + (e.audit?.s === "missing" ? " b-missing" : e.audit?.s === "short" ? " b-short" : "")
                  }
                  // An IGNORED row (plan D3) stays visible, dimmed, and no longer moves the balance.
                  style={e.ignored ? { opacity: 0.5 } : undefined}
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                >
                  <div className="brow">
                    <span className={"chip " + (dir > 0 ? "red" : dir < 0 ? "green" : "")}>{e.type}</span>
                    {e.audit && e.audit.s !== "info" && (
                      <span className={"chip " + AUDIT_CHIP[e.audit.s]}>{AUDIT_LABEL[e.audit.s]}</span>
                    )}
                    {e.ignored && <span className="chip">ignored</span>}
                    <span
                      className="bamt"
                      style={{ color: dir > 0 ? "var(--red)" : dir < 0 ? "var(--green)" : "var(--muted)" }}
                    >
                      {dir !== 0 ? (dir > 0 ? "+" : "−") : ""}
                      {fmtINR(e.amount)}
                    </span>
                    {canEditLedger && !e.ignored && (
                      <button
                        className="del"
                        onClick={async (ev) => {
                          ev.stopPropagation();
                          if (confirm(`Delete ${e.type} ${e.ref || ""} of ${fmtINR(e.amount)}?`)) {
                            if (await ledgerApi.removeEntry(brand.id, e)) await reload();
                          }
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {e.ref && (
                    <div className="bref" style={e.ignored ? { textDecoration: "line-through" } : undefined}>
                      {e.ref}
                    </div>
                  )}
                  {e.note && <div className="bnote">{e.note}</div>}
                  {expanded === e.id && <EntryExplain e={e} brand={brand} />}
                  <div className="bfoot">
                    <span>{e.date}</span>
                    <span>bal {fmtLakh(balances.get(e.id))}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {unlinkedOpenGaps.length > 0 && (
        <div className="card gapstrip">
          <h3>Open gaps not tied to a single bill ({unlinkedOpenGaps.length})</h3>
          {unlinkedOpenGaps.map((g) => (
            <div
              key={g.n}
              className="minigap"
              onClick={() => setExpanded(expanded === "gap" + g.n ? null : "gap" + g.n)}
            >
              <div className="mg-row">
                <span className="gapid">{gapId(brand, g.n)}</span>
                <span className="mg-title">{g.title}</span>
                <span className={"chip " + (statusColor[g.status] || "")}>{g.status}</span>
                <span className="mg-amt">{gapAmount(g)}</span>
              </div>
              {expanded === "gap" + g.n && (
                <div className="mg-detail">
                  {g.evidence && (
                    <div>
                      <b>Evidence:</b> {g.evidence}
                    </div>
                  )}
                  {g.action && (
                    <div>
                      <b>Action:</b> {g.action}
                    </div>
                  )}
                  {(g.progress || []).map((p, j) => (
                    <div key={p.id || j} className="gd-note">
                      {p.date}: {p.text}
                    </div>
                  ))}
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
              )}
            </div>
          ))}
          <div className="covnote">Full editing in the Gaps tab — this strip keeps them visible inside the ledger.</div>
        </div>
      )}

      {canEditLedger && !adding && (
        <button className="iconbtn primary reviewbtn" onClick={() => setAdding(true)}>
          + Add entry
        </button>
      )}
      {adding && (
        <EntryForm
          onCancel={() => setAdding(false)}
          onSave={async (vals) => {
            if (await ledgerApi.addEntry(brand.id, vals)) {
              setAdding(false);
              await reload();
            }
          }}
        />
      )}

      {canEditLedger && <BalanceEditor brand={brand} reload={reload} />}
    </>
  );
}
