"use client";

import { Paperclip, Receipt, Store, Trash2 } from "lucide-react";
import { DesktopTable } from "@/components/desktop-table";
import {
  CATEGORY_COLORS,
  categoryLabel,
  formatCurrency,
  isTypedPayer,
  payerName,
  type ExpenseRow,
} from "./types";

/** A paperclip that opens the receipt photo; nothing when the row has none. */
function ReceiptLink({ url, className = "" }: { url?: string | null; className?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label="View receipt photo"
      title="View receipt photo"
      className={`inline-flex items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 ${className}`}
    >
      <Paperclip className="h-4 w-4" />
    </a>
  );
}

function CategoryChip({ row }: { row: ExpenseRow }) {
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[row.category] || "bg-slate-100 text-slate-700"}`}>
      {categoryLabel(row.category)}
    </span>
  );
}

/** The store the money belongs to. "No store" only on rows saved before expenses carried one. */
function StoreChip({ row }: { row: ExpenseRow }) {
  if (!row.store) {
    return (
      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-dashed border-slate-300 text-slate-400">
        No store
      </span>
    );
  }
  return (
    <span
      title={row.store.code}
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-700"
    >
      <Store className="h-3 w-3 text-slate-400" aria-hidden />
      {row.store.name}
    </span>
  );
}

/** Who paid: a staff member's current name, or the typed name marked "not staff". */
function Payer({ row }: { row: ExpenseRow }) {
  return (
    <>
      {payerName(row)}
      {isTypedPayer(row) && <span className="ml-1 text-[10px] font-normal text-slate-400">(not staff)</span>}
    </>
  );
}

function DeleteButton({ row, onDelete, className = "" }: { row: ExpenseRow; onDelete: (row: ExpenseRow) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onDelete(row);
      }}
      aria-label={`Delete the ${categoryLabel(row.category)} expense of ${formatCurrency(row.amount, 2)}`}
      title="Delete expense"
      className={`inline-flex items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 ${className}`}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

interface ExpenseListProps {
  rows: ExpenseRow[];
  /** Expenses › Delete. Cosmetic — the API re-checks. */
  mayDelete: boolean;
  onDelete: (row: ExpenseRow) => void;
  emptyText: string;
}

export function ExpenseList({ rows, mayDelete, onDelete, emptyText }: ExpenseListProps) {
  const describe = (row: ExpenseRow) => row.description || categoryLabel(row.category);
  const day = (row: ExpenseRow) => new Date(row.date).toLocaleDateString("en-IN");

  return (
    <>
      <DesktopTable
        className="hidden lg:block"
        rows={rows}
        rowKey={(exp) => exp.id}
        emptyText={emptyText}
        columns={[
          { header: "Description", cell: (exp) => <span className="font-medium text-slate-900">{describe(exp)}</span> },
          { header: "Date", cell: day, className: "whitespace-nowrap text-slate-500" },
          { header: "Store", cell: (exp) => <StoreChip row={exp} />, className: "whitespace-nowrap" },
          { header: "Paid By", cell: (exp) => <Payer row={exp} /> },
          { header: "Mode", cell: (exp) => <span className="text-slate-500">{exp.paymentMode}</span> },
          { header: "Category", cell: (exp) => <CategoryChip row={exp} />, className: "whitespace-nowrap" },
          { header: "Receipt", cell: (exp) => <ReceiptLink url={exp.receiptUrl} className="h-8 w-8" />, className: "text-center" },
          { header: "Amount", cell: (exp) => <span className="font-semibold text-slate-900 tabular-nums">{formatCurrency(exp.amount)}</span>, className: "text-right whitespace-nowrap" },
          ...(mayDelete
            ? [{ header: "", cell: (exp: ExpenseRow) => <DeleteButton row={exp} onDelete={onDelete} className="h-8 w-8" />, className: "w-10 text-center" }]
            : []),
        ]}
      />

      <div className="space-y-2 lg:hidden">
        {rows.map((exp) => (
          <div key={exp.id} className="block rounded-xl border border-slate-200 border-l-4 border-l-slate-200 bg-white shadow-sm">
            <div className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 truncate">{describe(exp)}</p>
                  <p className="text-xs text-slate-500 tabular-nums mt-0.5 truncate">
                    {day(exp)} · <Payer row={exp} /> · {exp.paymentMode}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <CategoryChip row={exp} />
                    <StoreChip row={exp} />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <p className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(exp.amount)}</p>
                  <div className="flex items-center -mr-2 -mb-2">
                    <ReceiptLink url={exp.receiptUrl} className="h-11 w-11" />
                    {mayDelete && <DeleteButton row={exp} onDelete={onDelete} className="h-11 w-11" />}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}

        {rows.length === 0 && (
          <div className="text-center py-12">
            <Receipt className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-400">{emptyText}</p>
          </div>
        )}
      </div>
    </>
  );
}
