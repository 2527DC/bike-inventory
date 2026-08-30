// Data access for store analytics. Ported from bch-store-analytics/lib/store.js onto Prisma.
//
// Two things from the original are deliberately gone:
//
//   lib/db.js         raw `pg` pool plus a runtime `CREATE TABLE IF NOT EXISTS`. Prisma owns
//                     the schema now, so the DDL-on-first-query landmine is removed.
//   memory-volatile   the pilot fell back to an in-process Map when DATABASE_URL was unset,
//                     and every response carried a flag saying so. That mode cannot occur
//                     here — this app has no code path that runs without Postgres.
//
// Every function is store-scoped. findings-2026-08-01 A1/A2: an earlier version pooled all
// stores together and read heartbeats only for "store-1", which would have reported store 2
// ONLINE while it was dead.

import { prisma } from "@/lib/db";
import { CountDirection } from "@prisma/client";
import { storeById } from "@/lib/stores";
import {
  businessDate,
  calendarDayRange,
  elapsedOpenMinutes,
  openingHours,
  toDateColumn,
  STORE_TZ,
  type BusinessDate,
} from "./time";

/** A counter silent for longer than this is considered offline. */
export const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

/** DAT-002 timestamp bounds: refuse anything far in the past or ahead of the server clock. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

// ─── Ingest ──────────────────────────────────────────────────────────────────

/** One event as it arrives from the agent, before validation. Every field is untrusted. */
export interface RawCountEvent {
  id?: unknown;
  ts?: unknown;
  direction?: unknown;
  entrance_id?: unknown;
  adapter?: unknown;
  track_id?: unknown;
  confidence?: unknown;
  agent_version?: unknown;
  config_version?: unknown;
  /** Present in the agent's payload and deliberately IGNORED — see DAT-002 in device-auth. */
  store_id?: unknown;
}

export interface RejectedEvent {
  id: string | null;
  why: string;
}

export interface IngestResult {
  /** Events that passed validation and were sent to the database. */
  submitted: number;
  /** Rows actually inserted. Anything less than `submitted` was an already-known event. */
  accepted: number;
  rejected: RejectedEvent[];
}

function parseDirection(value: unknown): CountDirection | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  if (v === "in") return CountDirection.IN;
  if (v === "out") return CountDirection.OUT;
  return null;
}

function optionalString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.length ? s : null;
}

/**
 * Ingest a batch of count events.
 *
 * Idempotent by `id` (DAT-001): the agent retries a batch until the server acks it, so the
 * same event arrives more than once by design. A retry must produce one logical row, never
 * two — which is why `id` comes from the agent and is the primary key.
 *
 * Rejections are reported, never silently dropped (DAT-002). A caller that swallows them
 * turns a mis-tuned camera into invisible data loss.
 */
