// ─── One-time JSON import of the ledger app's export ─────────────────────────
//
// The ledger app (F:\bharath  Cycle\ledgers\app) keeps its whole state as one JSON document
// and "Data → Export JSON" writes it out unchanged (store.js:47-55). This module reads that
// document, lets the owner pick which brand inside it is the vendor on screen, and writes
// that brand's header, entries, gaps and progress notes into the tables in one transaction.
//
// It is setup tooling, not a feature (plan 0909-vendor-ledger-screens, R8/R9): flip
// LEDGER_JSON_IMPORT_ENABLED to false once every brand is in, and the card and the route
// both disappear. Idempotent by refusal, not by upsert — a vendor with any ledger row is
// refused, so a second run cannot double the register.

import { z } from "zod";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { parseLedgerDate } from "./reconcile";
import {
  ENTRY_TYPE_FROM_VIEW,
  GAP_STATUS_FROM_VIEW,
  GAP_TIER_FROM_VIEW,
  GAP_TYPE_FROM_VIEW,
  LEDGER_VIEW_ENTRY_TYPES,
  LEDGER_VIEW_GAP_STATUSES,
  LEDGER_VIEW_GAP_TYPES,
} from "./view-types";
import type {
  LedgerEntrySource,
  LedgerEntryType,
  LedgerSide,
  GapStatus,
  GapTier,
  GapType,
} from "@prisma/client";

const log = createLogger("ledger:import-json");

/** Set to false after setup: the card stops rendering and the route answers 410. */
export const LEDGER_JSON_IMPORT_ENABLED = true;

/** The app's hardcoded gap-id prefixes (App.jsx:16), plus Tata which it derived. */
const BRAND_CODE: Record<string, string> = {
  cultsport: "CULT",
  lucifer: "LUCI",
  emotorad: "EMOT",
  aoki: "AOKI",
  raleigh: "RALE",
  hornback: "HORN",
  trinity: "TRIN",
  tata: "TATA",
};

// ─── Schema of the export ────────────────────────────────────────────────────
// Lenient on purpose: the document was hand-edited over months, so unknown keys pass through
// and optional text may be missing or null. Only the fields the tables need are typed.

const optText = z.string().nullish();
const optNum = z.number().nullish();

const balanceSchema = z
  .object({ amount: optNum, label: optText })
  .passthrough()
  .nullish();

