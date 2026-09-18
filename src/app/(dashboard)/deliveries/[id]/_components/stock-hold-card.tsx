"use client";

// "Stock not reserved" card (plan 1609 A38, T5). Shown when a delivery is in a hold status but
// `stockReservedAt` is null — either the floor was short when it was scheduled/packed, or its
// hold was released once by B4. "Reserve stock now" retries the all-or-nothing hold.

import { useState } from "react";
import { AlertTriangle, Loader2, PackageCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { DeliveryData, StockShortLine, isStockNotReserved } from "./types";
import { FindStockPanel } from "./find-stock-panel";

const log = createLogger("deliveries:stock-hold");

interface StockHoldCardProps {
  data: DeliveryData;
  deliveryId: string;
  /** Short lines already known from the last SCHEDULED/PACKED response, if any. */
  knownShort: StockShortLine[];
  onReserved: () => void;
}

export function StockHoldCard({ data, deliveryId, knownShort, onReserved }: StockHoldCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [short, setShort] = useState<StockShortLine[] | null>(null);

  if (!isStockNotReserved(data)) return null;

  const floorName = data.warehouse?.name || "the floor";
  const lines = short ?? knownShort;

  const reserve = async () => {
    setLoading(true);
    setError("");
    const res = await apiTry<{ held: boolean; short: StockShortLine[] }>(
      `/api/deliveries/${deliveryId}/reserve`,
      { method: "POST" }
    );
    setLoading(false);
    if (res.error || !res.data) {
      log.warn("reserve failed", { deliveryId, status: res.status });
      setError(res.error || "Reserve failed");
      return;
    }
    if (res.data.held) {
      log.info("stock reserved", { deliveryId });
      setShort(null);
      onReserved();
      return;
    }
    log.info("reserve still short", { deliveryId, lines: res.data.short.length });
    setShort(res.data.short);
  };

  return (
    <Card className="mb-3 border-red-200 bg-red-50">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-900">
              Stock not reserved — {floorName} is short
            </p>
            <p className="text-xs text-red-700">
              Nothing is held for this delivery. Transfer from the godown if needed, then reserve.
            </p>
          </div>
        </div>

        {lines.length > 0 && (
          <ul className="space-y-1">
            {lines.map((l, i) => (
              <li
                key={`${l.sku}-${i}`}
                className="flex items-center justify-between gap-2 bg-white rounded-md border border-red-100 px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-900 truncate" title={l.name}>{l.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{l.sku}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold text-red-700 tabular-nums">
                    {l.available} / {l.needed}
                  </p>
                  {/* Plan 1709, R13: the warning names the GODOWN quantity, so the answer
                      ("transfer it from there") is on the screen and not only in someone's head. */}
                  {l.elsewhere && l.elsewhere.length > 0 && (
                    <p className="text-[10px] text-slate-500 tabular-nums">
                      {l.elsewhere.map((e) => `${e.quantity} in ${e.warehouseName}`).join(" · ")}
                    </p>
                  )}
                </div>
              </li>
            ))}
            <li className="text-[11px] text-red-600">available / needed on {floorName}</li>
          </ul>
        )}

        {error && <p className="text-xs text-red-700 font-medium">{error}</p>}

        <button
          onClick={reserve}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-red-600 text-white py-2.5 min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
          {loading ? "Reserving..." : "Reserve stock now"}
        </button>

        {/* R45: when the floor and its godown cannot cover it, look further — every store's
            floors and godowns — and raise the transfer from what is found. */}
        <FindStockPanel deliveryId={deliveryId} onRaised={onReserved} />
      </CardContent>
    </Card>
  );
}
