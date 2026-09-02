"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, Phone, MessageCircle, Users, MapPin, Plus, Pencil, IndianRupee } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { DesktopTable, type Column } from "@/components/desktop-table";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetchEnvelope } from "@/lib/api-client";
import { formatINR } from "@/lib/utils";
import { createLogger } from "@/lib/logger";
import { CustomerFormSheet, type CustomerDraft } from "./_components/customer-form-sheet";

const log = createLogger("customers");

interface CustomerRow {
  id: string;
  name: string;
  /** `@unique` on the model — this is the customer's identity, shared by the counter and the
   *  workshop. Never optional. */
  phone: string;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  type: string;
  isActive: boolean;
  createdAt: string;
  /** SUM(amount - paidAmount) over unpaid invoices. Computed server-side in one groupBy. */
  outstanding: number;
  _count: { invoices: number; payments: number };
}

const TYPES = [
  { key: "", label: "All" },
  { key: "WALK_IN", label: "Walk-in" },
  { key: "REGULAR", label: "Regular" },
  { key: "DEALER", label: "Dealer" },
];

const PAGE_SIZE = 50;

const typeLabel = (t: string) => t.replace("_", "-").toLowerCase();
const badgeVariant = (t: string) =>
  t === "DEALER" ? "info" : t === "REGULAR" ? "success" : "default";

/**
 * The customer master, and the way in to a customer's receivables.
 *
 * ─── WHY THIS IS THE LANDING SCREEN NOW ──────────────────────────────────────────────────
 *
 * The `customers` module pointed at /receivables for as long as it existed, with this list
 * hanging off it as a CHILD module — collapsed behind a chevron in the sidebar and filtered
 * out of the phone's tab bar entirely, which made the plainest screen in the app the hardest
 * one to find. The module owns /customers directly now and the child is gone.
 *
 * /receivables still exists and still holds the aging buckets and the Zoho invoice import;
 * it simply is not how you arrive any more. Receivables are a view OF a customer, so they
 * are reached per row, at /customers/[id]/receivables.
 *
 * ─── A LIST, NOT A GRID ──────────────────────────────────────────────────────────────────
 *
 * The useful thing here is comparing one number down a column — what each customer owes —
 * so a table on desktop and stacked cards on a phone, never tiles.
 */
