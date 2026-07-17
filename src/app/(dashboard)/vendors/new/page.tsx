"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function NewVendorPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "", code: "", gstin: "", pan: "",
    addressLine1: "", city: "", state: "", pincode: "",
    phone: "", email: "", whatsappNumber: "",
    paymentTermDays: 30, creditLimit: 0,
    cdTermsDays: 0, cdPercentage: 0,
  });

  function update(field: string, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.code) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to create vendor");
      router.push("/vendors");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = !form.name || !form.code || submitting;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link
          href="/vendors"
          aria-label="Back"
          className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900 truncate">Add Vendor</h1>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Vendor Name *</label>
            <Input className="min-h-[44px]" placeholder="Hero Cycles Ltd" value={form.name} onChange={(e) => update("name", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Code *</label>
            <Input className="min-h-[44px]" placeholder="HERO" value={form.code} onChange={(e) => update("code", e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">GSTIN</label>
            <Input className="min-h-[44px]" placeholder="22AAAAA0000A1Z5" value={form.gstin} onChange={(e) => update("gstin", e.target.value.toUpperCase())} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">PAN</label>
          <Input className="min-h-[44px]" placeholder="AAAAA0000A" value={form.pan} onChange={(e) => update("pan", e.target.value.toUpperCase())} />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
          <Input className="min-h-[44px]" placeholder="Street address" value={form.addressLine1} onChange={(e) => update("addressLine1", e.target.value)} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
            <Input className="min-h-[44px]" value={form.city} onChange={(e) => update("city", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">State</label>
            <Input className="min-h-[44px]" value={form.state} onChange={(e) => update("state", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Pincode</label>
            <Input className="min-h-[44px] tabular-nums" inputMode="numeric" value={form.pincode} onChange={(e) => update("pincode", e.target.value)} maxLength={6} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
            <Input className="min-h-[44px] tabular-nums" type="tel" inputMode="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp</label>
            <Input className="min-h-[44px] tabular-nums" type="tel" inputMode="tel" value={form.whatsappNumber} onChange={(e) => update("whatsappNumber", e.target.value)} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <Input className="min-h-[44px]" type="email" inputMode="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Terms (days)</label>
            <Input className="min-h-[44px] tabular-nums" type="number" inputMode="numeric" value={form.paymentTermDays} onChange={(e) => update("paymentTermDays", parseInt(e.target.value) || 0)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Credit Limit</label>
            <Input className="min-h-[44px] tabular-nums" type="number" inputMode="decimal" value={form.creditLimit} onChange={(e) => update("creditLimit", parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">CD Terms (days)</label>
            <Input className="min-h-[44px] tabular-nums" type="number" inputMode="numeric" value={form.cdTermsDays} onChange={(e) => update("cdTermsDays", parseInt(e.target.value) || 0)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">CD %</label>
            <Input className="min-h-[44px] tabular-nums" type="number" inputMode="decimal" step="0.1" value={form.cdPercentage} onChange={(e) => update("cdPercentage", parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <div className="space-y-1">
          <Button type="submit" size="lg" disabled={disabled} className="w-full min-h-[48px] bg-green-600 hover:bg-green-700 text-white">
            {submitting ? "Creating..." : "Create Vendor"}
          </Button>
          {!form.name || !form.code ? (
            <p className="text-xs text-slate-500 text-center">Vendor name and code are required.</p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
