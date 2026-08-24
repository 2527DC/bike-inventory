"use client";

import { useEffect, useState, useCallback } from "react";

const WHEEL_SIZES = ["14", "20", "24", "26", "27.5", "29", "ECYCLE"] as const;

type PriceItem = {
  id: string;
  name: string;
  category: string;
  wheelSize: string | null;
  price: number;
};

export default function PricesPage() {
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"SERVICE" | "PARTS">("SERVICE");
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [wheelSize, setWheelSize] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchPrices = useCallback(async () => {
    const res = await fetch("/api/services/prices");
    if (res.ok) setPrices((await res.json()).prices);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  const handleSave = async () => {
    if (!name.trim() || !price) return;
    setSaving(true);

    const res = await fetch("/api/services/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingId || undefined,
        name: name.trim(),
        category: tab,
        price: parseFloat(price),
        wheelSize: tab === "PARTS" ? wheelSize : null,
      }),
    });

    if (res.ok) {
      resetForm();
      fetchPrices();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this item?")) return;
    await fetch("/api/services/prices", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchPrices();
  };

  const handleEdit = (item: PriceItem) => {
    setEditingId(item.id);
    setName(item.name);
    setPrice(item.price.toString());
    setWheelSize(item.wheelSize);
    setTab(item.category as "SERVICE" | "PARTS");
    setShowForm(true);
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setName("");
    setPrice("");
    setWheelSize(null);
  };

  const catItems = prices.filter((p) => p.category === tab);
  const filtered = tab === "PARTS" && sizeFilter
    ? catItems.filter((p) => !p.wheelSize || p.wheelSize === sizeFilter)
    : catItems;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-4xl animate-bounce">💰</div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Price List</h2>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="bg-gray-800 text-white font-bold px-4 py-2 rounded-xl text-sm active:scale-95 transition-transform"
        >
          + Add
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setTab("SERVICE")}
          className={`flex-1 py-2.5 rounded-xl font-bold text-sm ${tab === "SERVICE" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"}`}
        >
          Service ({prices.filter((p) => p.category === "SERVICE").length})
        </button>
        <button
          onClick={() => setTab("PARTS")}
          className={`flex-1 py-2.5 rounded-xl font-bold text-sm ${tab === "PARTS" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"}`}
        >
          Parts ({prices.filter((p) => p.category === "PARTS").length})
        </button>
      </div>

      {/* Wheel size filter for parts */}
      {tab === "PARTS" && (
        <div className="flex gap-1.5 mb-3 overflow-x-auto hide-scrollbar pb-1">
          <button
            onClick={() => setSizeFilter(null)}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${!sizeFilter ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-500"}`}
          >
            All
          </button>
          {WHEEL_SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setSizeFilter(sizeFilter === s ? null : s)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${sizeFilter === s ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-500"}`}
            >
              {s === "ECYCLE" ? "E-Cycle" : `${s}″`}
            </button>
          ))}
          <button
            onClick={() => setSizeFilter("UNIVERSAL")}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${sizeFilter === "UNIVERSAL" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-500"}`}
          >
            Universal
          </button>
        </div>
      )}

      {/* Add/Edit form */}
      {showForm && (
        <div className="bg-gray-50 rounded-2xl p-4 mb-4 border border-gray-200">
          <h3 className="font-bold text-gray-700 mb-3">
            {editingId ? "Edit Item" : "New Item"}
          </h3>
          <div className="space-y-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tab === "SERVICE" ? "e.g. Puncture Repair" : "e.g. Brake Shoe Set"}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:border-gray-800 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-gray-500">₹</span>
              <input
                type="number"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Price"
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-base focus:border-gray-800 focus:outline-none"
              />
            </div>

            {/* Wheel size selector (parts only) */}
            {tab === "PARTS" && (
              <div>
                <label className="text-sm font-semibold text-gray-600 mb-1.5 block">Wheel Size</label>
                <div className="flex gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setWheelSize(null)}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold ${!wheelSize ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-500"}`}
                  >
                    All Sizes
                  </button>
                  {WHEEL_SIZES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setWheelSize(s)}
                      className={`rounded-full px-3 py-1.5 text-xs font-bold ${wheelSize === s ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-500"}`}
                    >
                      {s === "ECYCLE" ? "E-Cycle" : `${s}″`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={!name.trim() || !price || saving}
                className="flex-1 bg-green-600 text-white font-bold py-3 rounded-xl disabled:bg-gray-300 active:scale-95 transition-transform"
              >
                {saving ? "Saving..." : editingId ? "Update" : "Add"}
              </button>
              <button onClick={resetForm} className="px-6 bg-gray-200 text-gray-600 font-bold py-3 rounded-xl">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-lg">No items</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {filtered.map((item, i) => (
            <div
              key={item.id}
              className={`flex items-center justify-between p-3.5 ${i < filtered.length - 1 ? "border-b border-gray-100" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-800 text-sm">{item.name}</div>
                {item.wheelSize && (
                  <span className="text-xs text-gray-400">
                    {item.wheelSize === "ECYCLE" ? "E-Cycle" : `${item.wheelSize}″`}
                  </span>
                )}
                {!item.wheelSize && tab === "PARTS" && (
                  <span className="text-xs text-gray-300">All sizes</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-green-700">₹{item.price}</span>
                <button onClick={() => handleEdit(item)} className="text-gray-400 p-1 active:scale-95">✏️</button>
                <button onClick={() => handleDelete(item.id)} className="text-gray-400 p-1 active:scale-95">🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 text-center text-xs text-gray-400">
        {filtered.length} items {sizeFilter && tab === "PARTS" ? `for ${sizeFilter === "UNIVERSAL" ? "universal" : sizeFilter === "ECYCLE" ? "E-Cycle" : sizeFilter + "″"}` : ""}
      </div>
    </div>
  );
}