export async function addCounts(
  list: RawCountEvent[],
  opts: { storeId: string; deviceId?: string | null; now?: number }
): Promise<IngestResult> {
  const { storeId, deviceId = null, now = Date.now() } = opts;

  const rejected: RejectedEvent[] = [];
  // Keyed by id so a batch carrying the same event twice inserts once. createMany would
  // otherwise depend on how Postgres resolves two conflicting rows inside one statement;
  // deduping here makes the outcome the same regardless.
  const valid = new Map<string, ReturnType<typeof buildRow>>();

  function buildRow(e: RawCountEvent, id: string, direction: CountDirection, ts: number) {
    return {
      id,
      // The store comes from the authenticated key, never from `e.store_id`.
      storeId,
      deviceId,
      entranceId: optionalString(e.entrance_id) ?? "main",
      direction,
      eventTs: new Date(ts),
      businessDate: toDateColumn(businessDate(ts)),
      adapter: optionalString(e.adapter) ?? "RTSP_CV",
      trackId: optionalString(e.track_id),
      confidence: Number.isFinite(Number(e.confidence)) ? Number(e.confidence) : null,
      agentVersion: optionalString(e.agent_version),
      configVersion: optionalString(e.config_version),
    };
  }

  for (const e of list) {
    if (!e || typeof e !== "object") {
      rejected.push({ id: null, why: "not an object" });
      continue;
    }

    const id = typeof e.id === "string" && e.id.length ? e.id : null;
    if (!id) {
      rejected.push({ id: null, why: "missing id" });
      continue;
    }

    const direction = parseDirection(e.direction);
    if (!direction) {
      rejected.push({ id, why: "bad direction" });
      continue;
    }

    const ts = Number(e.ts);
    if (!Number.isFinite(ts) || ts <= 0) {
      rejected.push({ id, why: "bad ts" });
      continue;
    }

    const skew = now - ts;
    if (skew < -MAX_FUTURE_SKEW_MS || skew > MAX_AGE_MS) {
      rejected.push({ id, why: "ts out of bounds" });
      continue;
    }

    valid.set(id, buildRow(e, id, direction, ts));
  }

  if (valid.size === 0) return { submitted: 0, accepted: 0, rejected };

  // One statement, not one round-trip per event. The agent pushes up to 200 at a time and
  // catches up in a loop after an outage; the original did an awaited INSERT per row, which
  // meant 200 sequential round-trips through the pooler while the store was opening.
  const result = await prisma.countEvent.createMany({
    data: [...valid.values()],
    skipDuplicates: true,
  });

  return { submitted: valid.size, accepted: result.count, rejected };
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────

export interface BeatInput {
  storeId: string;
  deviceId?: string | null;
  agentId?: string;
  queueDepth?: number | null;
  cameraOk?: boolean | null;
  lastFrameTs?: number | null;
  agentVersion?: string | null;
}

/**
 * Record an agent heartbeat. Kept as a series, not a single current value (findings D3):
 * the GAP between beats is what raises the offline alert, and the count of distinct
 * heartbeat-minutes in a day is the denominator of data coverage.
 */
export async function beat(input: BeatInput): Promise<void> {
  const {
    storeId,
    deviceId = null,
    agentId = "edge-1",
    queueDepth = null,
    cameraOk = null,
    lastFrameTs = null,
    agentVersion = null,
  } = input;

  const now = Date.now();
  const frameTs = Number(lastFrameTs);

  // Two tables in one logical write, so they go in a transaction (database-architect §4):
  // a heartbeat row that exists while the device's lastSeenAt still reads stale would show
  // the device list as offline for a counter that is demonstrably alive.
  await prisma.$transaction(async (tx) => {
    await tx.agentHeartbeat.create({
      data: {
        storeId,
        deviceId,
        agentId,
        ts: new Date(now),
        businessDate: toDateColumn(businessDate(now)),
        queueDepth: Number.isFinite(Number(queueDepth)) ? Number(queueDepth) : null,
        cameraOk: typeof cameraOk === "boolean" ? cameraOk : null,
        lastFrameTs: Number.isFinite(frameTs) && frameTs > 0 ? new Date(frameTs) : null,
        agentVersion,
      },
    });

    if (deviceId) {
      await tx.analyticsDevice.update({
        where: { id: deviceId },
        data: { lastSeenAt: new Date(now) },
      });
    }
  });
}

// ─── Store resolution ────────────────────────────────────────────────────────

/**
 * Which store the dashboard should show when no `?store=` was given.
 *
 * Returns the single store that is actually counting, or null when that is ambiguous — zero
 * devices registered, or more than one store counting. It deliberately does NOT fall back to
 * a hardcoded default: silently showing BCH_STORE's footfall to someone who asked for "the
 * dashboard" while BCC_STORE is the one with a camera is the class of quiet wrongness the
 * whole project exists to avoid. The caller turns null into "say which store".
 */
export async function resolveDefaultStore(): Promise<string | null> {
  const stores = await prisma.analyticsDevice.findMany({
    where: { isActive: true },
    select: { storeId: true },
    distinct: ["storeId"],
  });
  return stores.length === 1 ? stores[0].storeId : null;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardPayload {
  // The store CODE ("BCH_STORE"), not its id. Stores became rows in the hierarchy
  // migration and a cuid here would break every consumer reading this JSON, as well as
  // making the payload unreadable. Codes are stable; ids are not meaningful outside the DB.
  store_id: string;
  date: BusinessDate;
  timezone: string;
  footfall_basis: "in";

  in: number;
  out: number;

  counter_bills: number | null;
  total_invoices: number | null;
  bills_store_scoped: boolean;
  bills_unavailable_reason: string | null;

  visitors_per_counter_bill: number | null;

  conversion: null;
  conversion_unavailable_reason: string;

  coverage_pct: number | null;
  coverage_unavailable_reason: string | null;
  observed_minutes: number;
  expected_minutes: number | null;

  online: boolean;
  last_beat: number | null;

  storage: "postgres";
  durable: true;
  generated_at: number;
}

/**
 * One store, one business day.
 *
 * Deliberate omissions, each traceable to a spec line rather than to laziness:
 *
 *  - `conversion` is always null. PRD-v1 §10 marks it P1 "until validated" and findings B1
 *    shows conversion-per-person is wrong for a family: four people through the door is one
 *    buying decision, not four. The denominator has to be parties. Returning a wrong number
 *    here would be wrong at every weekend family visit, so it returns null plus the reason.
 *
 *  - `coverage_pct` is null while opening hours are unknown (Q-04). Missing is not zero
 *    (UI-004) — a gap in the data must never render as "no customers came in".
 */
export async function dashboard(opts: {
  storeId: string;
  date?: BusinessDate;
  now?: number;
}): Promise<DashboardPayload> {
  const { storeId, now = Date.now() } = opts;
  const date = opts.date ?? businessDate(now);
  const businessDateColumn = toDateColumn(date);
  const dayRange = calendarDayRange(date);

  const [directionRows, lastBeat, beatsToday, posSessions, invoiceCount, countedStores] =
    await Promise.all([
      prisma.countEvent.groupBy({
        by: ["direction"],
        where: { storeId, businessDate: businessDateColumn },
        _count: { _all: true },
      }),

      prisma.agentHeartbeat.findFirst({
        where: { storeId },
        orderBy: { ts: "desc" },
        select: { ts: true },
      }),

      // Coverage is distinct heartbeat-MINUTES, so the timestamps are needed, not a count.
      // The agent beats once a minute, so this is at most ~1,440 rows for a full day — small
      // enough to fold in JS and not worth a raw `COUNT(DISTINCT date_trunc(...))`.
      prisma.agentHeartbeat.findMany({
        where: { storeId, businessDate: businessDateColumn },
        select: { ts: true },
      }),

      prisma.posSession.aggregate({
        where: { sessionDate: dayRange },
        _sum: { invoiceCount: true },
      }),

      prisma.customerInvoice.count({ where: { invoiceDate: dayRange } }),

      // How many stores are actually counting right now — see the bills caveat below.
      prisma.analyticsDevice.findMany({
        where: { isActive: true },
        select: { storeId: true },
        distinct: ["storeId"],
      }),
    ]);

  let inCount = 0;
  let outCount = 0;
  for (const row of directionRows) {
    if (row.direction === CountDirection.IN) inCount = row._count._all;
    else if (row.direction === CountDirection.OUT) outCount = row._count._all;
  }

  const observedMinutes = new Set(beatsToday.map((b) => Math.floor(b.ts.getTime() / 60000))).size;

  const hours = openingHours();
  const expectedMinutes = elapsedOpenMinutes(date, hours, now);
  const coveragePct =
    expectedMinutes == null || expectedMinutes === 0
      ? null
      : Math.min(100, Math.round((observedMinutes / expectedMinutes) * 100));

  const lastBeatMs = lastBeat ? lastBeat.ts.getTime() : null;
  const online = lastBeatMs != null && now - lastBeatMs < HEARTBEAT_STALE_MS;

  // ── The bills caveat ──────────────────────────────────────────────────────
  // PosSession and CustomerInvoice carry NO store column. Their counts are estate-wide.
  // While exactly one store is counted that is harmless — every bill belongs to the store
  // whose door is being watched. With two stores counting, dividing one store's footfall by
  // every store's bills is precisely the un-auditable number this project exists to avoid,
  // so the bills are withheld with a reason instead.
  const multiStore = countedStores.length > 1;
  const counterBills = multiStore ? null : posSessions._sum.invoiceCount ?? 0;
  const totalInvoices = multiStore ? null : invoiceCount;

  const visitorsPerCounterBill =
    counterBills != null && counterBills > 0 && inCount > 0
      ? Math.round((inCount / counterBills) * 10) / 10
      : null;

  // storeId is an id internally; the payload emits the CODE so its value stays readable
  // and stable for anything downstream reading this JSON.
  const storeRef = await storeById(storeId);

  return {
    store_id: storeRef?.code ?? storeId,
    date,
    timezone: STORE_TZ,
    footfall_basis: "in",

    in: inCount,
    out: outCount,

    counter_bills: counterBills,
    total_invoices: totalInvoices,
    bills_store_scoped: false,
    bills_unavailable_reason: multiStore
      ? "bills are not store-scoped: PosSession and CustomerInvoice carry no store column, and more than one store is counting"
      : null,

    visitors_per_counter_bill: visitorsPerCounterBill,

    conversion: null,
    conversion_unavailable_reason:
      "denominator not approved: conversion needs parties, not people (PRD-v1 §10, findings B1)",

    coverage_pct: coveragePct,
    coverage_unavailable_reason:
      coveragePct == null ? "store opening hours not configured (Q-04)" : null,
    observed_minutes: observedMinutes,
    expected_minutes: expectedMinutes,

    online,
    last_beat: lastBeatMs,

    // Constant, unlike the pilot where this reported a real fallback mode. Kept in the
    // payload so the wire contract does not change under any client already reading it.
    storage: "postgres",
    durable: true,
    generated_at: now,
  };
}
