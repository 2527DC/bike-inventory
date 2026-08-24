// Nightly footfall rollup, plus retention on the raw event table.
//
// count_events grows by roughly one row per person per direction, forever, and the dashboard
// polls every 15 seconds. Without this, every page load re-aggregates the whole day from raw
// rows, and after a year the table is the biggest thing in the database.
//
// The rollup is idempotent — @@unique([storeId, businessDate]) plus an upsert — so running it
// twice, or re-running it for a backfilled day, produces the same row rather than a duplicate.
// That matters because the agent backfills after an outage: a day already rolled up can gain
// events hours later, and re-running fixes it.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { CountDirection } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import {
  businessDate,
  calendarDayRange,
  fromDateColumn,
  isBusinessDate,
  toDateColumn,
} from "@/lib/analytics/time";

/**
 * Raw events older than this are deleted once their day is rolled up.
 *
 * Q7 in the merge plan: 90 days keeps a full quarter of per-event detail — enough to review a
 * disputed count or re-tune the crossing rule against real traffic — while the daily rollups
 * are kept forever. Override with ANALYTICS_RAW_RETENTION_DAYS.
 *
 * Set it to 0 to disable pruning entirely; the rollup still runs.
 */
const DEFAULT_RETENTION_DAYS = 90;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return errorResponse("CRON_SECRET not configured", 500);
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const url = new URL(req.url);

    // Default target is YESTERDAY, not today: today is still accumulating, and a rollup of a
    // partial day that is never revisited would freeze the wrong number into history.
    // ?date= allows a manual backfill.
    const dateParam = url.searchParams.get("date");
    if (dateParam && !isBusinessDate(dateParam)) {
      return errorResponse("date must be YYYY-MM-DD", 400);
    }
    const target = dateParam ?? businessDate(Date.now() - 24 * 60 * 60 * 1000);
    const dateCol = toDateColumn(target);

    // Roll up every store that has either events or heartbeats on that day, so a store whose
    // camera was dead all day still gets a row recording zero traffic and zero coverage —
    // which is different from having no row at all.
    const [eventStores, beatStores] = await Promise.all([
      prisma.countEvent.findMany({
        where: { businessDate: dateCol },
        select: { storeId: true },
        distinct: ["storeId"],
      }),
      prisma.agentHeartbeat.findMany({
        where: { businessDate: dateCol },
        select: { storeId: true },
        distinct: ["storeId"],
      }),
    ]);
    const stores = [...new Set([...eventStores, ...beatStores].map((s) => s.storeId))];

    // Bills are estate-wide — the POS models carry no store column (see plan §3.2a). They are
    // snapshotted onto every store's row with that caveat understood, and the dashboard is
    // what decides whether they are safe to display.
    const dayRange = calendarDayRange(target);
    const [posAgg, invoiceCount] = await Promise.all([
      prisma.posSession.aggregate({
        where: { sessionDate: dayRange },
        _sum: { invoiceCount: true },
      }),
      prisma.customerInvoice.count({ where: { invoiceDate: dayRange } }),
    ]);
    const counterBills = posAgg._sum.invoiceCount ?? 0;

    const rolled: Record<string, { in: number; out: number; observedMinutes: number }> = {};

    for (const storeId of stores) {
      const [directions, beats] = await Promise.all([
        prisma.countEvent.groupBy({
          by: ["direction"],
          where: { storeId, businessDate: dateCol },
          _count: { _all: true },
        }),
        prisma.agentHeartbeat.findMany({
          where: { storeId, businessDate: dateCol },
          select: { ts: true },
        }),
      ]);

      let inCount = 0;
      let outCount = 0;
      for (const d of directions) {
        if (d.direction === CountDirection.IN) inCount = d._count._all;
        else if (d.direction === CountDirection.OUT) outCount = d._count._all;
      }

      const observedMinutes = new Set(
        beats.map((b) => Math.floor(b.ts.getTime() / 60000))
      ).size;

      await prisma.footfallDaily.upsert({
        where: { storeId_businessDate: { storeId, businessDate: dateCol } },
        update: { inCount, outCount, observedMinutes, counterBills, totalInvoices: invoiceCount },
        create: {
          storeId,
          businessDate: dateCol,
          inCount,
          outCount,
          observedMinutes,
          counterBills,
          totalInvoices: invoiceCount,
        },
      });

      rolled[storeId] = { in: inCount, out: outCount, observedMinutes };
    }

    // ── Retention ────────────────────────────────────────────────────────────
    const retentionDays = Number(
      process.env.ANALYTICS_RAW_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS
    );
    let pruned = 0;
    let prunedBefore: string | null = null;

    if (Number.isFinite(retentionDays) && retentionDays > 0) {
      const cutoff = toDateColumn(
        businessDate(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
      );

      // Only prune days that actually have a rollup row. Deleting raw events for a day that
      // was never rolled up would destroy the only copy of that data.
      const rolledDays = await prisma.footfallDaily.findMany({
        where: { businessDate: { lt: cutoff } },
        select: { businessDate: true },
        distinct: ["businessDate"],
      });

      if (rolledDays.length > 0) {
        const result = await prisma.countEvent.deleteMany({
          where: { businessDate: { in: rolledDays.map((d) => d.businessDate) } },
        });
        pruned = result.count;
        prunedBefore = fromDateColumn(cutoff);
      }
    }

    return successResponse({
      date: target,
      stores_rolled: stores.length,
      rolled,
      bills_snapshot: { counter_bills: counterBills, total_invoices: invoiceCount },
      bills_store_scoped: false,
      retention_days: retentionDays,
      raw_events_pruned: pruned,
      pruned_before: prunedBefore,
    });
  } catch (error) {
    console.error("footfall rollup failed", error);
    return errorResponse(error instanceof Error ? error.message : "Rollup failed", 500);
  }
}
