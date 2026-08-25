"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Search, ChevronRight, IndianRupee } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ExportButtons } from "@/components/export-buttons";
import { exportToExcel, exportToPDF, type ExportColumn } from "@/lib/export";
import { useDebounce } from "@/lib/utils";

interface LedgerEntry {
  id: string;
  date: string;
  type: "BILL" | "PAYMENT";
  description: string;
  debit: number;
  credit: number;
  reference: string;
  balance: number;
  status?: string;
}

interface VendorLedger {
  vendor: { id: string; name: string; code: string };
  openingBalance: number;
  totalBills: number;
  totalPayments: number;
  currentBalance: number;
  entries: LedgerEntry[];
  totalEntries: number;
}

interface VendorItem {
  id: string;
  name: string;
  code: string;
  openingBalance: number;
  _outstanding: number;
}

const LEDGER_COLUMNS: ExportColumn[] = [
  { header: "Date", key: "date", format: (v) => new Date(String(v)).toLocaleDateString("en-IN") },
  { header: "Type", key: "type" },
  { header: "Description", key: "description" },
  { header: "Debit (Bill)", key: "debit", format: (v) => Number(v) > 0 ? `₹${Number(v).toLocaleString("en-IN")}` : "" },
  { header: "Credit (Payment)", key: "credit", format: (v) => Number(v) > 0 ? `₹${Number(v).toLocaleString("en-IN")}` : "" },
  { header: "Balance", key: "balance", format: (v) => `₹${Number(v).toLocaleString("en-IN")}` },
  { header: "Reference", key: "reference" },
];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default function VendorLedgerPage() {
  const [vendors, setVendors] = useState<VendorItem[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [ledger, setLedger] = useState<VendorLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);

  // Fetch vendor list
  useEffect(() => {
    fetch("/api/vendors?limit=200")
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setVendors(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Fetch ledger when vendor selected
  useEffect(() => {
    if (!selectedVendor) { setLedger(null); return; }
    setLedgerLoading(true);
    fetch(`/api/vendors/${selectedVendor}/ledger`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setLedger(res.data); })
      .catch(() => {})
      .finally(() => setLedgerLoading(false));
  }, [selectedVendor]);

  const filteredVendors = vendors.filter((v) =>
    !debouncedSearch || v.name.toLowerCase().includes(debouncedSearch.toLowerCase()) || v.code.toLowerCase().includes(debouncedSearch.toLowerCase())
  );

  // Vendor selection view
  if (!selectedVendor) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Link href="/accounts" className="p-1"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
          <h1 className="text-lg font-bold text-slate-900">Vendor Ledger</h1>
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input placeholder="Search vendor..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-1">
            {filteredVendors.map((v) => (
              <button key={v.id} onClick={() => setSelectedVendor(v.id)} className="w-full text-left">
                <Card className="hover:border-slate-300 transition-colors mb-1">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-slate-400" />
                      <div>
                        <p className="text-sm font-medium text-slate-900">{v.name}</p>
                        <p className="text-[10px] text-slate-500">{v.code}</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Ledger view
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setSelectedVendor("")} className="p-1">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900">{ledger?.vendor.name || "Ledger"}</h1>
          <p className="text-xs text-slate-500">{ledger?.vendor.code}</p>
        </div>
        {ledger && (
          <ExportButtons
            onExcel={() => exportToExcel(
              [{ date: "2026-04-01", type: "OPENING", description: "Opening Balance", debit: ledger.openingBalance, credit: 0, balance: ledger.openingBalance, reference: "FY 2026-27" }, ...ledger.entries] as unknown as Record<string, unknown>[],
              LEDGER_COLUMNS, `ledger-${ledger.vendor.code}`
            )}
            onPDF={() => exportToPDF(
              `Vendor Ledger: ${ledger.vendor.name}`,
              [{ date: "2026-04-01", type: "OPENING", description: "Opening Balance", debit: ledger.openingBalance, credit: 0, balance: ledger.openingBalance, reference: "FY 2026-27" }, ...ledger.entries] as unknown as Record<string, unknown>[],
              LEDGER_COLUMNS, `ledger-${ledger.vendor.code}`
            )}
          />
        )}
      </div>

      {ledgerLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : ledger ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <Card className="bg-slate-50">
              <CardContent className="p-3">
                <p className="text-[10px] text-slate-500">Opening Bal (Apr 1)</p>
                <p className="text-sm font-bold text-slate-700">{formatCurrency(ledger.openingBalance)}</p>
              </CardContent>
            </Card>
            <Card className={ledger.currentBalance > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}>
              <CardContent className="p-3">
                <p className="text-[10px] text-slate-500">Current Balance</p>
                <p className={`text-sm font-bold ${ledger.currentBalance > 0 ? "text-red-700" : "text-green-700"}`}>
                  {formatCurrency(ledger.currentBalance)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-[10px] text-slate-500">Total Bills</p>
                <p className="text-sm font-bold text-red-600">{formatCurrency(ledger.totalBills)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-[10px] text-slate-500">Total Paid</p>
                <p className="text-sm font-bold text-green-600">{formatCurrency(ledger.totalPayments)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Ledger Table */}
          <div className="border rounded-lg overflow-hidden">
            {/* Opening balance row */}
            <div className="flex items-center px-3 py-2 bg-slate-100 text-[11px]">
              <span className="w-16 text-slate-500">Apr 1</span>
              <span className="flex-1 font-medium text-slate-700">Opening Balance</span>
              <span className="w-20 text-right font-bold text-slate-700">{formatCurrency(ledger.openingBalance)}</span>
            </div>

            {ledger.entries.map((entry) => (
              <div key={entry.id} className={`flex items-center px-3 py-2.5 border-t text-[11px] ${entry.type === "PAYMENT" ? "bg-green-50/30" : ""}`}>
                <span className="w-16 text-slate-500 shrink-0">
                  {new Date(entry.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                </span>
                <div className="flex-1 min-w-0 mr-2">
                  <p className="text-slate-700 truncate">{entry.description}</p>
                  <p className="text-[9px] text-slate-400">{entry.reference}</p>
                </div>
                {entry.type === "BILL" ? (
                  <span className="w-20 text-right text-red-600 font-medium shrink-0">+{formatCurrency(entry.debit)}</span>
                ) : (
                  <span className="w-20 text-right text-green-600 font-medium shrink-0">-{formatCurrency(entry.credit)}</span>
                )}
                <span className="w-20 text-right font-bold text-slate-700 shrink-0 ml-1">{formatCurrency(entry.balance)}</span>
              </div>
            ))}

            {ledger.entries.length === 0 && (
              <div className="text-center py-8">
                <IndianRupee className="h-6 w-6 text-slate-300 mx-auto mb-1" />
                <p className="text-xs text-slate-400">No transactions yet</p>
              </div>
            )}
          </div>

          {ledger.totalEntries > 20 && (
            <p className="text-[10px] text-slate-400 text-center mt-2">
              Showing latest 20 of {ledger.totalEntries} transactions
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
