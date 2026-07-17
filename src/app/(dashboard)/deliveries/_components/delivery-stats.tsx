"use client";

import { Card, CardContent } from "@/components/ui/card";

interface Stats {
  pending: number;
  verified: number;
  scheduled: number;
  outForDelivery: number;
  delivered: number;
  deliveredToday: number;
  flagged: number;
  prebooked: number;
}

interface DeliveryStatsProps {
  stats: Stats;
  onFilterChange: (status: string) => void;
}

const STAT_CARDS = [
  { key: "pending", field: "pending" as const, label: "Pending", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", sub: "text-amber-600" },
  { key: "scheduled", field: "scheduled" as const, label: "Scheduled", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", sub: "text-blue-600" },
  { key: "outForDelivery", field: "outForDelivery" as const, label: "Out", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", sub: "text-orange-600" },
  { key: "delivered", field: "delivered" as const, label: "Delivered", bg: "bg-green-50", border: "border-green-200", text: "text-green-700", sub: "text-green-600" },
] as const;

export function DeliveryStats({ stats, onFilterChange }: DeliveryStatsProps) {
  return (
    <div className="grid grid-cols-4 gap-1.5 mb-3">
      {STAT_CARDS.map((c) => {
        const value = c.field === "delivered"
          ? (stats.delivered || stats.deliveredToday)
          : stats[c.field];
        const filterKey = c.field === "outForDelivery"
          ? "OUT_FOR_DELIVERY"
          : c.key.toUpperCase();
        return (
          <Card
            key={c.key}
            className={`${c.bg} ${c.border} cursor-pointer`}
            onClick={() => onFilterChange(filterKey)}
          >
            <CardContent className="p-2 text-center">
              <p className={`text-xl font-bold tabular-nums leading-none ${c.text}`}>{value}</p>
              <p className={`text-[11px] mt-1 ${c.sub}`}>{c.label}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export type { Stats };