export default function CustomersPage() {
  const { canCreate, canEdit } = usePermissions();
  // The PARENT module's grants. There is no separate permission for the list: `customers`
  // is one module with one answer to "who may add a customer". Cosmetic either way — POST
  // and PUT re-check server-side, as CLAUDE.md requires.
  const mayCreate = canCreate("customers");
  const mayEdit = canEdit("customers");

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerDraft | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    // Search runs server-side: with thousands of customers, filtering a single page in the
    // browser would search only what happens to be loaded and quietly miss the rest.
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (type) params.set("type", type);

    try {
      // apiFetchEnvelope, not apiFetch: the row count lives in `pagination`, which sits
      // OUTSIDE `data` and apiFetch discards. Never a raw fetch().then(r => r.json()) —
      // an expired session answers 307 -> /login -> HTML with status 200, which `res.ok`
      // does not catch (CLAUDE.md).
      const { data, pagination } = await apiFetchEnvelope<CustomerRow[]>(
        `/api/customers?${params}`
      );
      setRows(data);
      setTotal(pagination?.total ?? data.length);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load customers";
      setError(msg);
      log.error("failed to load customers", { message: msg });
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, type, page]);

  useEffect(() => { load(); }, [load]);
  // Any filter change invalidates the current page number.
  useEffect(() => { setPage(1); }, [debouncedSearch, type]);

  function openCreate() {
    setEditing(null);
    setSheetOpen(true);
  }

  function openEdit(c: CustomerRow) {
    setEditing({
      id: c.id, name: c.name, phone: c.phone,
      whatsapp: c.whatsapp, email: c.email, address: c.address, type: c.type,
    });
    setSheetOpen(true);
  }

  function handleSaved(message: string) {
    setFlash(message);
    load();
  }

  /**
   * Outstanding, coloured by what it means. A negative balance is an OVERPAYMENT, not a
   * rounding artefact — the customer is in credit and the accounting rule is to issue a
   * credit note — so it is called out in green rather than shown as a red debt or hidden
   * behind a zero. Nought is muted because "nothing owed" is an answer and blank is not.
   */
  function Outstanding({ value }: { value: number }) {
    const tone =
      value > 0 ? "text-red-600" : value < 0 ? "text-green-600" : "text-slate-300";
    return (
      <span className={`font-bold tabular-nums ${tone}`}>
        {value < 0 ? `${formatINR(Math.abs(value))} cr` : formatINR(value)}
      </span>
    );
  }

  /** Edit + receivables, shared by the table and the cards so they cannot drift apart. */
  function RowActions({ c }: { c: CustomerRow }) {
    return (
      <div className="flex items-center gap-1 justify-end">
        {mayEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); openEdit(c); }}
            aria-label={`Edit ${c.name}`}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors focus-ring"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        <Link
          href={`/customers/${c.id}/receivables`}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Receivables for ${c.name}`}
          title="Receivables"
          className="h-9 px-2.5 flex items-center gap-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors focus-ring"
        >
          <IndianRupee className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Receivables</span>
        </Link>
      </div>
    );
  }

  const columns: Column<CustomerRow>[] = [
    {
      header: "Customer",
      cell: (c) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-slate-900">{c.name}</span>
            <Badge variant={badgeVariant(c.type)} className="text-[10px]">{typeLabel(c.type)}</Badge>
            {!c.isActive && <Badge variant="default" className="text-[10px]">Inactive</Badge>}
          </div>
          {c.address && (
            <p className="text-[11px] text-slate-400 truncate max-w-[22rem]">{c.address}</p>
          )}
        </div>
      ),
    },
    {
      header: "Phone",
      className: "tabular-nums",
      cell: (c) => (
        <div>
          <a
            href={`tel:${c.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="text-slate-700 hover:text-slate-900 focus-ring rounded"
          >
            {c.phone}
          </a>
          {c.whatsapp && c.whatsapp !== c.phone && (
            <p className="text-[11px] text-slate-400">wa {c.whatsapp}</p>
          )}
        </div>
      ),
    },
    {
      header: "Email",
      className: "hidden xl:table-cell text-slate-500",
      cell: (c) => <span className="truncate block max-w-[14rem]">{c.email || "—"}</span>,
    },
    {
      header: "Invoices",
      className: "text-right tabular-nums text-slate-500",
      cell: (c) => c._count.invoices,
    },
    {
      header: "Outstanding",
      className: "text-right",
      cell: (c) => <Outstanding value={c.outstanding} />,
    },
    {
      header: "",
      className: "w-[13rem]",
      cell: (c) => <RowActions c={c} />,
    },
  ];

  const emptyText = search || type ? "No customers match that." : "No customers yet.";

  return (
    // No wrapper of its own. (dashboard)/layout.tsx already applies the page padding and
    // max width; adding `p-4 pb-24 max-w-2xl mx-auto` here double-padded the screen and
    // pinned it to a phone-width column on a monitor.
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-5 w-5 text-slate-700" />
            <h1 className="text-lg font-bold text-slate-900">Customers</h1>
          </div>
          <p className="text-[11px] text-slate-500 ml-7 tabular-nums">
            {loading ? "…" : `${total.toLocaleString("en-IN")} customer${total === 1 ? "" : "s"}`}
          </p>
        </div>

        {mayCreate && (
          <Button onClick={openCreate} className="min-h-[44px] shrink-0">
            <Plus className="h-4 w-4" />
            <span className="ml-1">Add</span>
          </Button>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} onDismiss={() => setError(null)} />}

      {flash && (
        <div className="mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 flex items-center justify-between gap-3">
          <p className="text-xs text-green-800">{flash}</p>
          <button
            onClick={() => setFlash(null)}
            className="text-[11px] font-medium text-green-700 hover:text-green-900 focus-ring rounded"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone"
          className="pl-9"
        />
      </div>

      <div className="flex gap-1.5 mb-3 flex-wrap">
        {TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            className={`min-h-[36px] px-3 rounded-full text-xs font-medium transition-colors focus-ring ${
              type === t.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <div className="text-center py-12">
          <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">{emptyText}</p>
          {mayCreate && !search && !type && (
            <Button onClick={openCreate} className="mt-3 min-h-[44px]">
              <Plus className="h-4 w-4" />
              <span className="ml-1">Add the first customer</span>
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop: a dense table, because the point of the screen is scanning one column
              of numbers. Mobile keeps the cards below. Same pattern as /vendors. */}
          <DesktopTable
            className="hidden lg:block"
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            emptyText={emptyText}
          />

          <div className="space-y-1.5 lg:hidden">
            {rows.map((c) => (
              <Card key={c.id} className={c.isActive ? "" : "opacity-60"}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-slate-900 break-words">{c.name}</p>
                        <Badge variant={badgeVariant(c.type)} className="text-[10px]">
                          {typeLabel(c.type)}
                        </Badge>
                        {!c.isActive && <Badge variant="default" className="text-[10px]">Inactive</Badge>}
                      </div>

                      {/* Phone is the identity — @unique on the model, and the row both the
                          counter and the workshop resolve to. tel: so it dials from a phone. */}
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <a
                          href={`tel:${c.phone}`}
                          className="flex items-center gap-1 text-xs text-slate-600 tabular-nums hover:text-slate-900 focus-ring rounded"
                        >
                          <Phone className="h-3 w-3" />{c.phone}
                        </a>
                        {c.whatsapp && c.whatsapp !== c.phone && (
                          <span className="flex items-center gap-1 text-xs text-slate-400 tabular-nums">
                            <MessageCircle className="h-3 w-3" />{c.whatsapp}
                          </span>
                        )}
                        {c.email && <span className="text-xs text-slate-400 truncate">{c.email}</span>}
                      </div>

                      {c.address && (
                        <p className="text-[11px] text-slate-400 mt-0.5 flex items-start gap-1">
                          <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                          <span className="line-clamp-1">{c.address}</span>
                        </p>
                      )}

                      <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                        {c._count.invoices} invoice{c._count.invoices === 1 ? "" : "s"}
                        {" · "}
                        {c._count.payments} payment{c._count.payments === 1 ? "" : "s"}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-sm"><Outstanding value={c.outstanding} /></p>
                      <p className="text-[10px] text-slate-400">outstanding</p>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <RowActions c={c} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {!loading && total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="min-h-[40px] px-3 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 disabled:opacity-40 focus-ring"
          >
            Previous
          </button>
          <span className="text-[11px] text-slate-500 tabular-nums">
            Page {page} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(total / PAGE_SIZE)}
            className="min-h-[40px] px-3 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 disabled:opacity-40 focus-ring"
          >
            Next
          </button>
        </div>
      )}

      <CustomerFormSheet
        open={sheetOpen}
        editing={editing}
        onClose={() => setSheetOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
}
