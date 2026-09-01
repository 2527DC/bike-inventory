"use client";

import Link from "next/link";
import { ChevronRight, Boxes } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { usePermissions } from "@/lib/use-permissions";
import { moduleIcon } from "@/lib/module-icons";

/**
 * The Stock Management hub.
 *
 * ─── WHY THIS PAGE EXISTS AT ALL ─────────────────────────────────────────────────────────
 *
 * `stock_management` is a container: its six children are where the work happens. It could
 * have been a routeless parent like `store_management` — except `bottom-nav.tsx` filters the
 * phone's tab bar to `!m.parent`, so a routeless parent would have dropped Stock, Inbound and
 * Deliveries off the bottom bar entirely and left a stock user looking at Second-Hand,
 * Scanner and POS. Giving the parent a route keeps the tab, and this is what the tab opens.
 *
 * ─── IT LISTS WHAT THE VIEWER CAN ACTUALLY REACH ─────────────────────────────────────────
 *
 * Children come from the granted module list — the same store the sidebar reads — rather than
 * a hardcoded array. A person without `transfers.view` does not see Stock Transfers here, and
 * cannot be shown a card the sidebar would hide. That property only holds because the list is
 * derived; a literal array here would drift the moment a module is added or renamed.
 *
 * Note this is cosmetic, as CLAUDE.md requires: each destination re-checks its own permission
 * server-side. Hiding a card is a courtesy, not a gate.
 */
export default function StockManagementPage() {
  const { modules, loading } = usePermissions();

  const children = modules
    .filter((m) => m.parent?.key === "stock_management" && m.route)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Boxes className="h-5 w-5 text-slate-700" />
        <h1 className="text-lg font-bold text-slate-900">Stock Management</h1>
      </div>
      <p className="text-[11px] text-slate-500 mb-4 ml-7">
        Stock, product types, audits, inbound, dispatch and transfers.
      </p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : children.length === 0 ? (
        // Reachable in one real case: someone holds `stock_management.view` and none of the
        // children. Say so plainly rather than rendering an empty page that looks broken.
        <div className="text-center py-12">
          <Boxes className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Nothing here yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            Your role can open Stock Management but none of the sections inside it. Ask an
            admin to grant the ones you need.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {children.map((m) => {
            const Icon = moduleIcon(m.icon);
            return (
              <Link key={m.key} href={m.route!} className="block focus-ring rounded-xl">
                <Card className="hover:border-slate-300 transition-colors">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                      <Icon className="h-4.5 w-4.5 text-slate-600" />
                    </div>
                    <p className="flex-1 text-sm font-semibold text-slate-900">{m.label}</p>
                    <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
