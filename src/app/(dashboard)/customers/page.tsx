"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Search, Phone, MessageCircle, Users, MapPin, Pencil, IndianRupee,
  Contact, CloudUpload, Loader2, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { DesktopTable, type Column } from "@/components/desktop-table";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetchEnvelope, apiTry } from "@/lib/api-client";
import { formatINR } from "@/lib/utils";
import { createLogger } from "@/lib/logger";
import { CustomerEditSheet, type CustomerDraft } from "./_components/customer-edit-sheet";

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
  /**
   * Google Contacts sync (plan 1709, R44, P14c). `googleContactId` is the People API
   * resourceName — its presence IS "synced". `googleSyncError` is the last failure; it survives
   * the toast so the reason is still readable next week.
   */
  googleContactId: string | null;
  googleSyncedAt: string | null;
  googleSyncError: string | null;
  _count: { invoices: number; payments: number };
}

interface SyncResultRow {
  customerId: string;
  name: string;
  outcome: "created" | "already" | "failed";
  reason?: string;
}

/** The Google filter chips. `notSynced` is the one that matters — it is what a sync run is for. */
const GOOGLE_FILTERS = [
  { key: "", label: "All" },
  { key: "notSynced", label: "Not in Google" },
  { key: "synced", label: "In Google" },
  { key: "failed", label: "Sync failed" },
];

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
  const { canEdit } = usePermissions();
  // Customers are no longer created by hand: a customer row appears when a Zoho invoice is
  // imported or a service job is opened, both of which resolve on `phone`. Only editing is
  // reachable from this screen. Cosmetic either way — PUT re-checks server-side.
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

  // ─── Google Contacts (plan 1709, R44, P14c) ───────────────────────────────────────────────
  // The button appears only when the shop's Google account is connected AND the user may edit a
  // customer. Both are cosmetic — the route re-checks `customers.edit` and the connection.
  const [google, setGoogle] = useState("");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResultRow[] | null>(null);

  useEffect(() => {
    if (!mayEdit) return;
    // apiTry, not fetch().json(): an expired session answers 307 -> /login -> HTML with status
    // 200, which raw .json() turns into "Unexpected token '<'" (CLAUDE.md).
    void apiTry<{ connected: boolean }>("/api/customers/google-sync").then((res) => {
      if (res.error) {
        // Not fatal — the screen simply does not offer the button.
        log.warn("google connection unknown", { status: res.status });
        return;
      }
      setGoogleConnected(!!res.data?.connected);
    });
  }, [mayEdit]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (google) params.set("google", google);
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
  }, [debouncedSearch, type, page, google]);

  useEffect(() => { load(); }, [load]);
  // Any filter change invalidates the current page number.
  useEffect(() => { setPage(1); }, [debouncedSearch, type, google]);
  // …and any reload invalidates the selection: ticked ids that are no longer on screen would
  // otherwise be synced invisibly.
  useEffect(() => { setSelected(new Set()); }, [debouncedSearch, type, google, page]);

  const notSyncedIds = useMemo(
    () => rows.filter((r) => !r.googleContactId).map((r) => r.id),
    [rows]
  );

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Sync the ticked customers (P14b, P14c). Scoped to what is ON SCREEN on purpose: "select all"
   * across thousands of unseen rows is a decision nobody made, and the route caps a call at 200
   * anyway. Filter to "Not in Google" and page through to cover the whole book.
   */
  async function syncToGoogle() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setSyncing(true);
    setSyncResults(null);
    const res = await apiTry<{ created: number; already: number; failed: number; results: SyncResultRow[] }>(
      "/api/customers/google-sync",
      { method: "POST", json: { customerIds: ids } }
    );
    setSyncing(false);
    if (res.error || !res.data) {
      log.warn("google sync failed", { status: res.status, count: ids.length });
      setError(res.error || "Google sync failed");
      return;
    }
    const { created, already, failed, results } = res.data;
    log.info("google sync finished", { requested: ids.length, created, already, failed });
    setSyncResults(results.filter((r) => r.outcome === "failed"));
    setFlash(
      `Google: ${created} added, ${already} already there${failed > 0 ? `, ${failed} failed` : ""}.`
    );
    setSelected(new Set());
    load();
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

  /**
   * Google state in one cell (P14c): in Google, not in Google, or failed with the reason. The
   * reason is the `title`, so a long People API message does not wreck the column width but is
   * still one hover away — and it is stored on the row, not only in a toast.
   */
  function GoogleCell({ c }: { c: CustomerRow }) {
    if (c.googleContactId) {
      return (
        <span
          className="inline-flex items-center gap-1 text-xs text-green-700"
          title={c.googleSyncedAt ? `Synced ${new Date(c.googleSyncedAt).toLocaleString("en-IN")}` : "In Google"}
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> In Google
        </span>
      );
    }
    if (c.googleSyncError) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-red-600" title={c.googleSyncError}>
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="truncate max-w-[10rem]">Failed</span>
        </span>
      );
    }
    return <span className="text-xs text-slate-400">Not in Google</span>;
  }

  /** The row tick, on the table and the cards. Hidden entirely when Google is not connected. */
  function RowTick({ c }: { c: CustomerRow }) {
    if (!showGoogle) return null;
    return (
      <input
        type="checkbox"
        checked={selected.has(c.id)}
        onChange={() => toggleOne(c.id)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${c.name}`}
        className="h-4 w-4 rounded border-slate-300 accent-slate-900 focus-ring"
      />
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

  // The Google column, the ticks and the Sync button all hang off this one condition.
  const showGoogle = mayEdit && googleConnected;

  const columns: Column<CustomerRow>[] = [
    ...(showGoogle
      ? [
          {
            header: "",
            className: "w-8",
            cell: (c: CustomerRow) => <RowTick c={c} />,
          } satisfies Column<CustomerRow>,
        ]
      : []),
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
    ...(showGoogle
      ? [
          {
            header: "Google",
            className: "hidden xl:table-cell",
            cell: (c: CustomerRow) => <GoogleCell c={c} />,
          } satisfies Column<CustomerRow>,
        ]
      : []),
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

  const emptyText = search || type
    ? "No customers match that."
    : "No customers yet. Customers are created when a Zoho invoice is imported or a service job is opened.";

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

      <div className="flex gap-1.5 mb-2 flex-wrap">
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

      {/* Google Contacts (plan 1709, R44, P14c). Filtering to "Not in Google" and paging through
          is how the whole book is covered — the sync itself is capped at 200 a call. */}
      {showGoogle && (
        <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Contact className="h-4 w-4 text-slate-500 shrink-0" />
            {GOOGLE_FILTERS.map((g) => (
              <button
                key={g.key}
                onClick={() => setGoogle(g.key)}
                className={`min-h-[32px] px-2.5 rounded-full text-[11px] font-medium transition-colors focus-ring ${
                  google === g.key ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setSelected(new Set(notSyncedIds))}
              disabled={notSyncedIds.length === 0}
              className="min-h-[36px] px-3 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 disabled:opacity-40 focus-ring"
            >
              Select all not synced ({notSyncedIds.length})
            </button>
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="min-h-[36px] px-3 rounded-lg text-xs font-medium text-slate-500 focus-ring"
              >
                Clear
              </button>
            )}
            <button
              onClick={syncToGoogle}
              disabled={syncing || selected.size === 0}
              className="min-h-[36px] px-3 rounded-lg text-xs font-semibold bg-slate-900 text-white flex items-center gap-1.5 disabled:opacity-40 focus-ring"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
              {syncing ? "Syncing…" : `Sync to Google (${selected.size})`}
            </button>
            <span className="text-[11px] text-slate-500">
              Saves into the shop&apos;s Google account, so every signed-in phone sees them.
            </span>
          </div>

          {syncResults && syncResults.length > 0 && (
            <ul className="space-y-1">
              {syncResults.map((r) => (
                <li key={r.customerId} className="text-[11px] text-red-700 bg-white border border-red-200 rounded-md px-2 py-1">
                  <span className="font-medium">{r.name}</span>: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <div className="text-center py-12">
          <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">{emptyText}</p>
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
                    {showGoogle && (
                      <div className="pt-1 shrink-0">
                        <RowTick c={c} />
                      </div>
                    )}
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

                      {showGoogle && (
                        <p className="mt-1">
                          <GoogleCell c={c} />
                        </p>
                      )}
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

      {editing && (
        <CustomerEditSheet
          open={sheetOpen}
          editing={editing}
          onClose={() => setSheetOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
