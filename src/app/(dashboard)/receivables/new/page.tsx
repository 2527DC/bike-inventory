"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CustomerOption { id: string; name: string; phone?: string; }

export default function NewInvoicePage() {
  const router = useRouter();

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Inline new customer form
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  useEffect(() => {
    fetch("/api/customers?limit=100")
      .then((r) => r.json())
      .then((res) => { if (res.success) setCustomers(res.data); })
      .catch(() => {});
  }, []);

  async function handleCreateCustomer() {
    if (!newName.trim()) return;
    setCreatingCustomer(true);
    setError("");
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), phone: newPhone.trim() || undefined }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to create customer");
      const created = data.data as CustomerOption;
      setCustomers((prev) => [...prev, created]);
      setCustomerId(created.id);
      setShowNewCustomer(false);
      setNewName("");
      setNewPhone("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create customer");
    } finally {
      setCreatingCustomer(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId || !invoiceNo || !invoiceDate || !dueDate || !amount) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/customer-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          invoiceNo,
          invoiceDate,
          dueDate,
          amount: parseFloat(amount),
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to create invoice");
      router.push("/receivables");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = !customerId || !invoiceNo || !invoiceDate || !dueDate || !amount || submitting;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link
          href="/receivables"
          aria-label="Back"
          className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900 truncate">New Invoice</h1>
      </div>

      {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Customer Dropdown */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-slate-700">Customer *</label>
            <button
              type="button"
              onClick={() => setShowNewCustomer(!showNewCustomer)}
              className="text-xs text-green-700 font-medium flex items-center gap-1 rounded-lg px-2 py-1 -mr-2 min-h-[44px] hover:bg-slate-100 focus-ring"
            >
              <Plus className="h-3 w-3" /> New Customer
            </button>
          </div>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="flex min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          >
            <option value="">Select customer...</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.phone ? ` (${c.phone})` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Inline New Customer Form */}
        {showNewCustomer && (
          <div className="border border-slate-200 bg-slate-50 rounded-xl p-3 space-y-2 shadow-sm">
            <p className="text-xs font-medium text-slate-700">Quick Add Customer</p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Customer Name *</label>
              <Input
                className="min-h-[44px]"
                placeholder="Customer name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <Input
                className="min-h-[44px] tabular-nums"
                type="tel"
                inputMode="tel"
                placeholder="Phone (optional)"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleCreateCustomer}
                disabled={!newName.trim() || creatingCustomer}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {creatingCustomer ? "Creating..." : "Add"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowNewCustomer(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Invoice No */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Invoice No *</label>
          <Input
            className="min-h-[44px] tabular-nums"
            placeholder="INV-001"
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
          />
        </div>

        {/* Invoice Date */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Invoice Date *</label>
          <Input className="min-h-[44px]" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </div>

        {/* Due Date */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Due Date *</label>
          <Input className="min-h-[44px]" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Amount *</label>
          <Input
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0.01"
            step="0.01"
            className="min-h-[44px] text-lg tabular-nums"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
          <textarea
            placeholder="Any notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="flex min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
        </div>

        <div className="space-y-1">
          <Button
            type="submit"
            size="lg"
            disabled={disabled}
            className="w-full min-h-[48px] bg-green-600 hover:bg-green-700 text-white"
          >
            {submitting ? "Creating..." : "Create Invoice"}
          </Button>
          {!customerId || !invoiceNo || !invoiceDate || !dueDate || !amount ? (
            <p className="text-xs text-slate-500 text-center">Customer, invoice no, dates and amount are required.</p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
