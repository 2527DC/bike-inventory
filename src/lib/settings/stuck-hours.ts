import { z } from "zod";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("settings:stuck-hours");

/**
 * When the dashboard calls something "stuck" (plan 1709-priority-build-and-stock-flow, R35–R37,
 * Q30): an approval waiting longer than `approvals` hours, an inbound not received after
 * `inbound` hours, a build on hold longer than `holds` hours. Short outwards are stuck at once
 * and have no setting. Stored as JSON in AppSetting — pattern copied from `bin-tracking.ts` (removed in plan 2109, Q27).
 */
export const STUCK_HOURS_SETTING_KEY = "dashboard_stuck_hours";

// Up to 30 days; a threshold past that is not "stuck", it is abandoned.
const hours = z.number().int().min(1).max(720);

export const stuckHoursSchema = z.object({
  approvals: hours,
  inbound: hours,
  holds: hours,
});

export type StuckHours = z.infer<typeof stuckHoursSchema>;

export const DEFAULT_STUCK_HOURS: StuckHours = {
  approvals: 24,
  inbound: 72,
  holds: 24,
};

// Short TTL so the dashboard does not query the setting on every load.
let cachedValue: StuckHours | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5000;

/**
 * Parse a stored value. A missing key falls back to its default individually; anything
 * unparseable falls back to the defaults entirely.
 */
function parseStored(raw: string): StuckHours {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    log.warn("stored stuck hours are not valid JSON, using defaults", {
      key: STUCK_HOURS_SETTING_KEY,
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULT_STUCK_HOURS;
  }
  const parsed = stuckHoursSchema.partial().safeParse(json);
  if (!parsed.success) {
    log.warn("stored stuck hours failed validation, using defaults", {
      key: STUCK_HOURS_SETTING_KEY,
      issues: parsed.error.issues.length,
    });
    return DEFAULT_STUCK_HOURS;
  }
  return {
    approvals: parsed.data.approvals ?? DEFAULT_STUCK_HOURS.approvals,
    inbound: parsed.data.inbound ?? DEFAULT_STUCK_HOURS.inbound,
    holds: parsed.data.holds ?? DEFAULT_STUCK_HOURS.holds,
  };
}

/** The current thresholds. Never throws: a read failure returns the defaults. */
export async function getStuckHours(): Promise<StuckHours> {
  const now = Date.now();
  if (cachedValue !== null && now < cacheExpiry) return cachedValue;

  let value = DEFAULT_STUCK_HOURS;
  try {
    const setting = await prisma.appSetting.findUnique({
      where: { key: STUCK_HOURS_SETTING_KEY },
    });
    if (setting) value = parseStored(setting.value);
  } catch (err) {
    log.warn("could not read stuck hours from db, using defaults", {
      key: STUCK_HOURS_SETTING_KEY,
      error: err instanceof Error ? err.message : String(err),
    });
    // Not cached: the next request retries the database.
    return value;
  }

  cachedValue = value;
  cacheExpiry = now + CACHE_TTL_MS;
  return value;
}

/**
 * Save the thresholds. Validated here as well as at the route. Throws (after logging) if
 * validation or the write fails.
 */
export async function setStuckHours(input: unknown): Promise<StuckHours> {
  const parsed = stuckHoursSchema.safeParse(input);
  if (!parsed.success) {
    log.warn("stuck hours rejected by validation", {
      key: STUCK_HOURS_SETTING_KEY,
      issues: parsed.error.issues.length,
    });
    throw parsed.error;
  }
  const value = parsed.data;
  const raw = JSON.stringify(value);

  try {
    await prisma.appSetting.upsert({
      where: { key: STUCK_HOURS_SETTING_KEY },
      create: { key: STUCK_HOURS_SETTING_KEY, value: raw },
      update: { value: raw },
    });
  } catch (err) {
    log.error("stuck hours write failed", {
      key: STUCK_HOURS_SETTING_KEY,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  cachedValue = value;
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  log.info("stuck hours updated", { key: STUCK_HOURS_SETTING_KEY, ...value });
  return value;
}