const entrySchema = z
  .object({
    id: z.string(),
    date: z.string(),
    type: z.enum(LEDGER_VIEW_ENTRY_TYPES as [string, ...string[]]),
    ref: optText,
    amount: optNum,
    dir: z.number().nullish(),
    side: z.enum(["vendor", "bch"]).nullish(),
    note: optText,
    audit: z
      .object({
        s: z.enum(["ok", "short", "missing", "kids", "era20", "info"]),
        t: optText,
        g: z.number().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const gapSchema = z
  .object({
    n: z.number().int(),
    title: z.string(),
    type: z.enum(LEDGER_VIEW_GAP_TYPES as [string, ...string[]]),
    amt: optNum,
    amtText: optText,
    status: z.enum(LEDGER_VIEW_GAP_STATUSES as [string, ...string[]]),
    tier: z.enum(["firm", "conditional", "leverage", "verify"]).nullish(),
    evidence: optText,
    action: optText,
    result: optText,
    progress: z.array(z.object({ date: z.string(), text: z.string() }).passthrough()).nullish(),
  })
  .passthrough();

const brandSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    sub: optText,
    updated: optText,
    lastReviewed: optText,
    position: optText,
    notes: optText,
    theirBal: balanceSchema,
    ourBal: balanceSchema,
    recov: z.object({ amount: optNum, text: optText }).passthrough().nullish(),
    deadline: z.object({ label: z.string(), date: z.string() }).passthrough().nullish(),
    ledger: z
      .object({
        opening: z.object({ date: z.string(), amount: z.number() }).passthrough().nullish(),
        coverage: optText,
        matchable: z.boolean().nullish(),
        note: optText,
      })
      .passthrough()
      .nullish(),
    entries: z.array(entrySchema).default([]),
    gaps: z.array(gapSchema).default([]),
  })
  .passthrough();

export const ledgerExportSchema = z
  .object({
    version: z.number().nullish(),
    savedAt: z.string().nullish(),
    brands: z.array(brandSchema).min(1, "The file has no brands"),
  })
  .passthrough();

export type LedgerExport = z.infer<typeof ledgerExportSchema>;
export type LedgerExportBrand = z.infer<typeof brandSchema>;

/** What the picker shows: one line per brand in the file. */
export function listBrands(doc: LedgerExport): { id: string; name: string; entries: number; gaps: number }[] {
  return doc.brands.map((b) => ({ id: b.id, name: b.name, entries: b.entries.length, gaps: b.gaps.length }));
}

export interface ImportCounts {
  entries: number;
  gaps: number;
  notes: number;
  /** `audit.g` numbers that matched no gap in the file — expected empty. */
  unlinkedAudits: number[];
}

function directionFor(type: string, dir: number | null | undefined): number {
  if (dir === 1 || dir === -1 || dir === 0) return dir;
  if (type === "invoice" || type === "debit-note") return 1;
  if (type === "note") return 0;
  return -1;
}

function sideFor(type: string, side: "vendor" | "bch" | null | undefined): LedgerSide {
  if (side) return side.toUpperCase() as LedgerSide;
  return type === "payment" || type === "debit-note" ? "BCH" : "VENDOR";
}

function dateOrNull(value: string | null | undefined): Date | null {
  return value ? parseLedgerDate(value) : null;
}

/**
 * Write one brand of the export into one vendor. Everything in one transaction, so a bad
 * row halfway through leaves nothing behind. Refuses a vendor that already holds any ledger
 * data — the import is a one-time seed, and running it twice would double the register.
 */
export async function importBrand(opts: {
  vendorId: string;
  doc: LedgerExport;
  brandId: string;
  userId: string;
}): Promise<ImportCounts> {
  const { vendorId, doc, brandId, userId } = opts;

  const brand = doc.brands.find((b) => b.id === brandId);
  if (!brand) throw new Error(`The file has no brand with id "${brandId}"`);

  // Rows and claims are what the import must never duplicate. A profile on its own — made by
  // pressing Reviewed or typing balances before the import — is overwritten by the file's
  // header, which is the fuller record.
  const [entryCount, gapCount] = await Promise.all([
    prisma.brandLedgerEntry.count({ where: { vendorId } }),
    prisma.ledgerGap.count({ where: { vendorId } }),
  ]);
  if (entryCount > 0 || gapCount > 0) {
    throw new Error(
      `This vendor already has ledger data (${entryCount} entries, ${gapCount} claims). The import runs once, on an empty vendor.`
    );
  }

  const code = BRAND_CODE[brand.id] ?? brand.id.slice(0, 4).toUpperCase();
  const opening = brand.ledger?.opening ?? null;
  const unlinkedAudits: number[] = [];
  let notes = 0;

  log.debug("import starting", {
    vendorId,
    brandId,
    entries: brand.entries.length,
    gaps: brand.gaps.length,
  });

  await prisma.$transaction(
    async (tx) => {
      // 1. The header — upserted, so a profile made before the import is replaced by the file's.
      const header = {
        code,
        sub: brand.sub ?? null,
        position: brand.position ?? null,
        notes: brand.notes ?? null,
        theirBalAmount: brand.theirBal?.amount ?? null,
        theirBalLabel: brand.theirBal?.label ?? null,
        ourBalAmount: brand.ourBal?.amount ?? null,
        ourBalLabel: brand.ourBal?.label ?? null,
        recovAmount: brand.recov?.amount ?? null,
        recovText: brand.recov?.text ?? null,
        deadlineLabel: brand.deadline?.label ?? null,
        deadlineDate: dateOrNull(brand.deadline?.date),
        ledgerOpeningAmount: opening?.amount ?? null,
        ledgerOpeningDate: dateOrNull(opening?.date),
        ledgerCoverage: brand.ledger?.coverage ?? null,
        ledgerMatchable: brand.ledger?.matchable ?? false,
        ledgerNote: brand.ledger?.note ?? null,
        updatedOn: dateOrNull(brand.updated),
        lastReviewed: dateOrNull(brand.lastReviewed),
      };
      await tx.vendorLedgerProfile.upsert({
        where: { vendorId },
        create: { vendorId, ...header },
        update: header,
      });

      // 2. Gaps, each with its progress notes. Their ids are needed to link audits below.
      const gapIdByNumber = new Map<number, string>();
      for (const g of brand.gaps) {
        const gap = await tx.ledgerGap.create({
          data: {
            vendorId,
            number: g.n,
            title: g.title,
            gapType: GAP_TYPE_FROM_VIEW[g.type as keyof typeof GAP_TYPE_FROM_VIEW] as GapType,
            tier: g.tier ? (GAP_TIER_FROM_VIEW[g.tier] as GapTier) : null,
            status: GAP_STATUS_FROM_VIEW[g.status as keyof typeof GAP_STATUS_FROM_VIEW] as GapStatus,
            amount: g.amt ?? null,
            amountNote: g.amtText || null,
            evidenceText: g.evidence || null,
            action: g.action || null,
            result: g.result || null,
            createdById: userId,
          },
          select: { id: true },
        });
        gapIdByNumber.set(g.n, gap.id);

        const progress = g.progress ?? [];
        if (progress.length) {
          await tx.ledgerGapNote.createMany({
            data: progress.map((p) => ({
              gapId: gap.id,
              body: p.text,
              authorId: userId,
              // The app's note date, not the import time — the history must read as it did.
              createdAt: parseLedgerDate(p.date) ?? new Date(),
            })),
          });
          notes += progress.length;
        }
      }

      // 3. Entries. `dir`/`side` are stored when the export carries them and derived otherwise,
      //    matching store.js entryDir/entrySide. A note carries no amount.
      const rows = brand.entries.map((e) => {
        const entryDate = parseLedgerDate(e.date);
        if (!entryDate) throw new Error(`Entry ${e.id} has an unreadable date "${e.date}"`);
        const type = ENTRY_TYPE_FROM_VIEW[e.type as keyof typeof ENTRY_TYPE_FROM_VIEW] as LedgerEntryType;
        const source: LedgerEntrySource = e.id.startsWith("man-") ? "MANUAL" : "STATEMENT_CSV";
        let gapId: string | null = null;
        if (e.audit?.g != null) {
          gapId = gapIdByNumber.get(e.audit.g) ?? null;
          if (!gapId) unlinkedAudits.push(e.audit.g);
        }
        return {
          vendorId,
          entryDate,
          type,
          ref: e.ref || null,
          amount: e.amount ?? 0,
          direction: directionFor(e.type, e.dir),
          side: sideFor(e.type, e.side),
          note: e.note || null,
          source,
          auditStatus: e.audit?.s ?? null,
          auditNote: e.audit?.t ?? null,
          gapId,
        };
      });
      if (rows.length) await tx.brandLedgerEntry.createMany({ data: rows });
    },
    { timeout: 60_000 }
  );

  const counts: ImportCounts = {
    entries: brand.entries.length,
    gaps: brand.gaps.length,
    notes,
    unlinkedAudits: [...new Set(unlinkedAudits)],
  };
  for (const g of counts.unlinkedAudits) {
    log.warn("audit points at a gap number the file does not have", { vendorId, brandId, gapNumber: g });
  }
  log.info("import finished", { vendorId, brandId, ...counts });
  return counts;
}
