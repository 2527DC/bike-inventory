"use client";

// App.jsx:223-282 — the per-vendor screen, wrapped in `.bch-ledger` so the app's own
// stylesheet (ledger.css) applies here and nowhere else in BCH.
import Link from "next/link";
import { useState } from "react";
import type { LedgerBrandView } from "@/lib/brand-ledger/view-types";
import { usePermissions } from "@/lib/use-permissions";
import { Collapsible } from "./collapsible";
import { FilesCard } from "./files-card";
import { GapsTab } from "./gaps-tab";
import { ImportJsonCard } from "./import-json-card";
import { LedgerTab } from "./ledger-tab";
import { ledgerApi } from "./ledger-api";
import { REVIEW_CADENCE_DAYS, daysSince, fmtINR, openGaps } from "./ledger-helpers";
import { MonthlyTab } from "./monthly-tab";
import { ShareTab } from "./share-tab";
import { TableTab } from "./table-tab";

type Tab = "ledger" | "monthly" | "table" | "gaps" | "share";

export function BrandPage({ brand, reload }: { brand: LedgerBrandView; reload: () => Promise<void> | void }) {
  const { canEdit, canCreate } = usePermissions();
  const [tab, setTab] = useState<Tab>("ledger");
  const [focusGap, setFocusGap] = useState<number | null>(null);
  const openGapInTab = (n: number) => {
    setFocusGap(n);
    setTab("gaps");
  };
  const ds = daysSince(brand.lastReviewed);
  const due = ds !== null && ds >= REVIEW_CADENCE_DAYS;
  const reviewLabel = due ? `Review due (${ds}d)` : "✓ Reviewed";

  return (
    <div className="bch-ledger">
      <header className="hdr">
        <Link className="back" href={`/vendors/${brand.id}`}>
          ‹ Back
        </Link>
        <h1>{brand.name}</h1>
        {canEdit("brand_ledger") ? (
          <button
            className={"iconbtn" + (due ? " primary" : "")}
            onClick={async () => {
              if (await ledgerApi.profile(brand.id, { reviewed: true })) await reload();
            }}
          >
            {reviewLabel}
          </button>
        ) : (
          <span className={"iconbtn" + (due ? " primary" : "")}>{reviewLabel}</span>
        )}
      </header>

      <div className="card">
        <div className="smallmuted" style={{ marginBottom: 8 }}>
          {brand.sub}
        </div>
        <div className="balgrid">
          <div className="b">
            <div className="v">{fmtINR(brand.theirBal?.amount)}</div>
            <div className="l">{brand.theirBal?.label || "Their books"}</div>
          </div>
          <div className="b">
            <div className="v">{fmtINR(brand.ourBal?.amount)}</div>
            <div className="l">{brand.ourBal?.label || "Our net"}</div>
          </div>
        </div>
        {brand.recov?.text && <div className="recov">↩ {brand.recov.text}</div>}
        {brand.deadline && (
          <div className="alert" style={{ marginTop: 10, marginBottom: 0 }}>
            ⏰ {brand.deadline.label} ({brand.deadline.date})
          </div>
        )}
        <Collapsible label="Position & notes">
          <div className="pos">{brand.position}</div>
          {brand.notes && <div className="pos">{brand.notes}</div>}
        </Collapsible>
      </div>

      <div className="tabs">
        <button className={tab === "ledger" ? "on" : ""} onClick={() => setTab("ledger")}>
          Ledger ({brand.entries.length})
        </button>
        <button className={tab === "monthly" ? "on" : ""} onClick={() => setTab("monthly")}>
          Monthly
        </button>
        <button className={tab === "table" ? "on" : ""} onClick={() => setTab("table")}>
          Table
        </button>
        <button className={tab === "gaps" ? "on" : ""} onClick={() => setTab("gaps")}>
          Gaps ({openGaps(brand).length})
        </button>
        <button className={tab === "share" ? "on" : ""} onClick={() => setTab("share")}>
          Share
        </button>
      </div>

      {tab === "gaps" && (
        <GapsTab brand={brand} reload={reload} focusGap={focusGap} clearFocus={() => setFocusGap(null)} />
      )}
      {tab === "ledger" && <LedgerTab brand={brand} reload={reload} onOpenGap={openGapInTab} />}
      {tab === "monthly" && <MonthlyTab brand={brand} />}
      {tab === "table" && <TableTab brand={brand} reload={reload} onOpenGap={openGapInTab} />}
      {tab === "share" && <ShareTab brand={brand} />}

      {/* Not in the ledger app — the one-time JSON import (plan Part D) and the uploads/AI
          card (Part E). They sit below the app's own screen, never inside its tabs. */}
      {brand.isEmpty && canCreate("brand_ledger") && (
        <ImportJsonCard vendorId={brand.id} brand={brand} reload={reload} />
      )}
      <FilesCard vendorId={brand.id} brand={brand} reload={reload} />
    </div>
  );
}
