"use client";

// Find stock, and raise the transfer that brings it (plan 1709, R45, P15, P16).
//
// The owner's shape: choose a STORE first — this outward's store is preselected — then the app
// lists that store's floor and godown warehouses that actually hold each short product, with the
// unit breakdown beside each quantity. Tick a source, set how many, and Create transfer request.
//
// Finding needs no document; the transfer does, and it is required before dispatch (P16), which
// is why the confirmation says so rather than asking for a file here.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MapPinned, Search, Truck } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:find-stock");

interface Source {
  warehouseId: string;
  warehouseName: string;
  kind: "FLOOR" | "GODOWN";
  quantity: number;
  units: { assembled: number; unassembled: number; noAssembly: number };
}

interface Line {
  productId: string;
  name: string;
  sku: string;
  needed: number;
  onFloor: number;
  shortfall: number;
  sources: Source[];
}

interface LinkedTransfer {
  id: string;
  orderNo: string;
  status: string;
  createdAt: string;
  docUrl: string | null;
  fromWarehouse: { name: string } | null;
  toWarehouse: { name: string } | null;
}

interface FindStockData {
  storeId: string | null;
  ownStoreId: string | null;
  stores: Array<{ id: string; name: string }>;
  floor: { id: string; name: string } | null;
  lines: Line[];
  transfers: LinkedTransfer[];
}

/** `productId::warehouseId` → the quantity the person asked for. */
type Picks = Record<string, number>;

const key = (productId: string, warehouseId: string) => `${productId}::${warehouseId}`;

