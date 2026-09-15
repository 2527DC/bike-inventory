"use client";

import Link from "next/link";
import { Trash2, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * One line of a purchase order in the making (plan 0909-po-sheet-ai-extraction, §3.4, D2,
 * amended by plan 1509-po-product-and-quantity-only).
 *
 * A line is the item NAME and a quantity (editable) — nothing else. No price, no GST: a
 * purchase order carries no money (owner, 15 Sep 2026, R3–R4). A sheet line does not come
 * from the products table (R3): the sheet flow never sets `productId`. The one path that still
 * carries a product is the handoff from /reorder, whose lines are catalogue products by
 * definition; it fills `productId` so that order stays linked to what was low.
 */
export interface POLineItem {
  /** Stable React key and dedupe key — the extraction item id, or the product id from /reorder. */
  key: string;
  name: string;
  quantity: number;
  /** Only from the /reorder handoff. Never set by the sheet flow. */
  productId?: string;
}

/**
 * The 409 payload from the duplicate rule. `names` is what the sheet flow clashes on (a
 * normalised item name); `productIds` / `productNames` are the older product key, still
 * sent for lines that carry a product. Every list is optional so either server shape reads.
 */
export interface PoConflict {
  poId: string;
  poNumber: string;
  status: string;
  productIds?: string[];
  productNames?: string[];
  names?: string[];
}

export interface VendorOption {
  id: string;
  name: string;
  code: string;
}

export type SectionStatus = "idle" | "running" | "created" | "failed";

export interface Section {
  /** Stable key. The resolved vendor id, or "manual" for the hand-built section. */
  key: string;
  vendorId: string;
  /** null means the manual section, which renders a vendor picker instead of a name. */
  vendorName: string | null;
  /** "from the brand's primary vendor" etc. Null on the manual section. */
  sourceLabel: string | null;
  items: POLineItem[];
  status: SectionStatus;
  poId?: string;
  poNumber?: string;
  error: string | null;
  conflicts: PoConflict[] | null;
}

interface Props {
  section: Section;
  /** Only supplied for the manual section. */
  vendors?: VendorOption[];
  onVendorChange?: (vendorId: string) => void;
  onItemsChange: (items: POLineItem[]) => void;
  onSubmit: (submitForApproval: boolean) => void;
  onDismissConflicts: () => void;
  onRemoveConflictingLines: () => void;
  /** Hidden while a "Create all" run is in flight, so a person cannot start a second write. */
  busy: boolean;
  children?: React.ReactNode;
}

/**
 * One purchase order in the making: one vendor, its lines, its own outcome.
 *
 * ─── WHY THE SCREEN IS BUILT THIS WAY ────────────────────────────────────────────────────
 *
 * A purchase order goes to exactly one vendor, but a person selecting things to reorder does
 * not think in vendors — they tick what is low and expect the app to work out where each
 * thing comes from. So a selection routinely spans several vendors, and the honest response
 * is several purchase orders, not one order with the wrong supplier on it.
 *
 * Each section owns its own state because each one is a SEPARATE write that can fail on its
 * own: the duplicate rule can refuse vendor B while vendor A's order was created a moment
 * earlier. Nothing here rolls back, and it must not — a real purchase order exists at that
 * point. That is why "Create all" reports per vendor instead of returning one pass/fail, and
 * why this screen does NOT navigate away when it finishes.
 *
 * The vendor is READ-ONLY in a derived section, with a caption saying where it came from.
 * That is the point of R6: the vendor is a fact about the product, not a dropdown someone
 * picks and gets wrong. The manual section keeps the picker, because there is nothing to
 * derive from.
 */
export function VendorSection({
  section,
  vendors,
  onVendorChange,
  onItemsChange,
  onSubmit,
  onDismissConflicts,
  onRemoveConflictingLines,
  busy,
  children,
}: Props) {
  const { items } = section;

  const isManual = section.vendorName === null;
  const done = section.status === "created";
  const running = section.status === "running";
  const blocked = !section.vendorId || items.length === 0;

  const setQuantity = (index: number, quantity: number) =>
    onItemsChange(items.map((it, i) => (i === index ? { ...it, quantity } : it)));

  const remove = (index: number) => onItemsChange(items.filter((_, i) => i !== index));

  return (
    <Card className={done ? "border-green-300" : section.status === "failed" ? "border-red-200" : ""}>
      <CardContent className="p-3 space-y-3">
        {/* ─── who this order is for ───────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {isManual ? (
              <>
                <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="manual-vendor">
                  Vendor <span className="text-red-500">*</span>
                </label>
                <select
                  id="manual-vendor"
                  value={section.vendorId}
                  onChange={(e) => onVendorChange?.(e.target.value)}
                  disabled={done || running || busy}
                  className="flex h-10 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                >
                  <option value="">Select vendor...</option>
                  {(vendors ?? []).map((v) => (
                    <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-slate-900 truncate">{section.vendorName}</p>
                {/* The caption is the whole answer to "why this vendor?" — without it a
                    read-only field is just a field somebody cannot change. */}
                <p className="text-[11px] text-slate-400">{section.sourceLabel}</p>
              </>
            )}
          </div>
          <div className="shrink-0 text-right">
            {done && section.poNumber ? (
              <Link href={`/purchase-orders/${section.poId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
                <CheckCircle2 className="h-4 w-4" /> {section.poNumber}
              </Link>
            ) : (
              <span className="text-[11px] text-slate-400 tabular-nums">
                {items.length} item{items.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        {/* Created orders collapse: the lines are on the PO now, and leaving them editable
            would suggest an edit here still changes something. */}
        {done ? (
          <p className="text-xs text-slate-500">
            Created with {items.length} line{items.length === 1 ? "" : "s"}.
          </p>
        ) : (
          <>
            {children}

            {items.length > 0 && (
              <div className="space-y-2">
                {items.map((item, index) => (
                  <div key={item.key} className="rounded-lg border border-slate-200 p-2.5">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        {/* The name only — a sheet-built line has no SKU (D2). break-words, not
                            truncate: the vendor's item name is the whole identity of the line
                            and a clipped one cannot be checked against the sheet. */}
                        <p className="text-sm font-medium text-slate-900 break-words">{item.name}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        disabled={running || busy}
                        aria-label={`Remove ${item.name}`}
                        className="min-h-[44px] min-w-[44px] -m-2 flex items-center justify-center shrink-0 text-red-400 hover:text-red-600 disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {/* The quantity is the only thing to set on a line — no rate, no GST
                        (plan 1509-po-product-and-quantity-only, R3). */}
                    <div className="w-28">
                      <label className="block text-[11px] font-medium text-slate-600 mb-0.5" htmlFor={`qty-${item.key}`}>Qty</label>
                      <Input
                        id={`qty-${item.key}`}
                        type="number"
                        inputMode="numeric"
                        value={item.quantity}
                        onChange={(e) => setQuantity(index, parseInt(e.target.value) || 0)}
                        min="1"
                        disabled={running || busy}
                        className="text-sm min-h-[44px] tabular-nums"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* The duplicate refusal, per vendor. It names the existing order, links to it, and
                offers the one action that lets the rest of this vendor's lines through. */}
            {section.conflicts && section.conflicts.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <p className="text-xs font-semibold text-amber-900">Already on an open purchase order</p>
                <div className="mt-1.5 space-y-1.5">
                  {section.conflicts.map((c) => (
                    <div key={c.poId} className="text-[11px] text-amber-800">
                      <Link href={`/purchase-orders/${c.poId}`} className="font-semibold underline tabular-nums">
                        {c.poNumber}
                      </Link>
                      <span className="text-amber-600"> · {c.status.replace(/_/g, " ").toLowerCase()}</span>
                      <p className="mt-0.5 break-words">{(c.names ?? c.productNames ?? []).join(", ")}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    type="button"
                    onClick={onRemoveConflictingLines}
                    className="min-h-[44px] px-3 rounded-lg bg-amber-600 text-white text-xs font-medium"
                  >
                    Remove those lines and continue
                  </button>
                  <button
                    type="button"
                    onClick={onDismissConflicts}
                    className="min-h-[44px] px-3 rounded-lg border border-amber-300 text-amber-800 text-xs font-medium"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {section.error && !section.conflicts && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-words">{section.error}</span>
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                onClick={() => onSubmit(true)}
                disabled={blocked || running || busy}
                className="flex-1 min-h-[48px] bg-green-600 hover:bg-green-700 text-white"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit for approval"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onSubmit(false)}
                disabled={blocked || running || busy}
                className="flex-1 min-h-[48px]"
              >
                Save draft
              </Button>
            </div>

            {blocked && !running && (
              <p className="text-[11px] text-slate-500 text-center">
                {!section.vendorId ? "Select a vendor to continue" : "Add at least one item from a sheet to continue"}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default VendorSection;
