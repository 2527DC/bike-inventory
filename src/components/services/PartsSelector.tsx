"use client";

import { useState, useEffect } from "react";
import { BIKE_CATEGORIES, getBikeCategory } from "@/lib/services/constants";

type PriceItem = {
  id: string;
  name: string;
  category: string;
  wheelSize: string | null;
  price: number;
};

export default function PartsSelector({
  initialAmount,
  onConfirm,
  onCancel,
  isHold = false,
}: {
  initialAmount: number | null;
  onConfirm: (partsText: string, totalAmount: number, holdReason?: string) => void;
  onCancel: () => void;
  isHold?: boolean;
}) {
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [servicePrice, setServicePrice] = useState<number | null>(initialAmount);
  const [partsSearch, setPartsSearch] = useState("");
  const [bikeCategory, setBikeCategory] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [customPrices, setCustomPrices] = useState<Record<string, number>>({});
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState("");

  useEffect(() => {
    fetch("/api/services/prices").then(async (res) => {
      if (res.ok) setPriceItems((await res.json()).prices);
    });
  }, []);

  const togglePart = (id: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });
  };

  const setQty = (id: string, qty: number) => {
    if (qty <= 0) {
      setSelected((prev) => { const next = { ...prev }; delete next[id]; return next; });
    } else {
      setSelected((prev) => ({ ...prev, [id]: qty }));
    }
  };

  const getPrice = (id: string) => customPrices[id] !== undefined ? customPrices[id] : (priceItems.find((p) => p.id === id)?.price ?? 0);
  const partsTotal = Object.entries(selected).reduce((sum, [id, qty]) => {
    return sum + getPrice(id) * qty;
  }, 0);

  const grandTotal = (servicePrice ?? 0) + partsTotal;

  const services = priceItems.filter((p) => p.category === "SERVICE");
  const parts = priceItems.filter((p) => p.category === "PARTS");
  const sizedParts = (() => {
    if (!bikeCategory) return parts;
    const cat = BIKE_CATEGORIES[bikeCategory as keyof typeof BIKE_CATEGORIES];
    if (cat) return parts.filter((p) => !p.wheelSize || cat.sizes.includes(p.wheelSize));
    return parts;
  })();
  const filteredParts = partsSearch.trim()
    ? sizedParts.filter((p) => p.name.toLowerCase().includes(partsSearch.toLowerCase()))
    : sizedParts;

  const handleConfirm = () => {
    setSubmitting(true);
    const partsList = Object.entries(selected)
      .map(([id, qty]) => {
        const item = priceItems.find((p) => p.id === id);
        const price = getPrice(id);
        return item ? `${item.name}${qty > 1 ? ` x${qty}` : ""} (₹${price * qty})` : "";
      })
      .filter(Boolean)
      .join(", ");
    onConfirm(partsList, grandTotal, holdReason || undefined);
  };

  return (
    <div className="fixed inset-0 bg-gray-50 z-[60] flex flex-col">
      {/* Header */}
      <div className="bg-white flex items-center justify-between px-4 py-3 border-b">
        <button onClick={onCancel} className="text-gray-500 font-semibold text-sm tap-target">&larr; Back</button>
        <h3 className="font-bold text-base">Parts & Service</h3>
        <div className="text-right">
          <div className="text-lg font-black">₹{grandTotal}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-36">
        {/* Service */}
        <div className="bg-white p-4 mb-2">
          <h4 className="font-bold text-gray-800 text-sm mb-2">Service Type</h4>
          <div className="flex gap-2 overflow-x-auto hide-scrollbar">
            {services.map((s) => (
              <button
                key={s.id}
                onClick={() => setServicePrice(servicePrice === s.price ? null : s.price)}
                className={`flex-shrink-0 rounded-xl px-4 py-2.5 border text-sm font-semibold active:scale-95 transition-transform ${
                  servicePrice === s.price ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 bg-white text-gray-700"
                }`}
              >
                {s.name} · ₹{s.price}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-sm text-gray-500">Custom:</span>
            <input
              type="number"
              inputMode="numeric"
              value={servicePrice ?? ""}
              onChange={(e) => setServicePrice(e.target.value ? Number(e.target.value) : null)}
              placeholder="₹ Amount"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-gray-800 focus:outline-none"
            />
          </div>
        </div>

        {/* Bike category */}
        <div className="bg-white p-4 mb-2">
          <h4 className="font-bold text-gray-800 text-sm mb-2">Bike Category</h4>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(BIKE_CATEGORIES).map(([key, cat]) => (
              <button
                key={key}
                onClick={() => setBikeCategory(bikeCategory === key ? null : key)}
                className={`rounded-full px-4 py-2 text-sm font-bold active:scale-95 transition-transform ${
                  bikeCategory === key ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {cat.emoji} {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Parts */}
        <div className="bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-bold text-gray-800 text-sm">
              Parts {bikeCategory ? `(${BIKE_CATEGORIES[bikeCategory as keyof typeof BIKE_CATEGORIES]?.label || bikeCategory})` : ""}
            </h4>
            <span className="text-xs text-gray-400">{filteredParts.length} items</span>
          </div>
          <input
            type="text"
            value={partsSearch}
            onChange={(e) => setPartsSearch(e.target.value)}
            placeholder="Search parts..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-3 focus:border-gray-800 focus:outline-none"
          />

          {/* Selected parts */}
          {Object.keys(selected).length > 0 && (
            <div className="mb-3 pb-3 border-b border-gray-100">
              {Object.entries(selected).map(([id, qty]) => {
                const item = priceItems.find((p) => p.id === id);
                if (!item) return null;
                return (
                  <div key={id} className="flex items-center justify-between rounded-xl px-3 py-2 mb-1 bg-gray-800 text-white">
                    <div>
                      <span className="font-medium text-sm">{item.name}</span>
                      {editingPriceId === id ? (
                        <input
                          type="number"
                          inputMode="numeric"
                          autoFocus
                          defaultValue={getPrice(id)}
                          onBlur={(e) => {
                            const val = Number(e.target.value);
                            if (val > 0 && val !== item.price) setCustomPrices((p) => ({ ...p, [id]: val }));
                            else setCustomPrices((p) => { const n = { ...p }; delete n[id]; return n; });
                            setEditingPriceId(null);
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          className="ml-2 w-16 border border-gray-500 rounded px-1 py-0.5 text-sm text-white bg-gray-700 text-right focus:outline-none"
                        />
                      ) : (
                        <button onClick={() => setEditingPriceId(id)} className="text-gray-300 text-sm ml-2 active:scale-95">
                          ₹{getPrice(id) * qty} {customPrices[id] !== undefined && "✏️"}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setQty(id, qty - 1)} className="w-7 h-7 rounded-full bg-gray-600 font-bold text-sm flex items-center justify-center">−</button>
                      <span className="font-bold text-sm w-5 text-center">{qty}</span>
                      <button onClick={() => setQty(id, qty + 1)} className="w-7 h-7 rounded-full bg-white text-gray-800 font-bold text-sm flex items-center justify-center">+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Available parts */}
          <div className="space-y-1">
            {filteredParts
              .filter((p) => !selected[p.id])
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => togglePart(p.id)}
                  className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 border border-gray-100 bg-white active:bg-gray-50 tap-target"
                >
                  <span className="font-medium text-sm text-gray-800">{p.name}</span>
                  <span className="text-gray-400 text-sm font-semibold">₹{getPrice(p.id)}</span>
                </button>
              ))}
          </div>
        </div>

        {/* Hold reason — only when putting on hold */}
        {isHold && (
          <div className="bg-white p-4 mt-2">
            <h4 className="font-bold text-gray-800 text-sm mb-2">📌 Reason for Hold *</h4>
            <input
              type="text"
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
              placeholder="e.g. Waiting for tube 26T, spoke set ordered..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-gray-800 focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg p-4 z-[60]">
        <div className="flex justify-between items-center mb-3">
          <div className="text-sm text-gray-500">
            Service ₹{servicePrice ?? 0} + Parts ₹{partsTotal}
          </div>
          <div className="text-2xl font-black text-gray-800">₹{grandTotal}</div>
        </div>
        <button
          onClick={handleConfirm}
          disabled={submitting || (isHold && !holdReason.trim())}
          className="w-full bg-gray-800 text-white font-bold py-3.5 rounded-xl text-base active:scale-95 transition-transform disabled:bg-gray-300"
        >
          {submitting ? "Saving..." : (isHold && !holdReason.trim()) ? "Enter hold reason" : isHold ? "Confirm & Hold" : "Confirm Bill"}
        </button>
      </div>
    </div>
  );
}
