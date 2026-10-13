"use client";

// The Bills tab's list on /bills: a DesktopTable from 1024 px, cards below it, and the totals.
//
// Plan 1210 credit notes and payables (Q5 = a, X5): every row shows the bill's STORED due date
// and is OVERDUE from it. It used to recompute bill date + the vendor's current payment terms,
// so a row could say OVERDUE while the aging cards counted it as not due. Each row also carries
// its store chip (Part 2.4).

import Link from "next/link";
import { AlertTriangle, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DesktopTable } from "@/components/desktop-table";
import { StoreChip, formatCurrency, formatDay, overdueInfo, type BillStore } from "./shared";

export interface BillItem {
  id: string;
  billNo: string;
  amount: number;
  paidAmount: number;
  status: string;
  dueDate: string;
  billDate: string;
  vendorId: string;
  vendor: { name: string; code: string; paymentTermDays?: number };
  store: BillStore;
}

function StatusBadge({ bill, isOverdue, className }: { bill: BillItem; isOverdue: boolean; className?: string }) {
  const variant =
    bill.status === "PAID" ? "success" : isOverdue || bill.status === "OVERDUE" ? "danger" : bill.status === "DISPUTED" ? "default" : "warning";
  return (
    <Badge variant={variant} className={className}>
      {isOverdue ? "OVERDUE" : bill.status.replace(/_/g, " ")}
    </Badge>
  );
}

export function BillList({ bills }: { bills: BillItem[] }) {
  return (
    <>
      <DesktopTable
        className="hidden lg:block"
        rows={bills}
        rowKey={(bill) => bill.id}
        rowHref={(bill) => `/bills/${bill.id}`}
        emptyText="No bills found"
        columns={[
          {
            header: "Vendor",
            cell: (bill) => {
              const { isOverdue } = overdueInfo(bill);
              return (
                <div className="flex items-center gap-1.5">
                  {isOverdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                  <span className="font-medium text-slate-900">{bill.vendor.name}</span>
                </div>
              );
            },
          },
          { header: "Bill No", cell: (bill) => <span className="text-slate-500">{bill.billNo}</span> },
          { header: "Store", cell: (bill) => <StoreChip store={bill.store} /> },
          { header: "Due", cell: (bill) => formatDay(bill.dueDate), className: "whitespace-nowrap text-slate-500" },
          { header: "Amount", cell: (bill) => <span className="tabular-nums">{formatCurrency(bill.amount)}</span>, className: "text-right whitespace-nowrap" },
          { header: "Paid", cell: (bill) => <span className="tabular-nums text-green-600">{formatCurrency(bill.paidAmount)}</span>, className: "text-right whitespace-nowrap" },
          {
            header: "Balance",
            cell: (bill) => {
              const r = bill.amount - bill.paidAmount;
              return <span className={`tabular-nums font-semibold ${r > 0 ? "text-red-600" : "text-green-600"}`}>{formatCurrency(r)}</span>;
            },
            className: "text-right whitespace-nowrap",
          },
          {
            header: "Status",
            cell: (bill) => {
              const { isOverdue, daysPastDue } = overdueInfo(bill);
              return (
                <div className="whitespace-nowrap">
                  <StatusBadge bill={bill} isOverdue={isOverdue} className="text-[10px]" />
                  {isOverdue && <p className="mt-0.5 text-[11px] font-medium text-red-600 tabular-nums">{daysPastDue}d past due</p>}
                </div>
              );
            },
          },
        ]}
      />
      <div className="space-y-2 lg:hidden">
        {bills.map((bill) => {
          const { isOverdue, daysPastDue } = overdueInfo(bill);
          const remaining = bill.amount - bill.paidAmount;
          const accent = isOverdue
            ? "border-l-red-500"
            : bill.status === "PAID"
              ? "border-l-green-500"
              : bill.status === "PARTIALLY_PAID" || bill.status === "PENDING"
                ? "border-l-amber-400"
                : "border-l-slate-200";
          return (
            <Link
              key={bill.id}
              href={`/bills/${bill.id}`}
              className={`block rounded-xl border border-slate-200 border-l-4 ${accent} bg-white shadow-sm transition-colors active:bg-slate-50 focus-ring`}
            >
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {isOverdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                      <p className="text-sm font-semibold text-slate-900 truncate">{bill.vendor.name}</p>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <StoreChip store={bill.store} />
                      <p className="text-xs text-slate-500 tabular-nums truncate">
                        {bill.billNo} · Due {formatDay(bill.dueDate)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-bold tabular-nums ${remaining > 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatCurrency(remaining)}
                    </p>
                    <StatusBadge bill={bill} isOverdue={isOverdue} className="mt-1" />
                  </div>
                </div>
                {isOverdue && <p className="mt-1.5 text-xs font-semibold text-red-600 tabular-nums">{daysPastDue}d overdue</p>}
                {bill.paidAmount > 0 && remaining > 0 && (
                  <div className="mt-2">
                    <div className="w-full bg-slate-200 rounded-full h-1.5">
                      <div
                        className="bg-green-500 h-1.5 rounded-full"
                        style={{ width: `${Math.min(100, (bill.paidAmount / bill.amount) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                      Paid {formatCurrency(bill.paidAmount)} of {formatCurrency(bill.amount)}
                    </p>
                  </div>
                )}
              </div>
            </Link>
          );
        })}

        {bills.length === 0 && (
          <div className="text-center py-12">
            <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No bills found</p>
          </div>
        )}
      </div>

      {/* Totals — shown on all sizes */}
      {bills.length > 0 && (
        <Card className="bg-slate-50 mt-3">
          <CardContent className="p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 tabular-nums">
                {bills.length} bill{bills.length !== 1 ? "s" : ""}
              </span>
              <div className="flex gap-4">
                <div className="text-right">
                  <p className="text-[11px] text-slate-500">Total</p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(bills.reduce((s, b) => s + b.amount, 0))}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-500">Paid</p>
                  <p className="text-sm font-bold text-green-600 tabular-nums">{formatCurrency(bills.reduce((s, b) => s + b.paidAmount, 0))}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-500">Balance</p>
                  <p className="text-sm font-bold text-red-600 tabular-nums">
                    {formatCurrency(bills.reduce((s, b) => s + (b.amount - b.paidAmount), 0))}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