export function FindStockPanel({ deliveryId, onRaised }: { deliveryId: string; onRaised: () => void }) {
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [data, setData] = useState<FindStockData | null>(null);
  // Starts true so the first open reads "Searching…" without the effect having to set it, which
  // is what `react-hooks/set-state-in-effect` is asking for: state goes in from the callback.
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [picks, setPicks] = useState<Picks>({});

  /** One place that turns a response into screen state, shared by the effect and the handlers. */
  const apply = useCallback(
    (res: { data: FindStockData | null; error: string | null; status?: number }) => {
      setLoading(false);
      if (res.error || !res.data) {
        log.warn("find stock load failed", { deliveryId, status: res.status });
        setError(res.error || "Could not search for stock");
        return;
      }
      setError("");
      setData(res.data);
      setStoreId(res.data.storeId);
      setPicks({});
    },
    [deliveryId]
  );

  /** For the handlers (a store change, a refresh after raising), where setState is allowed. */
  const load = useCallback(
    (store?: string | null) => {
      setLoading(true);
      const qs = store ? `?storeId=${encodeURIComponent(store)}` : "";
      return apiTry<FindStockData>(`/api/deliveries/${deliveryId}/find-stock${qs}`).then(apply);
    },
    [deliveryId, apply]
  );

  // A promise chain rather than an async body: state is set inside the callback, which is what
  // the lint rule asks for when an effect kicks off the first load (same shape as use-delivery).
  useEffect(() => {
    if (!open || data) return;
    void apiTry<FindStockData>(`/api/deliveries/${deliveryId}/find-stock`).then(apply);
  }, [open, data, deliveryId, apply]);

  const total = Object.values(picks).reduce((sum, n) => sum + (n > 0 ? n : 0), 0);

  async function create() {
    const sources = Object.entries(picks)
      .filter(([, qty]) => qty > 0)
      .map(([k, qty]) => {
        const [productId, warehouseId] = k.split("::");
        return { productId, warehouseId, qty };
      });
    if (sources.length === 0) return;

    setSaving(true);
    setError("");
    const res = await apiTry<{ transfers: Array<{ id: string; orderNo: string }> }>(
      `/api/deliveries/${deliveryId}/find-stock`,
      { method: "POST", json: { sources } }
    );
    setSaving(false);
    if (res.error || !res.data) {
      log.warn("transfer request refused", { deliveryId, status: res.status });
      setError(res.error || "Could not raise the transfer");
      return;
    }
    log.info("transfer request raised", { deliveryId, orders: res.data.transfers.length });
    setPicks({});
    void load(storeId);
    onRaised();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 bg-white border border-red-300 text-red-700 py-2.5 min-h-[48px] rounded-lg text-sm font-medium"
      >
        <Search className="h-4 w-4" /> Find stock
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <MapPinned className="h-4 w-4 text-slate-500" /> Find stock
        </p>
        <button onClick={() => setOpen(false)} className="text-[11px] text-slate-500 underline focus-ring rounded">
          Close
        </button>
      </div>

      {data && data.stores.length > 0 && (
        <label className="block">
          <span className="text-[11px] text-slate-500">Look in</span>
          <select
            value={storeId ?? ""}
            onChange={(e) => {
              setStoreId(e.target.value);
              void load(e.target.value);
            }}
            className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-ring"
          >
            {data.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.id === data.ownStoreId ? " (this outward's store)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {loading && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
        </p>
      )}
      {error && <p className="text-xs text-red-700 font-medium">{error}</p>}

      {data?.lines.map((line) => (
        <div key={line.productId} className="rounded-md border border-slate-100 p-2">
          <p className="text-xs font-medium text-slate-900">{line.name}</p>
          <p className="text-[11px] text-slate-500 tabular-nums">
            {line.sku} · needs {line.needed}, {line.onFloor} on {data.floor?.name ?? "the floor"} · short{" "}
            {line.shortfall}
          </p>

          {line.sources.length === 0 ? (
            <p className="text-[11px] text-amber-700 mt-1">Nothing in this store. Try another store.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {line.sources.map((s) => (
                <li key={s.warehouseId} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-slate-700 truncate">
                      {s.warehouseName} <span className="text-slate-400">· {s.kind.toLowerCase()}</span>
                    </p>
                    <p className="text-[10px] text-slate-400 tabular-nums">
                      {s.quantity} usable · {s.units.assembled} built, {s.units.unassembled} unbuilt
                      {s.units.noAssembly > 0 ? `, ${s.units.noAssembly} no assembly` : ""}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={Math.min(s.quantity, line.shortfall)}
                    value={picks[key(line.productId, s.warehouseId)] ?? 0}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const capped = Math.max(0, Math.min(Number.isFinite(raw) ? raw : 0, s.quantity, line.shortfall));
                      setPicks((p) => ({ ...p, [key(line.productId, s.warehouseId)]: capped }));
                    }}
                    aria-label={`Quantity from ${s.warehouseName}`}
                    className="w-16 shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-right tabular-nums focus-ring"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {data && data.lines.length === 0 && !loading && (
        <p className="text-xs text-slate-500">Nothing is short on this outward right now.</p>
      )}

      <button
        onClick={create}
        disabled={saving || total === 0}
        className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-2.5 min-h-[44px] rounded-lg text-sm font-medium disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
        {saving ? "Raising…" : `Create transfer request (${total})`}
      </button>
      <p className="text-[10px] text-slate-500">
        One request per source warehouse, sent for approval. The delivery challan or tax invoice is
        attached before dispatch, not now.
      </p>

      {data && data.transfers.length > 0 && (
        <div className="pt-1 border-t border-slate-100">
          <p className="text-[11px] font-medium text-slate-600 mb-1">Transfers raised for this outward</p>
          <ul className="space-y-1">
            {data.transfers.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <Link href={`/transfers/${t.id}`} className="text-[11px] text-blue-600 underline tabular-nums">
                  {t.orderNo}
                </Link>
                <span className="text-[10px] text-slate-500 truncate">
                  {t.fromWarehouse?.name ?? "—"} → {t.toWarehouse?.name ?? "—"}
                </span>
                <span className="text-[10px] font-medium text-slate-700 shrink-0">{t.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
