"use client";

// App.jsx:298-429
import { useEffect, useMemo, useState } from "react";
import type { LedgerBrandView, LedgerViewGap, LedgerViewGapStatus } from "@/lib/brand-ledger/view-types";
import { usePermissions } from "@/lib/use-permissions";
import { Evidence } from "./evidence";
import { EvidenceUpload } from "./evidence-upload";
import { GapForm } from "./gap-form";
import { GapShots } from "./gap-shots";
import { ledgerApi } from "./ledger-api";
import { GAP_STATUSES, gapAmount, gapId, openGaps, shareGapOnWhatsApp, statusColor } from "./ledger-helpers";
import { ProgressNote } from "./progress-note";

export function GapsTab({
  brand,
  reload,
  focusGap,
  clearFocus,
}: {
  brand: LedgerBrandView;
  reload: () => Promise<void> | void;
  focusGap: number | null;
  clearFocus?: () => void;
}) {
  const { canEdit, canApprove } = usePermissions();
  const canEditGaps = canEdit("brand_ledger_gaps");
  const canClose = canApprove("brand_ledger_gaps");

  const [filter, setFilter] = useState<string>("active");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LedgerViewGap | null>(null);

  // deep-link from Table/Ledger: jump to a specific gap, expand it, scroll into view
  useEffect(() => {
    if (focusGap == null) return;
    setFilter("all");
    setExpanded(focusGap);
    const t = setTimeout(() => {
      const el = document.getElementById("gap-" + focusGap);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    clearFocus?.();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusGap]);

  const gaps = useMemo(() => {
    let g = [...brand.gaps];
    if (filter === "active") g = g.filter((x) => x.status !== "resolved" && x.status !== "rejected");
    else if (filter !== "all") g = g.filter((x) => x.status === filter);
    return g;
  }, [brand, filter]);

  const counts: Record<string, number> = { active: openGaps(brand).length, all: brand.gaps.length };

  return (
    <>
      <div className="filters">
        {["active", "all", ...GAP_STATUSES].map((f) => (
          <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
            {f}
            {counts[f] !== undefined ? ` (${counts[f]})` : ""}
          </button>
        ))}
      </div>

      <div className="card list">
        {gaps.length === 0 && <div className="empty">No gaps in this view</div>}
        {gaps.map((g) => (
          <div
            key={g.n}
            id={"gap-" + g.n}
            className={
              "gap" +
              (g.status === "resolved" || g.status === "rejected" ? " done" : "") +
              (expanded === g.n ? " focus" : "")
            }
          >
            <div className="top" onClick={() => setExpanded(expanded === g.n ? null : g.n)}>
              <span className="gapid">{gapId(brand, g.n)}</span>
              <span className="title">{g.title}</span>
              <span className="amt">{gapAmount(g)}</span>
            </div>
            <div className="meta">
              <span className={"chip " + (statusColor[g.status] || "")}>{g.status}</span>
              <span className="chip">{g.type}</span>
            </div>
            {expanded === g.n && (
              <div className="detail">
                {g.result && (
                  <div className="result">
                    <span className="result-lbl">✓ Result</span> {g.result}
                  </div>
                )}
                {g.evidence && (
                  <>
                    <div className="lbl">Evidence · reference &amp; chat proof</div>
                    <Evidence text={g.evidence} />
                  </>
                )}
                {g.action && (
                  <>
                    <div className="lbl">Action</div>
                    <div>{g.action}</div>
                  </>
                )}
                <GapShots gap={g} />
                {canEditGaps && <EvidenceUpload gapId={g.id} reload={reload} />}
                {(g.progress || []).map((p, i) => (
                  <div key={p.id || i} className="note">
                    {p.date}: {p.text}
                  </div>
                ))}
                {canEditGaps && (
                  <>
                    <div className="lbl">Set status</div>
                    <div className="statusrow">
                      {GAP_STATUSES.map((st) => {
                        const closing = st === "resolved" || st === "rejected";
                        return (
                          <button
                            key={st}
                            className={g.status === st ? "on" : ""}
                            style={g.status === st ? { borderColor: "currentColor", color: "inherit" } : {}}
                            disabled={closing && !canClose && g.status !== st}
                            title={closing && !canClose ? "Closing a claim needs approve permission on Ledger Claims" : undefined}
                            onClick={async () => {
                              if (await ledgerApi.updateGap(g.id, { status: st as LedgerViewGapStatus })) await reload();
                            }}
                          >
                            {st}
                          </button>
                        );
                      })}
                    </div>
                    <ProgressNote
                      onAdd={async (text) => {
                        if (await ledgerApi.addNote(g.id, text)) await reload();
                      }}
                    />
                  </>
                )}
                <div className="statusrow" style={{ marginTop: 8 }}>
                  <button className="iconbtn wa" onClick={() => shareGapOnWhatsApp(brand, g)}>
                    Share on WhatsApp
                  </button>
                  {canEditGaps && (
                    <button
                      onClick={() => {
                        setEditing(g);
                        setAdding(false);
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {canEditGaps && (
                    <button
                      style={{ color: "var(--red)" }}
                      onClick={async () => {
                        if (confirm(`Delete gap #${g.n} "${g.title}"?`)) {
                          if (await ledgerApi.deleteGap(g.id)) await reload();
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {canEditGaps && !adding && !editing && (
        <button className="iconbtn primary reviewbtn" onClick={() => setAdding(true)}>
          + Add gap
        </button>
      )}
      {(adding || editing) && (
        <GapForm
          initial={editing}
          brand={brand}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSave={async (vals) => {
            const ok = editing ? await ledgerApi.updateGap(editing.id, vals) : await ledgerApi.addGap(brand.id, vals);
            if (ok) {
              setAdding(false);
              setEditing(null);
              await reload();
            }
          }}
        />
      )}
    </>
  );
}
