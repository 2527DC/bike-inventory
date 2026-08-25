"use client";

import { useState, useEffect, useRef } from "react";
import { JOB_TYPE, BIKE_CATEGORIES, getBikeCategory } from "@/lib/services/constants";
import { getInwardWhatsAppUrl } from "@/lib/services/whatsapp";
import { errorMessage } from "@/lib/utils";

// Job types that skip KYC — go straight to mechanic assign
const SKIP_KYC_TYPES = ["QFX", "FSVC", "SND", "WSH"];
// Job types that need spares & service pricing page
const NEEDS_PRICING = ["RSVC", "SND", "ECYC"];

type Mechanic = {
  id: string;
  name: string;
  emoji: string;
  _count: { assignedJobs: number };
};

type PriceItem = {
  id: string;
  name: string;
  category: string;
  wheelSize: string | null;
  price: number;
};

// Compress image to max 800px wide, JPEG 0.7 quality (~100-200KB)
function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1200;
      const scale = img.width > maxW ? maxW / img.width : 1;
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          resolve(new File([blob!], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.85
      );
    };
    img.src = URL.createObjectURL(file);
  });
}

function SaveContactAndSend({ phone, name, token, jobId, waUrl }: { phone: string; name: string; token: string; jobId: string; waUrl: string }) {
  const [saved, setSaved] = useState(false);
  const contactName = `${name.toLowerCase().replace(/\s+/g, "-")}-${token.toLowerCase()}`;

  const handleSaveContact = () => {
    // Create vCard and trigger download
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${contactName}\nTEL;TYPE=CELL:+91${phone}\nEND:VCARD`;
    const blob = new Blob([vcard], { type: "text/vcard" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${contactName}.vcf`;
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  return (
    <>
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mt-4 text-center">
        <p className="text-sm font-bold text-yellow-700 mb-2">📱 Step 1: Save contact</p>
        <p className="text-lg font-mono font-bold text-gray-800">{phone}</p>
        <p className="text-sm text-gray-600 mt-1 font-medium">{contactName}</p>
      </div>
      <button
        onClick={handleSaveContact}
        className={`w-full mt-2 font-bold py-3.5 rounded-xl text-base active:scale-95 transition-transform ${saved ? "bg-green-100 text-green-700 border border-green-300" : "bg-yellow-500 text-white"}`}
      >
        {saved ? "✅ Contact Saved" : "📥 Save Contact to Phone"}
      </button>
      <button
        onClick={() => {
          window.open(waUrl, "_blank");
          fetch("/api/services/notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId,
              tokenNumber: token,
              customerPhone: phone,
              customerName: name,
              messageType: "INWARD",
            }),
          }).catch(() => {});
        }}
        disabled={!saved}
        className="w-full mt-2 bg-green-500 text-white font-bold py-3.5 rounded-xl text-base active:scale-95 transition-transform disabled:bg-gray-300 disabled:text-gray-500"
      >
        {saved ? "📱 Send Token via WhatsApp" : "📱 Save contact first"}
      </button>
    </>
  );
}

