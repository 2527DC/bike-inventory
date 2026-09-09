"use client";

// App.jsx:1172-1218
import { useState } from "react";
import type { LedgerBrandView } from "@/lib/brand-ledger/view-types";
import { brandSummaryText, downloadCSV, today } from "./ledger-helpers";

export function ShareTab({ brand }: { brand: LedgerBrandView }) {
  const text = brandSummaryText(brand);
  const [copied, setCopied] = useState(false);
  return (
    <div className="card share">
      <h3>Vendor summary (WhatsApp-ready)</h3>
      <p className="smallmuted">Open items with amounts and asks — paste straight into the chat with {brand.name}.</p>
      <pre>{text}</pre>
      <div className="formactions">
        <button
          className="iconbtn primary"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "✓ Copied" : "Copy text"}
        </button>
        <button
          className="iconbtn"
          onClick={() =>
            downloadCSV(`${brand.id}-gaps-${today()}.csv`, [
              ["#", "Title", "Type", "Amount", "Status", "Evidence", "Action"],
              ...brand.gaps.map((g) => [g.n, g.title, g.type, g.amtText || (g.amt ?? "TBD"), g.status, g.evidence, g.action]),
            ])
          }
        >
          Gaps CSV
        </button>
        {brand.entries.length > 0 && (
          <button
            className="iconbtn"
            onClick={() =>
              downloadCSV(`${brand.id}-entries-${today()}.csv`, [
                ["Date", "Type", "Ref", "Amount", "Note"],
                // Ignored rows are skipped on every tab, so the export skips them too — the
                // CSV then foots to the closing the screen shows.
                ...brand.entries.filter((e) => !e.ignored).map((e) => [e.date, e.type, e.ref, e.amount, e.note]),
              ])
            }
          >
            Entries CSV
          </button>
        )}
      </div>
    </div>
  );
}
