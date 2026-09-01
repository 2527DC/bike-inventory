"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Phone, MessageCircle, Users, MapPin } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { apiFetchEnvelope } from "@/lib/api-client";
import { formatINR } from "@/lib/utils";
import { createLogger } from "@/lib/logger";

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

/**
 * The customer master.
 *
 * The `customers` module has been labelled "Customers & Receivables" and pointed at
 * /receivables since it existed — there was no screen that simply listed customers, even
 * though `GET /api/customers` was complete. This is that screen.
 *
 * A list rather than cards, because the useful thing here is comparing one number across
 * many rows: what each customer owes.
 */
export default function CustomersPage() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

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

  const badge = (t: string) =>
    t === "DEALER" ? "info" : t === "REGULAR" ? "success" : "default";

  return (
    <div className="p-4 pb-24 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Users className="h-5 w-5 text-slate-700" />
        <h1 className="text-lg font-bold text-slate-900">Customers</h1>
      </div>
      <p className="text-[11px] text-slate-500 mb-3 ml-7 tabular-nums">
        {loading ? "…" : `${total.toLocaleString("en-IN")} customer${total === 1 ? "" : "s"}`}
      </p>

      {error && <ErrorBanner message={error} onRetry={load} onDismiss={() => setError(null)} />}

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
          <p className="text-sm text-slate-500">
            {search || type ? "No customers match that." : "No customers yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((c) => (
            <Card key={c.id} className={c.isActive ? "" : "opacity-60"}>
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-slate-900 break-words">{c.name}</p>
                      <Badge variant={badge(c.type)} className="text-[10px]">
                        {c.type.replace("_", "-").toLowerCase()}
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

                  {/* Outstanding is the reason this is a list. Zero is muted rather than
                      hidden — "nothing owed" is an answer, and a blank space is not. */}
                  <div className="text-right shrink-0">
                    <p
                      className={`text-sm font-bold tabular-nums ${
                        c.outstanding > 0 ? "text-red-600" : "text-slate-300"
                      }`}
                    >
                      {formatINR(c.outstanding)}
                    </p>
                    <p className="text-[10px] text-slate-400">outstanding</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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
    </div>
  );
}