export default function CounterPage() {
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [step, setStep] = useState(1);
  const [token, setToken] = useState("");
  const [currentUser, setCurrentUser] = useState<{ id: string; role: string } | null>(null);

  // Form state
  const [jobType, setJobType] = useState("");
  const [isEcycle, setIsEcycle] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [bikeType, setBikeType] = useState("");
  const [complaint, setComplaint] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [mechanicId, setMechanicId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState("");
  const [, setPhotos] = useState<string[]>([]);
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [localPreviews, setLocalPreviews] = useState<string[]>([]);
  const [isReturning, setIsReturning] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});
  const [pricingTab, setPricingTab] = useState<"SERVICE" | "PARTS">("SERVICE");
  const [partsSearch, setPartsSearch] = useState("");
  const [partsCategory, setPartsCategory] = useState<string | null>(null);
  const [customPrices, setCustomPrices] = useState<Record<string, number>>({});
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [savedPartsText, setSavedPartsText] = useState<string | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddPrice, setQuickAddPrice] = useState("");
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promisedDate, setPromisedDate] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/services/mechanics").then(async (res) => {
      if (res.ok) setMechanics((await res.json()).mechanics);
      else setError(`Failed to load mechanics (${res.status})`);
    }).catch((e) => setError(`Network error: ${errorMessage(e)}`));
    fetch("/api/auth/me").then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        if (data.user) setCurrentUser({ id: data.user.id, role: data.user.role });
      } else setError(`Failed to load user (${res.status})`);
    }).catch((e) => setError(`Network error: ${errorMessage(e)}`));
    fetch("/api/services/prices").then(async (res) => {
      if (res.ok) setPrices((await res.json()).prices);
      else setError(`Failed to load prices (${res.status})`);
    }).catch((e) => setError(`Network error: ${errorMessage(e)}`));
  }, []);

  const skipKyc = SKIP_KYC_TYPES.includes(jobType);
  const needsPricing = NEEDS_PRICING.includes(jobType);
  const isMechanic = currentUser?.role === "MECHANIC";

  const handleSubmit = async () => {
    const name = customerName || "Walk-in Customer";
    const phone = customerPhone.length === 10 ? customerPhone : "0000000000";
    const bike = bikeType || "Cycle";

    if (!jobType) return;
    if (!skipKyc && (!customerName || customerPhone.length !== 10 || !bikeType)) return;

    setSubmitting(true);
    const res = await fetch("/api/services/jobs/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: name,
        customerPhone: phone.replace(/\D/g, "").slice(0, 10),
        bikeType: bike,
        complaint,
        jobType,
        isEcycle,
        amount,
        mechanicId: mechanicId || undefined,
        promisedDate: promisedDate || undefined,
        partsNeeded: savedPartsText || (Object.entries(selectedItems).length > 0
          ? Object.entries(selectedItems).map(([id, qty]) => {
              const item = prices.find((p) => p.id === id);
              if (!item) return "";
              const price = getItemPrice(id);
              return qty > 1 ? `${item.name} x${qty} (₹${price * qty})` : `${item.name} (₹${price})`;
            }).filter(Boolean).join(", ")
          : (amount != null && amount > 0
              ? `${JOB_TYPE[jobType as keyof typeof JOB_TYPE]?.label || jobType} (₹${amount})`
              : (JOB_TYPE[jobType as keyof typeof JOB_TYPE]?.label || undefined))),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setToken(data.tokenNumber);
      setJobId(data.jobId);

      if (localFiles.length > 0) {
        try {
          const compressed = await Promise.all(localFiles.map(compressImage));
          const uploads = compressed.map((file) => {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("jobId", data.jobId);
            return fetch("/api/services/upload", { method: "POST", body: formData });
          });
          const results = await Promise.all(uploads);
          const last = results[results.length - 1];
          if (last.ok) {
            const upData = await last.json();
            setPhotos(upData.photos);
          } else {
            setError(`Photo upload failed (${last.status})`);
          }
        } catch (e) {
          setError(`Photo upload error: ${errorMessage(e)}`);
        }
      }

      setStep(10);
    } else {
      const err = await res.json().catch(() => ({ error: "Job creation failed" }));
      setError(err.error || `Job creation failed (${res.status})`);
    }
    setSubmitting(false);
  };

  // Auto-submit when mechanic skips assign step (step 4)
  useEffect(() => {
    if (step === 4 && !submitting && !jobId) {
      handleSubmit();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const selectedType = jobType ? JOB_TYPE[jobType as keyof typeof JOB_TYPE] : null;

  // Calculate total from selected price items
  const getItemPrice = (id: string) => {
    if (customPrices[id] !== undefined) return customPrices[id];
    const item = prices.find((p) => p.id === id);
    return item ? item.price : 0;
  };
  const selectedTotal = Object.entries(selectedItems).reduce((sum, [id, qty]) => {
    return sum + getItemPrice(id) * qty;
  }, 0);

  const resetForm = () => {
    setStep(1);
    setCustomerName(""); setCustomerPhone(""); setBikeType("");
    setComplaint(""); setJobType(""); setMechanicId("");
    setToken(""); setJobId(""); setPhotos([]);
    setAmount(null); setIsEcycle(false); setIsReturning(false); setPromisedDate("");
    setLocalFiles([]); setLocalPreviews([]);
    setSelectedItems({}); setPricingTab("SERVICE"); setPartsSearch(""); setPartsCategory(null); setCustomPrices({}); setEditingPriceId(null); setSavedPartsText(null);
  };

  // Error banner component
  const errorBanner = error ? (
    <div className="mx-4 mb-3 bg-red-600 rounded-xl p-3 flex items-start gap-2 shadow-lg">
      <span className="text-white text-sm font-bold flex-1">⚠️ {error}</span>
      <button onClick={() => setError(null)} className="text-white/70 font-bold text-sm">✕</button>
    </div>
  ) : null;

  // ─── Step 1: Job type selection ───
  if (step === 1) {
    return (
      <div className="p-4 pb-24">
        {errorBanner}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">What type of job?</h2>
          <button
            onClick={() => window.open("/catalogue.pdf", "_blank")}
            className="bg-blue-50 text-blue-700 font-bold px-3 py-1.5 rounded-xl text-sm active:scale-95 transition-transform"
          >
            📋 Catalogue
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {Object.entries(JOB_TYPE).map(([key, val]) => (
            <button
              key={key}
              onClick={() => {
                setJobType(key);
                setAmount(key === "WSH" ? null : val.amount);
                setIsEcycle(key === "ECYC");
                setStep(5);
              }}
              className="bg-white rounded-xl p-4 flex flex-col items-center gap-1.5 shadow-sm border border-gray-100 active:scale-95 transition-transform"
            >
              <span className="text-2xl">{val.emoji}</span>
              <span className="font-bold text-gray-800 text-sm">{val.label}</span>
              <span className="text-xs text-gray-500">
                {key === "WSH" ? "Wash" : val.amount === 0 ? "Free" : val.amount ? `₹${val.amount}` : "Variable"}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ─── Step 5: Take bike photo ───
  if (step === 5) {
    const nextStep = () => {
      if (isMechanic && currentUser) {
        setMechanicId(currentUser.id);
        setStep(skipKyc ? 4 : 2);
      } else {
        setStep(skipKyc ? 3 : 2);
      }
    };

    const addPhoto = (file: File) => {
      const preview = URL.createObjectURL(file);
      setLocalFiles((prev) => [...prev, file]);
      setLocalPreviews((prev) => [...prev, preview]);
    };

    return (
      <div className="p-4 pb-24">
        <button onClick={() => { setStep(1); setLocalFiles([]); setLocalPreviews([]); }} className="text-gray-400 text-sm font-medium mb-4 tap-target">
          &larr; Back
        </button>
        <h2 className="text-lg font-bold mb-2">Bike Photo</h2>
        <p className="text-gray-400 text-sm mb-4">Take a photo of the bike for records</p>

        {localPreviews.length > 0 && (
          <div className="flex gap-2 mb-4 overflow-x-auto hide-scrollbar">
            {localPreviews.map((url, i) => (
              <img key={i} src={url} alt={`Bike ${i + 1}`} className="w-24 h-24 rounded-xl object-cover flex-shrink-0 border border-gray-200" />
            ))}
          </div>
        )}

        {localFiles.length < 7 && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) addPhoto(file);
                e.target.value = "";
              }}
            />
            <input
              id="gallery-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) addPhoto(file);
                e.target.value = "";
              }}
            />
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex-1 bg-gray-800 text-white font-bold py-4 rounded-xl text-base active:scale-95 transition-transform"
              >
                📷 Camera
              </button>
              <button
                onClick={() => document.getElementById("gallery-input")?.click()}
                className="flex-1 bg-gray-100 text-gray-700 font-bold py-4 rounded-xl text-base active:scale-95 transition-transform"
              >
                🖼️ Gallery
              </button>
            </div>
          </>
        )}

        <button
          onClick={nextStep}
          className="w-full bg-gray-800 text-white font-bold py-3.5 rounded-xl text-base active:scale-95 transition-transform"
        >
          {localFiles.length === 0 ? "Skip Photo" : "Next"}
        </button>
      </div>
    );
  }

  // ─── Step 2: Customer Details (no amount — that's in pricing page) ───
  if (step === 2) {
    const phoneValid = customerPhone.length === 10;
    const canProceed = customerName && phoneValid && bikeType && (!needsPricing || promisedDate);

    // After customer details: go to pricing page if needed, else assign/submit
    const nextFromCustomer = () => {
      if (!canProceed) return;
      if (needsPricing) {
        setStep(6); // spares & service page
      } else if (isMechanic) {
        setStep(4); // auto-submit
      } else {
        setStep(3); // assign mechanic
      }
    };

    return (
      <div className="p-4 pb-24">
        <button onClick={() => setStep(5)} className="text-gray-400 text-sm font-medium mb-4 tap-target">
          &larr; Back
        </button>
        <h2 className="text-lg font-bold mb-4">Customer Details</h2>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Phone Number *</label>
            <input
              type="tel"
              inputMode="numeric"
              value={customerPhone}
              onChange={async (e) => {
                const raw = e.target.value.replace(/\D/g, "").slice(0, 10);
                setCustomerPhone(raw);
                setIsReturning(false);
                if (raw.length === 10) {
                  const res = await fetch(`/api/services/customers?phone=${raw}`);
                  if (res.ok) {
                    const data = await res.json();
                    if (data.customer && data.customer.phone === raw) {
                      setCustomerName(data.customer.name);
                      setIsReturning(true);
                      if (data.customer.jobs?.[0]?.bikeType) setBikeType(data.customer.jobs[0].bikeType);
                    }
                  }
                }
              }}
              placeholder="9876543210"
              maxLength={10}
              className={`w-full border rounded-xl px-3 py-3 text-base focus:outline-none ${
                customerPhone.length > 0 && customerPhone.length < 10
                  ? "border-red-300 focus:border-red-500"
                  : "border-gray-200 focus:border-gray-800"
              }`}
            />
            {customerPhone.length === 10 && isReturning && (
              <div className="mt-1 text-xs text-green-600 font-medium">Returning customer — auto-filled</div>
            )}
            {customerPhone.length > 0 && customerPhone.length < 10 && (
              <div className="mt-1 text-xs text-red-500 font-medium">
                Enter 10 digits ({customerPhone.length}/10)
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Customer Name *</label>
            <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Full name" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base focus:border-gray-800 focus:outline-none" />
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Bike Model *</label>
            <input type="text" value={bikeType} onChange={(e) => setBikeType(e.target.value)}
              placeholder="Hero Sprint 26T" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base focus:border-gray-800 focus:outline-none" />
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Problem / Notes</label>
            <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)}
              placeholder="What's the issue?" rows={2}
              className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base focus:border-gray-800 focus:outline-none resize-none" />
          </div>

          {/* Promised delivery — for paid services */}
          {needsPricing && (
            <div>
              <label className="text-sm font-semibold text-gray-700 mb-1 block">Promised Delivery *</label>
              <div className="grid grid-cols-4 gap-2">
                {([
                  ["today", "Today", 0],
                  ["t1", "T+1", 1],
                  ["t2", "T+2", 2],
                  ["t3", "T+3", 3],
                ] as const).map(([key, label, days]) => {
                  const d = new Date();
                  d.setDate(d.getDate() + days);
                  const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPromisedDate(val)}
                      className={`py-2.5 rounded-xl font-bold text-sm active:scale-95 transition-transform ${promisedDate === val ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={nextFromCustomer}
          disabled={!canProceed}
          className="w-full mt-5 bg-gray-800 text-white font-bold py-3.5 rounded-xl text-base disabled:bg-gray-300 active:scale-95 transition-transform"
        >
          Next
        </button>
      </div>
    );
  }

  // ─── Step 6: Spares & Service pricing page ───
  if (step === 6) {
    const serviceItems = prices.filter((p) => p.category === "SERVICE");
    const allPartsItems = prices.filter((p) => p.category === "PARTS");
    // Get unique wheel size categories for parts
    // Filter parts by selected category, then by search
    const catFiltered = (() => {
      if (!partsCategory || partsCategory === "ALL") return allPartsItems;
      if (partsCategory === "Universal") return allPartsItems.filter((p) => !p.wheelSize);
      const bikeCat = BIKE_CATEGORIES[partsCategory as keyof typeof BIKE_CATEGORIES];
      if (bikeCat) return allPartsItems.filter((p) => p.wheelSize && bikeCat.sizes.includes(p.wheelSize));
      return allPartsItems.filter((p) => (p.wheelSize || "Universal") === partsCategory);
    })();
    const partsItems = partsSearch.trim()
      ? catFiltered.filter((p) => p.name.toLowerCase().includes(partsSearch.toLowerCase()))
      : catFiltered;
    const currentItems = pricingTab === "SERVICE" ? serviceItems : partsItems;

    // Group parts by bike category for display
    const partsGrouped: Record<string, PriceItem[]> = {};
    partsItems.forEach((p) => {
      const group = getBikeCategory(p.wheelSize);
      if (!partsGrouped[group]) partsGrouped[group] = [];
      partsGrouped[group].push(p);
    });

    const toggleItem = (id: string) => {
      setSelectedItems((prev) => {
        const next = { ...prev };
        if (next[id]) {
          delete next[id];
        } else {
          next[id] = 1;
        }
        return next;
      });
    };

    const updateQty = (id: string, qty: number) => {
      if (qty <= 0) {
        setSelectedItems((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        setSelectedItems((prev) => ({ ...prev, [id]: qty }));
      }
    };

    const selectedCount = Object.keys(selectedItems).length;

    const proceedFromPricing = () => {
      if (selectedTotal > 0) {
        setAmount(selectedTotal);
      }
      // Save parts text before moving to next step
      if (Object.keys(selectedItems).length > 0) {
        const partsText = Object.entries(selectedItems).map(([id, qty]) => {
          const item = prices.find((p) => p.id === id);
          if (!item) return "";
          const price = getItemPrice(id);
          return qty > 1 ? `${item.name} x${qty} (₹${price * qty})` : `${item.name} (₹${price})`;
        }).filter(Boolean).join(", ");
        setSavedPartsText(partsText);
      } else if (amount != null && amount > 0) {
        // Manual amount without items — save job type as description
        const typeLabel = selectedType?.label || jobType;
        setSavedPartsText(`${typeLabel} (₹${amount})`);
      }
      if (isMechanic) {
        setStep(4);
      } else {
        setStep(3);
      }
    };

    const renderItem = (item: PriceItem) => {
      const isSelected = !!selectedItems[item.id];
      const qty = selectedItems[item.id] || 0;
      const displayPrice = customPrices[item.id] !== undefined ? customPrices[item.id] : item.price;
      const isEditing = editingPriceId === item.id;
      return (
        <div
          key={item.id}
          className={`rounded-xl p-3 border transition-colors ${
            isSelected ? "bg-green-50 border-green-200" : "bg-white border-gray-100"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 ${
              isSelected ? "bg-green-500 border-green-500" : "border-gray-300"
            }`} onClick={() => toggleItem(item.id)}>
              {isSelected && <span className="text-white text-sm font-bold">✓</span>}
            </div>
            <div className="flex-1 min-w-0" onClick={() => toggleItem(item.id)}>
              <div className="font-semibold text-sm text-gray-800">{item.name}</div>
            </div>
            {isEditing ? (
              <input
                type="number"
                inputMode="numeric"
                autoFocus
                defaultValue={displayPrice}
                onBlur={(e) => {
                  const val = Number(e.target.value);
                  if (val > 0 && val !== item.price) setCustomPrices((p) => ({ ...p, [item.id]: val }));
                  else setCustomPrices((p) => { const n = { ...p }; delete n[item.id]; return n; });
                  setEditingPriceId(null);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="w-20 border-2 border-green-400 rounded-lg px-2 py-1 text-sm font-bold text-green-700 text-right focus:outline-none"
              />
            ) : (
              <button onClick={() => setEditingPriceId(item.id)} className="font-bold text-green-700 active:scale-95">
                ₹{displayPrice}
                {customPrices[item.id] !== undefined && <span className="text-xs text-orange-500 ml-1">✏️</span>}
              </button>
            )}
          </div>
          {isSelected && pricingTab === "PARTS" && (
            <div className="flex items-center justify-end gap-3 mt-2">
              <button onClick={() => updateQty(item.id, qty - 1)} className="w-8 h-8 bg-gray-200 rounded-lg font-bold text-lg active:scale-95">−</button>
              <span className="font-bold text-sm w-6 text-center">{qty}</span>
              <button onClick={() => updateQty(item.id, qty + 1)} className="w-8 h-8 bg-gray-200 rounded-lg font-bold text-lg active:scale-95">+</button>
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="p-4 pb-32">
        <button onClick={() => setStep(2)} className="text-gray-400 text-sm font-medium mb-4 tap-target">
          &larr; Back
        </button>
        <h2 className="text-lg font-bold mb-1">Spares & Service</h2>
        <p className="text-gray-400 text-sm mb-4">Select services and parts for this job</p>

        {/* Category tabs */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => { setPricingTab("SERVICE"); setPartsSearch(""); setPartsCategory(null); }}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm ${pricingTab === "SERVICE" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"}`}
          >
            🛠️ Service ({serviceItems.length})
          </button>
          <button
            onClick={() => { setPricingTab("PARTS"); setPartsCategory(null); }}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm ${pricingTab === "PARTS" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"}`}
          >
            🔩 Parts ({allPartsItems.length})
          </button>
        </div>

        {/* Selected items summary — always visible when items are picked */}
        {selectedCount > 0 && (
          <div className="mb-3 bg-gray-800 rounded-xl p-3">
            <div className="text-xs font-bold text-gray-300 mb-2">✅ Selected ({selectedCount})</div>
            {Object.entries(selectedItems).map(([id, qty]) => {
              const item = prices.find((p) => p.id === id);
              if (!item) return null;
              const price = getItemPrice(id);
              return (
                <div key={id} className="flex items-center justify-between py-1.5 border-b border-gray-700 last:border-0">
                  <span className="text-white text-sm font-medium flex-1">{item.name}</span>
                  <button onClick={() => setEditingPriceId(editingPriceId === id ? null : id)} className="text-green-400 text-sm font-bold mx-2">
                    ₹{price * qty}
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => updateQty(id, qty - 1)} className="w-6 h-6 bg-gray-600 rounded text-white text-sm font-bold flex items-center justify-center">−</button>
                    <span className="text-white text-sm font-bold w-4 text-center">{qty}</span>
                    <button onClick={() => updateQty(id, qty + 1)} className="w-6 h-6 bg-white text-gray-800 rounded text-sm font-bold flex items-center justify-center">+</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Parts: category picker → then items */}
        {pricingTab === "PARTS" && !partsCategory && (
          <div className="mb-3">
            <p className="text-sm font-semibold text-gray-600 mb-2">Select bike category:</p>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(BIKE_CATEGORIES).map(([key, cat]) => {
                const catCount = allPartsItems.filter((p) => cat.sizes.includes(p.wheelSize || "")).length;
                return (
                  <button
                    key={key}
                    onClick={() => setPartsCategory(key)}
                    className="bg-white rounded-xl p-3 flex flex-col items-center gap-1 shadow-sm border border-gray-100 active:scale-95 transition-transform"
                  >
                    <span className="text-xl">{cat.emoji}</span>
                    <span className="font-bold text-sm text-gray-800">{cat.label}</span>
                    <span className="text-xs text-gray-400">{catCount} items</span>
                  </button>
                );
              })}
              {/* Universal (no wheel size) */}
              {(() => {
                const uniCount = allPartsItems.filter((p) => !p.wheelSize).length;
                return uniCount > 0 ? (
                  <button
                    onClick={() => setPartsCategory("Universal")}
                    className="bg-white rounded-xl p-3 flex flex-col items-center gap-1 shadow-sm border border-gray-100 active:scale-95 transition-transform"
                  >
                    <span className="text-xl">🔧</span>
                    <span className="font-bold text-sm text-gray-800">Universal</span>
                    <span className="text-xs text-gray-400">{uniCount} items</span>
                  </button>
                ) : null;
              })()}
              <button
                onClick={() => setPartsCategory("ALL")}
                className="bg-gray-800 text-white rounded-xl p-3 flex flex-col items-center gap-1 shadow-sm active:scale-95 transition-transform"
              >
                <span className="text-xl">📋</span>
                <span className="font-bold text-sm">All</span>
                <span className="text-xs text-gray-300">{allPartsItems.length} items</span>
              </button>
            </div>
          </div>
        )}

        {/* Search bar for parts — shown after category selected */}
        {pricingTab === "PARTS" && partsCategory && (
          <div className="mb-3">
            {partsCategory && partsCategory !== "ALL" && (
              <button
                onClick={() => { setPartsCategory(null); setPartsSearch(""); }}
                className="text-gray-400 text-sm font-medium mb-2 tap-target"
              >
                &larr; {BIKE_CATEGORIES[partsCategory as keyof typeof BIKE_CATEGORIES]?.label || partsCategory} — change
              </button>
            )}
            <input
              type="text"
              value={partsSearch}
              onChange={(e) => setPartsSearch(e.target.value)}
              placeholder="🔍 Search parts..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-gray-800 focus:outline-none"
            />
          </div>
        )}

        {/* Items list */}
        {pricingTab === "PARTS" && !partsCategory ? null : pricingTab === "SERVICE" ? (
          currentItems.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400">No service items added yet</p>
            </div>
          ) : (
            <div className="space-y-1.5 mb-4">{serviceItems.map(renderItem)}</div>
          )
        ) : (
          /* Parts grouped by wheel size */
          partsItems.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400">{partsSearch ? "No matching parts" : "No parts added yet"}</p>
            </div>
          ) : (
            <div className="mb-4">
              {Object.entries(partsGrouped).map(([group, items]) => (
                <div key={group} className="mb-3">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5 px-1">{group}</div>
                  <div className="space-y-1.5">{items.map(renderItem)}</div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Quick add new part */}
        {showQuickAdd ? (
          <div className="bg-blue-50 rounded-xl p-3 mb-3 border border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-blue-700">+ New Item</span>
              <button onClick={() => { setShowQuickAdd(false); setQuickAddName(""); setQuickAddPrice(""); }} className="text-blue-400 text-xs font-bold">✕</button>
            </div>
            <div className="flex gap-2">
              <input type="text" value={quickAddName} onChange={(e) => setQuickAddName(e.target.value)} placeholder="Item name"
                className="flex-1 border border-blue-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              <input type="number" inputMode="numeric" value={quickAddPrice} onChange={(e) => setQuickAddPrice(e.target.value)} placeholder="₹"
                className="w-20 border border-blue-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              <button
                disabled={!quickAddName.trim() || !quickAddPrice || quickAddSaving}
                onClick={async () => {
                  setQuickAddSaving(true);
                  const res = await fetch("/api/services/prices", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: quickAddName.trim(), category: pricingTab, price: parseFloat(quickAddPrice), wheelSize: pricingTab === "PARTS" && partsCategory && partsCategory !== "ALL" && partsCategory !== "Universal" ? partsCategory : null }),
                  });
                  if (res.ok) {
                    const pricesRes = await fetch("/api/services/prices");
                    if (pricesRes.ok) setPrices((await pricesRes.json()).prices);
                    setQuickAddName(""); setQuickAddPrice(""); setShowQuickAdd(false);
                  } else {
                    const err = await res.json().catch(() => ({ error: "Failed" }));
                    setError(err.error || `Failed to add item (${res.status})`);
                  }
                  setQuickAddSaving(false);
                }}
                className="bg-blue-600 text-white font-bold px-4 rounded-lg text-sm disabled:bg-gray-300 active:scale-95"
              >
                {quickAddSaving ? "..." : "Add"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowQuickAdd(true)} className="w-full mb-3 bg-blue-50 text-blue-600 font-bold py-2.5 rounded-xl text-sm active:scale-95 transition-transform border border-blue-200">
            + Add New Item
          </button>
        )}

        {/* Manual amount — hidden for paid services (must select items) */}
        {Object.keys(selectedItems).length === 0 && !needsPricing && (
          <div className="bg-gray-50 rounded-xl p-3 mb-4 border border-gray-200">
            <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Custom Amount (₹)</label>
            <input
              type="number"
              inputMode="numeric"
              value={amount ?? ""}
              onChange={(e) => {
                setAmount(e.target.value ? Number(e.target.value) : null);
              }}
              placeholder="Enter amount manually"
              className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base focus:border-gray-800 focus:outline-none"
            />
            <p className="text-xs text-gray-400 mt-1">Or select items above to auto-calculate</p>
          </div>
        )}
        {Object.keys(selectedItems).length === 0 && needsPricing && (
          <div className="bg-red-50 rounded-xl p-3 mb-4 border border-red-200">
            <p className="text-sm font-bold text-red-600">⚠️ Select at least one service or part to proceed</p>
            <p className="text-xs text-red-500 mt-1">Paid services require itemized breakdown</p>
          </div>
        )}
        {Object.keys(selectedItems).length > 0 && (
          <div className="bg-green-50 rounded-xl p-3 mb-4 border border-green-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-green-700">Items Total</span>
              <span className="text-lg font-black text-green-800">₹{selectedTotal}</span>
            </div>
            <p className="text-xs text-green-600 mt-1">Amount auto-calculated from selected items</p>
          </div>
        )}

        {/* Sticky bottom bar with total */}
        <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-gray-200 p-4 z-40">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-sm text-gray-500">{selectedCount} items selected</span>
            </div>
            <div className="text-xl font-black text-gray-800">
              ₹{selectedTotal > 0 ? selectedTotal : (amount || 0)}
            </div>
          </div>
          <button
            onClick={proceedFromPricing}
            disabled={needsPricing && selectedCount === 0}
            className="w-full bg-green-600 text-white font-bold py-3.5 rounded-xl text-base active:scale-95 transition-transform disabled:bg-gray-300"
          >
            {needsPricing && selectedCount === 0 ? "Select items to continue" : isMechanic ? "Create Job" : "Next — Assign Mechanic"}
          </button>
        </div>
      </div>
    );
  }

  // ─── Step 3: Assign mechanic ───
  if (step === 3) {
    const backStep = skipKyc ? 5 : needsPricing ? 6 : 2;
    return (
      <div className="p-4 pb-24">
        <button onClick={() => setStep(backStep)} className="text-gray-400 text-sm font-medium mb-4 tap-target">
          &larr; Back
        </button>
        <h2 className="text-lg font-bold mb-2">Assign mechanic *</h2>
        <p className="text-gray-400 text-sm mb-4">Select a mechanic to assign this job</p>

        <div className="grid grid-cols-3 gap-2.5 mb-4">
          {mechanics.map((m) => (
            <button
              key={m.id}
              onClick={() => setMechanicId(m.id)}
              className={`bg-white rounded-xl p-3 flex flex-col items-center gap-1 shadow-sm border active:scale-95 transition-transform ${
                mechanicId === m.id ? "border-gray-800 bg-gray-50" : "border-gray-100"
              }`}
            >
              <span className="text-2xl">{m.emoji}</span>
              <span className="font-bold text-xs">{m.name}</span>
              <span className="text-xs text-gray-400">{m._count.assignedJobs} jobs</span>
            </button>
          ))}
        </div>

        {/* For skip-KYC: minimal bike info */}
        {skipKyc && (
          <div className="mb-4">
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Bike (optional)</label>
            <input type="text" value={bikeType} onChange={(e) => setBikeType(e.target.value)}
              placeholder="Bike model" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base focus:border-gray-800 focus:outline-none" />
          </div>
        )}

        {/* Show amount summary if set */}
        {amount != null && amount > 0 && (
          <div className="bg-green-50 rounded-xl p-3 mb-4 text-center">
            <span className="text-sm text-gray-500">Total: </span>
            <span className="text-lg font-black text-green-700">₹{amount}</span>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || !mechanicId}
          className="w-full bg-green-600 text-white font-bold py-3.5 rounded-xl text-base disabled:bg-gray-300 active:scale-95 transition-transform"
        >
          {submitting ? "Creating..." : !mechanicId ? "Select a mechanic" : "Create Job"}
        </button>
      </div>
    );
  }

  // ─── Step 4: Auto-submit loading (mechanic inward) ───
  if (step === 4) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg font-medium text-gray-500">Creating job...</div>
      </div>
    );
  }

  // ─── Step 10: Success — token + WhatsApp ───
  // Build items breakdown from selected price items
  const itemsBreakdown = Object.entries(selectedItems).length > 0
    ? Object.entries(selectedItems).map(([id, qty]) => {
        const item = prices.find((p) => p.id === id);
        if (!item) return "";
        const price = getItemPrice(id);
        return qty > 1 ? `• ${item.name} x${qty} — ₹${price * qty}` : `• ${item.name} — ₹${price}`;
      }).filter(Boolean).join("\n")
    : savedPartsText
      ? savedPartsText.split(", ").map((s) => `• ${s}`).join("\n")
      : null;
  const waUrl = getInwardWhatsAppUrl(
    customerPhone,
    customerName || "Customer",
    token,
    selectedType?.label || "Service",
    amount,
    itemsBreakdown,
    promisedDate || null,
  );

  return (
    <div className="p-4 pb-24">
      <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
        <h2 className="text-xl font-bold text-green-700 mb-1">Token Ready</h2>
        <div className="text-4xl font-black text-green-800 my-4">{token}</div>
        <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
          <span>{selectedType?.label}</span>
          {amount !== null && jobType !== "WSH" && jobType !== "FSVC" && <span className="font-bold">₹{amount}</span>}
        </div>
      </div>

      {waUrl && !isMechanic && (
        <SaveContactAndSend
          phone={customerPhone}
          name={customerName || "Customer"}
          token={token}
          jobId={jobId}
          waUrl={waUrl}
        />
      )}
      {isMechanic && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mt-4 text-center">
          <p className="text-sm font-medium text-blue-700">📢 Ask counter staff to send token via WhatsApp</p>
        </div>
      )}

      <button onClick={resetForm}
        className="w-full mt-3 bg-gray-800 text-white font-bold py-3.5 rounded-xl text-base active:scale-95 transition-transform">
        New Drop-off
      </button>
    </div>
  );
}
