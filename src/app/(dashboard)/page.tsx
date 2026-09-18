"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Loader2, Share2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonDashboard } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { formatINR } from "@/lib/utils";
import { getStatusLabel } from "@/lib/status-colors";
import { usePermissions } from "@/lib/use-permissions";
import { apiTry, apiFetchEnvelope } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { MyStockAudits } from "./_components/my-stock-audits";
import { MyAssemblyTasks } from "./_components/my-assembly-tasks";
// "Today" on this screen is the STORE's today, not the browser's UTC one. toISOString() names
// yesterday for every one of these calls between midnight and 05:30 IST, which is when the
// morning shift is already working.
import { getTodayIST } from "@/lib/services/timezone";

const log = createLogger("dashboard:home");

/**
 * The ONE dashboard (plan 1709-priority-build-and-stock-flow, R35–R37, Q29).
 *
 * ─── WHAT THIS REPLACED ───────────────────────────────────────────────────────────────────
 *
 * Six hand-written variants — Admin, Supervisor, Inward clerk, Outward clerk, Purchase manager,
 * Accounts manager — chosen by a `pickDashboard()` ladder of permission tests. A role created in
 * the UI landed on whichever rung it first tripped, which was nobody's decision, and each variant
 * fetched its own endpoints, so two people could see different numbers for the same thing.
 *
 * Now there is one layout and one endpoint. `GET /api/dashboard/overview` returns only the
 * sections the viewer's grants allow, already ordered Money · Stuck · In progress · Done today ·
 * Stock by condition, and this page renders exactly what it is given. It decides nothing about
 * permissions — the API is the gate (CLAUDE.md: "frontend checks are cosmetic"). That is also why
 * a new role needs no code here: it gets the cards its grants carry, and nothing else.
 *
 * `MyStockAudits` and `MyAssemblyTasks` stay above the sections: what is assigned to YOU comes
 * before what is true of the shop.
 */

type Tone = "neutral" | "good" | "warn" | "bad";

interface OverviewCard {
  key: string;
  label: string;
  value: number;
  format: "inr" | "count" | "days";
  href: string;
  tone?: Tone;
  hint?: string;
}

interface OverviewSection {
  key: string;
  label: string;
  cards: OverviewCard[];
}

interface OverviewResponse {
  sections: OverviewSection[];
  stuckHours: { approvals: number; inbound: number; holds: number };
}

const TONE_CARD: Record<Tone, string> = {
  neutral: "border-slate-200",
  good: "border-green-200",
  warn: "border-amber-300 bg-amber-50",
  bad: "border-red-300 bg-red-50",
};

const TONE_VALUE: Record<Tone, string> = {
  neutral: "text-slate-900",
  good: "text-green-700",
  warn: "text-amber-700",
  bad: "text-red-700",
};

function cardValue(card: OverviewCard): string {
  if (card.format === "inr") return formatINR(card.value);
  if (card.format === "days") return card.value === 0 ? "—" : `${card.value} d`;
  return String(card.value);
}

