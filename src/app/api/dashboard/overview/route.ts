export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";
import { listPendingApprovals } from "@/lib/approvals/pending";
import { getStuckHours } from "@/lib/settings/stuck-hours";
import { istDayBounds } from "@/lib/services/timezone";
import { LIVE_UNIT_STATUSES } from "@/lib/units/constants";
import type { BillStatus, InvoiceStatus } from "@prisma/client";

const log = createLogger("dashboard:overview");

/**
 * The ONE dashboard (plan 1709-priority-build-and-stock-flow, R35–R37, Q29, Q30).
 *
 * ─── WHY THIS REPLACED SIX SCREENS ────────────────────────────────────────────────────────
 *
 * Until now `(dashboard)/page.tsx` picked one of six hand-written variants from a ladder of
 * `can(...)` tests. Two things were wrong with that. A role created in the UI tomorrow landed on
 * whichever rung it happened to trip first, which was nobody's decision; and each variant chose
 * its own endpoints, so the same number could differ between two people's home screens. Q29
 * answers it: ONE dashboard, and every card appears only if the viewer's role holds that card's
 * grant.
 *
 * ─── THE API IS THE GATE, NOT THE PAGE ────────────────────────────────────────────────────
 *
 * `requireAuth` alone, then `userCan` per SECTION — a viewer who holds nothing gets an empty
 * `sections` array, not a 403, because the dashboard is everybody's landing page. The client
 * renders exactly what comes back and decides nothing: CLAUDE.md, "frontend checks are cosmetic".
 * No role name appears anywhere here; every gate is a permission.
 *
 * ─── ONE ROUND OF QUERIES ─────────────────────────────────────────────────────────────────
 *
 * Every section's queries are built up front and awaited in a single `Promise.all`. A section the
 * viewer cannot see costs nothing — `when()` hands back the zero value without touching the
 * database — so the cheapest dashboard in the shop is also the one with the fewest grants.
 *
 * ─── WHAT "STUCK" MEANS ───────────────────────────────────────────────────────────────────
 *
 * Q30: approvals waiting > 24 h, inbound not received > 72 h, builds on hold > 24 h — all three
 * editable in Settings › Approvals — and a short outward is stuck from the moment it is
 * scheduled, which is why it has no threshold.
 */

/** A number on the dashboard, with the screen that explains it. */
interface OverviewCard {
  key: string;
  label: string;
  value: number;
  /** How the client prints it. Money is never formatted server-side — the page owns `formatINR`. */
  format: "inr" | "count" | "days";
  href: string;
  /** Colour intent only. `bad`/`warn` are set by the CARD, never by the number being large. */
  tone?: "neutral" | "good" | "warn" | "bad";
  hint?: string;
}

interface OverviewSection {
  key: "money" | "stuck" | "progress" | "today" | "condition";
  label: string;
  cards: OverviewCard[];
}

/** Run `fn` only when the grant allows it; otherwise answer `fallback` without a query. */
function when<T>(allowed: boolean, fn: () => Promise<T>, fallback: T): Promise<T> {
  return allowed ? fn() : Promise.resolve(fallback);
}

const HOUR_MS = 3_600_000;

/** An outward that should be holding stock but is not yet on its way. */
const PRE_DISPATCH_STATUSES = ["SCHEDULED", "PACKED"] as const;

const BILL_PENDING: BillStatus[] = ["PENDING", "PARTIALLY_PAID"];
const INVOICE_PENDING: InvoiceStatus[] = ["PENDING", "PARTIALLY_PAID", "OVERDUE"];

const LIVE = LIVE_UNIT_STATUSES as string[];

