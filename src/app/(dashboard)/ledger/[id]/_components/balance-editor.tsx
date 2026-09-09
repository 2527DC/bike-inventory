"use client";

// App.jsx:833-874
import { useState } from "react";
import type { LedgerBrandView } from "@/lib/brand-ledger/view-types";
import { ledgerApi } from "./ledger-api";

export function BalanceEditor({
  brand,
  reload,
}: {
  brand: LedgerBrandView;
  reload: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    their: (brand.theirBal?.amount ?? "") as number | "",
    theirLabel: brand.theirBal?.label || "",
    our: (brand.ourBal?.amount ?? "") as number | "",
    ourLabel: brand.ourBal?.label || "",
  });
  if (!open) {
    return (
      <button className="iconbtn reviewbtn" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
        Update balances
      </button>
    );
  }
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [k]: e.target.value } as typeof v);
  return (
    <div className="card form" style={{ marginTop: 8 }}>
      <h3>Update balances</h3>
      <div className="row">
        <div>
          <label>Their books (₹)</label>
          <input type="number" value={v.their} onChange={set("their")} />
        </div>
        <div>
          <label>Label / as-of</label>
          <input value={v.theirLabel} onChange={set("theirLabel")} />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Our net (₹)</label>
          <input type="number" value={v.our} onChange={set("our")} />
        </div>
        <div>
          <label>Label</label>
          <input value={v.ourLabel} onChange={set("ourLabel")} />
        </div>
      </div>
      <div className="formactions">
        <button className="iconbtn" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          className="iconbtn primary"
          onClick={async () => {
            const ok = await ledgerApi.profile(brand.id, {
              theirBal: { amount: v.their === "" ? null : Number(v.their), label: v.theirLabel },
              ourBal: { amount: v.our === "" ? null : Number(v.our), label: v.ourLabel },
            });
            if (ok) {
              setOpen(false);
              await reload();
            }
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
