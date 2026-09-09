// ─── Rows → the ledger screen's view ─────────────────────────────────────────
//
// The screen is a verbatim port of the ledger app's BrandPage, so it reads the app's own
// property names (view-types.ts). This is the one place database rows become that shape;
// the components never see an enum, a Date or a relation.

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import {
  ENTRY_TYPE_TO_VIEW,
  GAP_STATUS_TO_VIEW,
  GAP_TIER_TO_VIEW,
  GAP_TYPE_TO_VIEW,
  isoDay,
  type LedgerBrandView,
  type LedgerViewAuditStatus,
  type LedgerViewEntry,
  type LedgerViewGap,
} from "./view-types";

const log = createLogger("ledger:view");

const AUDIT_STATUSES: LedgerViewAuditStatus[] = ["ok", "short", "missing", "kids", "era20", "info"];

/** The CULT in CULT-3 when no profile has set one: the first four letters of the vendor code. */
export function defaultLedgerCode(vendorCode: string): string {
  const letters = vendorCode.replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters || vendorCode.toUpperCase()).slice(0, 4);
}

export async function buildLedgerView(
  vendorId: string,
  opts: { canSeeGaps: boolean }
): Promise<LedgerBrandView | null> {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, name: true, code: true, ledgerProfile: true },
  });
  if (!vendor) return null;

  const [entries, gaps] = await Promise.all([
    prisma.brandLedgerEntry.findMany({
      where: { vendorId },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        entryDate: true,
        type: true,
        ref: true,
        amount: true,
        direction: true,
        side: true,
        note: true,
        source: true,
        auditStatus: true,
        auditNote: true,
        gapId: true,
        matchStatus: true,
      },
    }),
    // The claim register is gated separately: a live dispute is more sensitive than the
    // statement it came from. When the caller may not see it, the view says so and the
    // entries' audit links still carry the gap NUMBER (a public-enough fact) but no gap.
    prisma.ledgerGap.findMany({
      where: { vendorId },
      orderBy: { number: "asc" },
      select: {
        id: true,
        number: true,
        title: true,
        gapType: true,
        tier: true,
        status: true,
        amount: true,
        amountNote: true,
        evidenceText: true,
        action: true,
        result: true,
        notes: {
          orderBy: { createdAt: "asc" },
          select: { id: true, body: true, createdAt: true },
        },
        evidence: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            url: true,
            kind: true,
            capturedOn: true,
            capturedLabel: true,
            source: true,
            note: true,
          },
        },
      },
    }),
  ]);

  const numberByGapId = new Map(gaps.map((g) => [g.id, g.number]));

  const viewEntries: LedgerViewEntry[] = entries.map((e) => {
    const s = e.auditStatus as LedgerViewAuditStatus | null;
    const audit =
      s && AUDIT_STATUSES.includes(s)
        ? {
            s,
            t: e.auditNote ?? "",
            ...(e.gapId && numberByGapId.has(e.gapId) ? { g: numberByGapId.get(e.gapId)! } : {}),
          }
        : undefined;
    return {
      id: e.id,
      date: isoDay(e.entryDate) ?? "",
      type: ENTRY_TYPE_TO_VIEW[e.type] ?? "adjustment",
      ref: e.ref ?? "",
      amount: e.amount,
      dir: e.direction > 0 ? 1 : e.direction < 0 ? -1 : 0,
      side: e.side === "BCH" ? "bch" : "vendor",
      note: e.note ?? "",
      ...(audit ? { audit } : {}),
      source: e.source,
      ignored: e.matchStatus === "IGNORED",
    };
  });

  const viewGaps: LedgerViewGap[] = opts.canSeeGaps
    ? gaps.map((g) => ({
        id: g.id,
        n: g.number,
        title: g.title,
        type: GAP_TYPE_TO_VIEW[g.gapType] ?? "dispute",
        amt: g.amount,
        amtText: g.amountNote ?? "",
        status: GAP_STATUS_TO_VIEW[g.status] ?? "open",
        ...(g.tier ? { tier: GAP_TIER_TO_VIEW[g.tier] } : {}),
        evidence: g.evidenceText ?? "",
        action: g.action ?? "",
        result: g.result ?? "",
        progress: g.notes.map((n) => ({ id: n.id, date: isoDay(n.createdAt) ?? "", text: n.body })),
        shots: g.evidence.map((ev) => ({
          id: ev.id,
          url: ev.url,
          doc: ev.kind !== "SCREENSHOT",
          date: ev.capturedLabel ?? isoDay(ev.capturedOn) ?? "",
          source: ev.source ?? "",
          note: ev.note ?? "",
        })),
      }))
    : [];

  const p = vendor.ledgerProfile;
  const view: LedgerBrandView = {
    id: vendor.id,
    name: vendor.name,
    code: p?.code || defaultLedgerCode(vendor.code),
    sub: p?.sub ?? "",
    updated: isoDay(p?.updatedOn),
    lastReviewed: isoDay(p?.lastReviewed),
    position: p?.position ?? "",
    notes: p?.notes ?? "",
    theirBal: { amount: p?.theirBalAmount ?? null, label: p?.theirBalLabel ?? "" },
    ourBal: { amount: p?.ourBalAmount ?? null, label: p?.ourBalLabel ?? "" },
    recov: { amount: p?.recovAmount ?? null, text: p?.recovText ?? "" },
    deadline:
      p?.deadlineDate && p.deadlineLabel
        ? { label: p.deadlineLabel, date: isoDay(p.deadlineDate) ?? "" }
        : null,
    ledger: {
      opening:
        p?.ledgerOpeningAmount !== null && p?.ledgerOpeningAmount !== undefined
          ? { date: isoDay(p.ledgerOpeningDate) ?? "", amount: p.ledgerOpeningAmount }
          : null,
      coverage: p?.ledgerCoverage ?? "",
      matchable: p?.ledgerMatchable ?? false,
      note: p?.ledgerNote ?? "",
    },
    entries: viewEntries,
    gaps: viewGaps,
    canSeeGaps: opts.canSeeGaps,
    // Rows and claims decide emptiness, not the profile: pressing Reviewed or typing balances
    // on a fresh vendor creates a profile, and that must not lock the one-time import out.
    isEmpty: entries.length === 0 && gaps.length === 0,
  };

  log.debug("view built", {
    vendorId,
    entries: viewEntries.length,
    gaps: gaps.length,
    canSeeGaps: opts.canSeeGaps,
    hasProfile: Boolean(p),
  });
  return view;
}