export async function GET() {
  try {
    const user = await requireAuth();

    // One `getAccess` read backs all of these — it is React-`cache`d per request.
    const [
      canAccounts,
      canStock,
      canReports,
      canInbound,
      canAssemblyView,
      canAssemblyApprove,
      canTransfers,
      canAudit,
      canDeliveries,
    ] = await Promise.all([
      userCan(user.id, "accounts", "view"),
      userCan(user.id, "stock", "view"),
      userCan(user.id, "reports", "view"),
      userCan(user.id, "inbound", "view"),
      userCan(user.id, "assembly", "view"),
      userCan(user.id, "assembly", "approve"),
      userCan(user.id, "transfers", "view"),
      userCan(user.id, "stock_audit", "view"),
      userCan(user.id, "deliveries", "view"),
    ]);

    // Stock value is NOT read from `api/dashboard/stats`: that route is gated on `reorder.view`,
    // which is a purchasing grant and has nothing to do with being allowed to see what the shop
    // is holding (Q29's own note). The same SUM is computed here behind `stock.view` or
    // `reports.view` instead.
    const canStockValue = canStock || canReports;

    const hours = await getStuckHours();
    const now = Date.now();
    const approvalsCutoffHours = hours.approvals;
    const inboundCutoff = new Date(now - hours.inbound * HOUR_MS);
    const holdsCutoff = new Date(now - hours.holds * HOUR_MS);
    // "Today" is the STORE's day. `toISOString()` names yesterday for every one of these counts
    // between midnight and 05:30 IST, which is when the morning shift is already working.
    const { start: dayStart, end: dayEnd } = istDayBounds();

    const [
      payableAgg,
      receivableAgg,
      overdueBills,
      stockValueRows,
      pending,
      stuckInbound,
      holdRows,
      shortOutwards,
      starBuildsOpen,
      buildsInProgress,
      transfersInTransit,
      auditsInProgress,
      outwardsDoneToday,
      buildsDoneToday,
      transfersReceivedToday,
      inboundReceivedToday,
      conditionRows,
    ] = await Promise.all([
      // ── Money ────────────────────────────────────────────────────────────────────────
      when(
        canAccounts,
        () =>
          prisma.vendorBill.aggregate({
            where: { status: { in: BILL_PENDING } },
            _sum: { amount: true, paidAmount: true },
          }),
        null
      ),
      when(
        canAccounts,
        () =>
          prisma.customerInvoice.aggregate({
            where: { status: { in: INVOICE_PENDING } },
            _sum: { amount: true, paidAmount: true },
          }),
        null
      ),
      when(
        canAccounts,
        () =>
          prisma.vendorBill.count({
            where: { dueDate: { lt: new Date(now) }, status: { in: BILL_PENDING } },
          }),
        0
      ),
      when(
        canStockValue,
        () =>
          prisma.$queryRaw<[{ stock_value: number }]>`
            SELECT COALESCE(SUM("currentStock" * "costPrice"), 0)::float AS stock_value
            FROM "Product" WHERE status = 'ACTIVE'
          `,
        [{ stock_value: 0 }] as [{ stock_value: number }]
      ),

      // ── Stuck ────────────────────────────────────────────────────────────────────────
      // The SAME rows the Requests page and the header badge show — `listPendingApprovals`
      // gates each of its four sections on that module's `approve` grant, so this card counts
      // only what this viewer could actually act on.
      listPendingApprovals(user.id),
      when(
        canInbound,
        () =>
          prisma.inboundShipment.count({
            where: { status: { not: "DELIVERED" }, createdAt: { lt: inboundCutoff } },
          }),
        0
      ),
      when(
        canAssemblyApprove,
        () =>
          prisma.assemblyTask.groupBy({
            by: ["holdIssue"],
            where: { status: "ON_HOLD", holdStartedAt: { lt: holdsCutoff } },
            _count: { _all: true },
          }),
        [] as Array<{ holdIssue: "CYCLE" | "WORKFLOOR" | null; _count: { _all: number } }>
      ),
      // A short outward is one that should be holding its floor's stock and is not. Holding is
      // all-or-nothing (plan 1609, T5), so a null `stockReservedAt` in a pre-dispatch status IS
      // the shortage — there is nothing to re-derive line by line. A Dummy (no warehouse) is
      // excluded: R26a keeps it out of every stock rule.
      when(
        canDeliveries,
        () =>
          prisma.delivery.count({
            where: {
              status: { in: [...PRE_DISPATCH_STATUSES] },
              warehouseId: { not: null },
              stockReservedAt: null,
            },
          }),
        0
      ),

      // ── In progress ──────────────────────────────────────────────────────────────────
      // ★ builds open: units a starred outward has reserved that still owe somebody a build.
      // Non-assemblable units are excluded — they are reserved but nobody is building them.
      when(
        canAssemblyView,
        () =>
          prisma.inventoryUnit.count({
            where: {
              reservedForDeliveryId: { not: null },
              status: { in: LIVE_UNIT_STATUSES },
              nonAssemblable: false,
              assembledAt: null,
            },
          }),
        0
      ),
      when(
        canAssemblyView,
        () => prisma.assemblyTask.count({ where: { status: "IN_PROGRESS" } }),
        0
      ),
      when(
        canTransfers,
        () => prisma.transferOrder.count({ where: { status: "IN_TRANSIT" } }),
        0
      ),
      when(
        canAudit,
        () => prisma.stockCount.count({ where: { status: "IN_PROGRESS" } }),
        0
      ),

      // ── Done today (IST) ─────────────────────────────────────────────────────────────
      when(
        canDeliveries,
        () =>
          prisma.delivery.count({
            where: {
              status: { in: ["DELIVERED", "WALK_OUT"] },
              deliveredAt: { gte: dayStart, lte: dayEnd },
            },
          }),
        0
      ),
      when(
        canAssemblyView,
        () =>
          prisma.assemblyTask.count({
            where: { status: "COMPLETED", completedAt: { gte: dayStart, lte: dayEnd } },
          }),
        0
      ),
      when(
        canTransfers,
        () =>
          prisma.transferOrder.count({
            where: { status: "RECEIVED", receivedAt: { gte: dayStart, lte: dayEnd } },
          }),
        0
      ),
      when(
        canInbound,
        () =>
          prisma.inboundShipment.count({
            where: { deliveredAt: { gte: dayStart, lte: dayEnd } },
          }),
        0
      ),

      // ── Stock by condition ───────────────────────────────────────────────────────────
      // Exactly the definition in src/lib/stock-condition.ts — no assembly wins, then
      // `assembled_at` set / null — so this row and /stock/condition can never disagree.
      when(
        canStock,
        () =>
          prisma.$queryRaw<
            [{ assembled: number; unassembled: number; no_assembly: number; oldest: Date | null }]
          >`
            SELECT COUNT(*) FILTER (WHERE NOT u.non_assemblable AND u.assembled_at IS NOT NULL)::int AS assembled,
                   COUNT(*) FILTER (WHERE NOT u.non_assemblable AND u.assembled_at IS NULL)::int     AS unassembled,
                   COUNT(*) FILTER (WHERE u.non_assemblable)::int                                    AS no_assembly,
                   -- "createdAt" is quoted camelCase: InventoryUnit.createdAt carries no @map,
                   -- unlike its snake_cased neighbours. Unquoted it folds to created_at and 500s.
                   MIN(u."createdAt") FILTER (WHERE NOT u.non_assemblable AND u.assembled_at IS NULL) AS oldest
            FROM inventory_units u
            WHERE u.status::text = ANY(${LIVE})
          `,
        [{ assembled: 0, unassembled: 0, no_assembly: 0, oldest: null }] as [
          { assembled: number; unassembled: number; no_assembly: number; oldest: Date | null },
        ]
      ),
    ]);

    const sections: OverviewSection[] = [];

    // ── Money ──────────────────────────────────────────────────────────────────────────
    const moneyCards: OverviewCard[] = [];
    if (canAccounts) {
      const payable = (payableAgg?._sum.amount ?? 0) - (payableAgg?._sum.paidAmount ?? 0);
      const receivable = (receivableAgg?._sum.amount ?? 0) - (receivableAgg?._sum.paidAmount ?? 0);
      moneyCards.push(
        { key: "payable", label: "Payable", value: payable, format: "inr", href: "/accounts", tone: "neutral" },
        { key: "receivable", label: "Receivable", value: receivable, format: "inr", href: "/receivables", tone: "neutral" },
        {
          key: "overdueBills",
          label: "Overdue bills",
          value: overdueBills,
          format: "count",
          href: "/bills",
          tone: overdueBills > 0 ? "warn" : "good",
        }
      );
    }
    if (canStockValue) {
      moneyCards.push({
        key: "stockValue",
        label: "Stock value",
        value: stockValueRows[0]?.stock_value ?? 0,
        format: "inr",
        href: "/stock",
        tone: "neutral",
      });
    }
    if (moneyCards.length) sections.push({ key: "money", label: "Money", cards: moneyCards });

    // ── Stuck ──────────────────────────────────────────────────────────────────────────
    const stuckCards: OverviewCard[] = [];
    const waitingApprovals = pending.requests.filter((r) => r.ageHours >= approvalsCutoffHours).length;
    // Shown to anybody who approves ANYTHING, even at zero: "nothing is stuck" is the answer
    // an approver opens this page for. Somebody who approves nothing never sees the card.
    if (Object.values(pending.sections).some(Boolean)) {
      stuckCards.push({
        key: "approvalsWaiting",
        label: `Approvals waiting > ${hours.approvals} h`,
        value: waitingApprovals,
        format: "count",
        href: "/approvals",
        tone: waitingApprovals > 0 ? "bad" : "good",
        hint: pending.total > waitingApprovals ? `${pending.total} waiting in total` : undefined,
      });
    }
    if (canDeliveries) {
      stuckCards.push({
        key: "shortOutwards",
        label: "Outwards short on their floor",
        value: shortOutwards,
        format: "count",
        href: "/deliveries",
        tone: shortOutwards > 0 ? "bad" : "good",
        hint: shortOutwards > 0 ? "Scheduled, stock not reserved — a transfer is needed" : undefined,
      });
    }
    if (canAssemblyApprove) {
      const holdCount = (issue: "CYCLE" | "WORKFLOOR" | null) =>
        holdRows.find((r) => r.holdIssue === issue)?._count._all ?? 0;
      const cycle = holdCount("CYCLE");
      const workfloor = holdCount("WORKFLOOR");
      // Holds placed before R3 replaced the six free-text reasons carry no `holdIssue`. They are
      // reported on their own rather than folded into one of the two, which would be a guess.
      const legacy = holdCount(null);
      stuckCards.push(
        {
          key: "holdsCycle",
          label: `On hold > ${hours.holds} h · cycle`,
          value: cycle,
          format: "count",
          href: "/assembly?tab=tasks",
          tone: cycle > 0 ? "warn" : "good",
        },
        {
          key: "holdsWorkfloor",
          label: `On hold > ${hours.holds} h · workfloor`,
          value: workfloor,
          format: "count",
          href: "/assembly?tab=tasks",
          tone: workfloor > 0 ? "warn" : "good",
        }
      );
      if (legacy > 0) {
        stuckCards.push({
          key: "holdsLegacy",
          label: `On hold > ${hours.holds} h · no issue recorded`,
          value: legacy,
          format: "count",
          href: "/assembly?tab=tasks",
          tone: "warn",
          hint: "Held before the two-option hold",
        });
      }
    }
    if (canInbound) {
      stuckCards.push({
        key: "inboundStuck",
        label: `Inbound not received > ${hours.inbound} h`,
        value: stuckInbound,
        format: "count",
        href: "/inbound",
        tone: stuckInbound > 0 ? "warn" : "good",
      });
    }
    if (stuckCards.length) sections.push({ key: "stuck", label: "Stuck", cards: stuckCards });

    // ── In progress ────────────────────────────────────────────────────────────────────
    const progressCards: OverviewCard[] = [];
    if (canAssemblyView) {
      progressCards.push(
        {
          key: "starBuilds",
          label: "★ builds open",
          value: starBuildsOpen,
          format: "count",
          href: "/assembly?tab=awaiting",
          tone: "neutral",
        },
        {
          key: "buildsInProgress",
          label: "Builds in progress",
          value: buildsInProgress,
          format: "count",
          href: "/assembly?tab=tasks",
          tone: "neutral",
        }
      );
    }
    if (canTransfers) {
      progressCards.push({
        key: "transfersInTransit",
        label: "Transfers in transit",
        value: transfersInTransit,
        format: "count",
        href: "/transfers",
        tone: "neutral",
      });
    }
    if (canAudit) {
      progressCards.push({
        key: "auditsInProgress",
        label: "Audits in progress",
        value: auditsInProgress,
        format: "count",
        href: "/stock-audit",
        tone: "neutral",
      });
    }
    if (progressCards.length) sections.push({ key: "progress", label: "In progress", cards: progressCards });

    // ── Done today ─────────────────────────────────────────────────────────────────────
    const todayCards: OverviewCard[] = [];
    if (canDeliveries) {
      todayCards.push({
        key: "outwardsDone",
        label: "Outwards handed over",
        value: outwardsDoneToday,
        format: "count",
        href: "/deliveries",
        tone: "good",
      });
    }
    if (canAssemblyView) {
      todayCards.push({
        key: "buildsDone",
        label: "Builds completed",
        value: buildsDoneToday,
        format: "count",
        href: "/assembly?tab=tasks",
        tone: "good",
      });
    }
    if (canTransfers) {
      todayCards.push({
        key: "transfersReceived",
        label: "Transfers received",
        value: transfersReceivedToday,
        format: "count",
        href: "/transfers",
        tone: "good",
      });
    }
    if (canInbound) {
      todayCards.push({
        key: "inboundReceived",
        label: "Inbound received",
        value: inboundReceivedToday,
        format: "count",
        href: "/inbound",
        tone: "good",
      });
    }
    if (todayCards.length) sections.push({ key: "today", label: "Done today", cards: todayCards });

    // ── Stock by condition ─────────────────────────────────────────────────────────────
    if (canStock) {
      const c = conditionRows[0];
      const oldestDays = c?.oldest
        ? Math.max(0, Math.floor((now - new Date(c.oldest).getTime()) / (24 * HOUR_MS)))
        : 0;
      sections.push({
        key: "condition",
        label: "Stock by condition",
        cards: [
          { key: "unassembled", label: "Unassembled units", value: c?.unassembled ?? 0, format: "count", href: "/stock/condition", tone: "neutral" },
          { key: "assembled", label: "Assembled units", value: c?.assembled ?? 0, format: "count", href: "/stock/condition", tone: "neutral" },
          { key: "noAssembly", label: "No assembly", value: c?.no_assembly ?? 0, format: "count", href: "/stock/condition", tone: "neutral" },
          {
            key: "oldestUnassembled",
            label: "Oldest unassembled",
            value: oldestDays,
            format: "days",
            href: "/stock/condition",
            tone: oldestDays > 0 ? "warn" : "good",
          },
        ],
      });
    }

    log.info("dashboard overview served", {
      userId: user.id,
      sections: sections.length,
      cards: sections.reduce((n, s) => n + s.cards.length, 0),
      ms: Date.now() - now,
    });

    return successResponse({ sections, stuckHours: hours });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to load the dashboard";
    log.error("dashboard overview failed", { message });
    return errorResponse(message, 500);
  }
}