/** A zero on a "stuck" card is good news, not an alarm — the API decides that, not the number. */
function OverviewTile({ card }: { card: OverviewCard }) {
  const tone: Tone = card.tone ?? "neutral";
  return (
    <Link href={card.href} className="focus-ring rounded-xl block">
      <Card className={`min-h-[44px] h-full ${TONE_CARD[tone]}`}>
        <CardContent className="p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            {card.label}
          </p>
          <p className={`mt-1 text-xl font-bold tabular-nums leading-none ${TONE_VALUE[tone]}`}>
            {cardValue(card)}
          </p>
          {card.hint && <p className="mt-1 text-[10px] text-slate-500">{card.hint}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}

// ─── Share buttons ───────────────────────────────────────────────────────────
// Kept from the old variants (they were on five of the six) rather than dropped with them: they
// are the only way the day's numbers leave the app. Both now go through `apiFetchEnvelope`
// instead of `fetch().then(r => r.json())` — CLAUDE.md forbids the raw form, because an expired
// session answers 307 → /login → 200 text/html and `.json()` then dies on "<" while `res.ok` is
// still true.

interface ActivityRow {
  category: string;
  action: string;
  detail: string;
  amount?: number;
  timestamp: string;
}

function ShareDailyReport() {
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const handleShare = async () => {
    setSharing(true);
    try {
      const today = getTodayIST();
      const { data, error } = await apiTry<{
        totalActions: number;
        activities: ActivityRow[];
        userSummary: Array<{ name: string; actions: number }>;
      }>(`/api/activity?date=${today}`);
      if (error || !data) {
        log.warn("daily report activity failed", { message: error });
        setShareError(error ?? "Failed to load activity data");
        return;
      }

      const { totalActions, activities, userSummary } = data;
      const dateStr = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

      if (totalActions === 0) {
        setShareError("No activities recorded today yet. Complete some tasks first, then share.");
        return;
      }

      let msg = `📋 *Daily Report — ${dateStr}*\n`;
      msg += `Total Actions: ${totalActions}\n\n`;

      const catCounts: Record<string, number> = {};
      for (const a of activities) {
        catCounts[a.category] = (catCounts[a.category] || 0) + 1;
      }
      // The last four arrived with the ActivityLog source (P5). Without them the report still
      // printed the line, but as a bullet and the raw key — "• MASTER_DATA: 3".
      const catEmoji: Record<string, string> = {
        DELIVERY: "🚚", STOCK: "📦", INBOUND: "📥", TRANSFER: "🔄", EXPENSE: "💰", PAYMENT: "💳", PO: "📝",
        AUDIT: "📋", ISSUE: "⚠️", ZOHO: "🔄", MASTER_DATA: "🏷️",
      };
      const catLabel: Record<string, string> = { MASTER_DATA: "MASTER DATA" };
      for (const [cat, count] of Object.entries(catCounts)) {
        msg += `${catEmoji[cat] || "•"} ${catLabel[cat] || cat}: ${count}\n`;
      }

      if (userSummary.length > 1) {
        msg += `\n👥 *Team Activity:*\n`;
        for (const u of userSummary) {
          msg += `• ${u.name}: ${u.actions} actions\n`;
        }
      }

      msg += `\n📌 *Recent:*\n`;
      for (const a of activities.slice(0, 10)) {
        const time = new Date(a.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        msg += `${time} — ${a.action}: ${a.detail}${a.amount ? ` (${formatINR(a.amount)})` : ""}\n`;
      }

      msg += `\n— Bharath Cycle Hub App`;

      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, "_blank");
    } catch (err) {
      log.error("daily report failed", { message: err instanceof Error ? err.message : String(err) });
      setShareError("Failed to load activity data");
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      {shareError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-2 text-xs text-red-700 flex items-center justify-between">
          <span>{shareError}</span>
          <button onClick={() => setShareError(null)} aria-label="Dismiss" className="text-red-400 hover:text-red-600 ml-2">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <button onClick={handleShare} disabled={sharing}
        className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium disabled:opacity-50 w-full justify-center focus-ring">
        {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
        {sharing ? "Loading..." : "Share Daily Report via WhatsApp"}
      </button>
    </>
  );
}

function InwardsEODReport() {
  const [sharing, setSharing] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const handleShare = async () => {
    setSharing(true);
    try {
      const today = getTodayIST();
      const dateStr = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

      // `apiFetchEnvelope`, not `apiFetch`: two of these read `pagination`-free `data` arrays but
      // all three must survive one of the calls failing, which the envelope form makes explicit.
      const safe = async <T,>(url: string): Promise<T[]> => {
        try {
          const res = await apiFetchEnvelope<T[]>(url);
          return res.data ?? [];
        } catch (err) {
          log.warn("EOD report section failed", {
            url,
            message: err instanceof Error ? err.message : String(err),
          });
          return [];
        }
      };

      const [inwards, transfers, allInwards] = await Promise.all([
        safe<{ quantity: number; product?: { name: string }; referenceNo?: string }>(
          `/api/inventory/inwards?dateFrom=${today}&limit=100&mine=true`
        ),
        // /api/transfer-orders, not the legacy /api/transfers, which P13 deleted. The old route
        // IGNORED dateFrom — it only ever read `status` — and had no transferNo and no status
        // column, so every line printed "PENDING" regardless of the truth.
        safe<{ orderNo?: string; id?: string; status: string }>(
          `/api/transfer-orders?dateFrom=${today}&limit=100`
        ),
        safe<{ quantity: number }>(`/api/inventory/inwards?dateFrom=${today}&limit=100`),
      ]);

      const totalInwardQty = inwards.reduce((s, t) => s + t.quantity, 0);
      const totalAllInwardQty = allInwards.reduce((s, t) => s + t.quantity, 0);

      let msg = `📥 *Inwards EOD Report — ${dateStr}*\n\n`;
      msg += `📦 *My Inwards:* ${inwards.length} entries (${totalInwardQty} units)\n`;
      msg += `📦 *Total Inwards:* ${allInwards.length} entries (${totalAllInwardQty} units)\n`;
      msg += `🔄 *Transfers:* ${transfers.length} today\n\n`;

      if (inwards.length > 0) {
        msg += `*Inward Details:*\n`;
        for (const t of inwards.slice(0, 15)) {
          const name = t.product?.name || "Unknown";
          const ref = t.referenceNo ? ` (${t.referenceNo})` : "";
          msg += `• ${name} × ${t.quantity}${ref}\n`;
        }
        if (inwards.length > 15) msg += `... +${inwards.length - 15} more\n`;
        msg += `\n`;
      }

      if (transfers.length > 0) {
        msg += `*Transfer Details:*\n`;
        for (const t of transfers.slice(0, 10)) {
          // getStatusLabel, not the raw enum. This string is pasted into WhatsApp and read by a
          // person, and P14 introduced IN_TRANSIT — which would otherwise arrive in the owner's
          // evening summary as "TRF-202609-0001: IN_TRANSIT", underscore and all.
          const no = t.orderNo || t.id?.slice(0, 8);
          msg += `• ${no}: ${getStatusLabel(t.status)}\n`;
        }
        if (transfers.length > 10) msg += `... +${transfers.length - 10} more\n`;
        msg += `\n`;
      }

      if (inwards.length === 0 && transfers.length === 0) {
        msg += `_No inward entries or transfers recorded today._\n\n`;
      }

      msg += `— Bharath Cycle Hub App`;
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, "_blank");
    } catch (err) {
      log.error("inwards EOD report failed", { message: err instanceof Error ? err.message : String(err) });
      setReportError("Failed to load report data");
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      {reportError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-2 text-xs text-red-700 flex items-center justify-between">
          <span>{reportError}</span>
          <button onClick={() => setReportError(null)} aria-label="Dismiss" className="text-red-400 hover:text-red-600 ml-2">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <button onClick={handleShare} disabled={sharing}
        className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium disabled:opacity-50 w-full justify-center mb-2 focus-ring">
        {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
        {sharing ? "Loading..." : "Share Inwards EOD Report"}
      </button>
    </>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const { role, can, loading: permsLoading } = usePermissions();
  const userName = session?.user?.name || "User";

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await apiTry<OverviewResponse>("/api/dashboard/overview");
    if (err) {
      log.warn("dashboard overview failed", { message: err });
      setError(err);
      return;
    }
    setError(null);
    setOverview(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [load]);

  async function retry() {
    setLoading(true);
    await load();
    setLoading(false);
  }

  const sections = overview?.sections ?? [];

  return (
    <div className="pb-6">
      <div className="mb-4">
        <h1 className="text-lg font-bold text-slate-900">Hello, {userName}</h1>
        <p className="text-sm text-slate-500 tabular-nums">
          {new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
        <p className="text-xs font-medium text-slate-400 mt-0.5">{role?.name || "Team Member"}</p>
      </div>

      {/* Above the shop's numbers: audits and assembly builds assigned to YOU. */}
      {!permsLoading && can("stock_audit", "view") && <MyStockAudits />}
      {!permsLoading && can("assembly", "view") && <MyAssemblyTasks />}

      {loading && <SkeletonDashboard />}

      {!loading && error && (
        <ErrorBanner message={error} onRetry={retry} />
      )}

      {/* A person whose role carries none of these grants is not an error and not a blank page. */}
      {!loading && !error && sections.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-sm text-slate-600">Nothing to show here yet.</p>
            <p className="mt-1 text-xs text-slate-400">
              Your role does not carry any of the dashboard&apos;s figures. Your own work is listed
              above, and the menu has everything you can open.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && sections.map((section) => (
        <section key={section.key} className="mt-4 first:mt-0">
          <h2 className="px-1 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {section.label}
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {section.cards.map((card) => (
              <OverviewTile key={card.key} card={card} />
            ))}
          </div>
        </section>
      ))}

      {!permsLoading && (can("activity", "view") || can("inbound", "view")) && (
        <div className="mt-4 space-y-2">
          {can("inbound", "view") && <InwardsEODReport />}
          {can("activity", "view") && <ShareDailyReport />}
        </div>
      )}
    </div>
  );
}
