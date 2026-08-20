"use client";

import { useState } from "react";

type Item = {
  id: string;
  tokenNumber: string;
  bikeType: string;
  amount: number | null;
  deliveryMatchedInvoice: string | null;
  customer: { name: string; phone: string };
  mechanic: { name: string; emoji: string } | null;
};

export default function CheckoffGate({
  items,
  onDone,
}: {
  items: Item[];
  onDone: () => void;
}) {
  // Default: everything pre-selected so one tap confirms all.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.map((i) => i.id))
  );
  const [submitting, setSubmitting] = useState(false);

  const allSelected = selected.size === items.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))
    );
  };

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    const approve = items.filter((i) => selected.has(i.id)).map((i) => i.id);
    const dismiss = items.filter((i) => !selected.has(i.id)).map((i) => i.id);
    try {
      await fetch("/api/services/checkoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve, dismiss }),
      });
      onDone();
    } catch {
      // Re-enable so STAFF can retry; the gate stays up until the list clears.
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-gray-50 overflow-y-auto">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-3xl">🚲</span>
          <div>
            <h1 className="font-bold text-gray-800 text-xl leading-tight">
              Confirm Deliveries
            </h1>
            <p className="text-gray-400 text-xs leading-tight">
              These bikes were paid in Zoho — tap to confirm pickup.
            </p>
          </div>
        </div>
      </header>

      {/* Select all / Clear toggle */}
      <div className="px-4 pt-3 pb-1 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-500">
          {selected.size} of {items.length} selected
        </span>
        <button
          onClick={toggleAll}
          className="text-sm font-bold text-green-600 bg-green-50 px-3 py-1.5 rounded-full active:scale-95 transition-transform"
        >
          {allSelected ? "Clear" : "Select all"}
        </button>
      </div>

      {/* List of tappable cards */}
      <div className="px-4 pt-2 pb-28">
        {items.map((item) => {
          const isOn = selected.has(item.id);
          return (
            <button
              key={item.id}
              onClick={() => toggle(item.id)}
              className={`w-full text-left rounded-2xl bg-white p-4 mb-2 shadow-sm flex items-center gap-3 active:scale-[0.99] transition-transform min-h-[56px] ${
                isOn ? "ring-2 ring-green-400" : ""
              }`}
            >
              <span className="text-2xl flex-shrink-0">{isOn ? "✅" : "⬜"}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg text-gray-900">
                    {item.tokenNumber}
                  </span>
                  <span className="text-gray-600 truncate">
                    {item.customer.name}
                  </span>
                </div>
                <div className="text-sm text-gray-500 truncate">
                  🚲 {item.bikeType}
                  {item.mechanic && (
                    <span className="ml-2">
                      {item.mechanic.emoji} {item.mechanic.name}
                    </span>
                  )}
                </div>
                {item.deliveryMatchedInvoice && (
                  <div className="text-[11px] font-mono text-gray-400 mt-0.5 truncate">
                    🧾 {item.deliveryMatchedInvoice}
                  </div>
                )}
              </div>
              {item.amount != null && (
                <div className="text-right flex-shrink-0">
                  <div className="text-lg font-black text-green-700">
                    ₹{item.amount.toLocaleString("en-IN")}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Sticky bottom confirm */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4">
        <button
          onClick={confirm}
          disabled={submitting}
          className="w-full bg-green-500 text-white font-bold py-3 rounded-xl text-lg active:scale-95 transition-transform disabled:opacity-60"
        >
          {submitting
            ? "Saving..."
            : `✅ Confirm ${selected.size} delivered`}
        </button>
      </div>
    </div>
  );
}
