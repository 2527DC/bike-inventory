import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("settings:bin-tracking");
export const BIN_TRACKING_SETTING_KEY = "BIN_TRACKING_ENABLED";

// In-memory cache with short TTL so server routes don't query db on every check
let cachedValue: boolean | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5000;

/**
 * Resolves whether bin tracking is currently enabled.
 * Checks the database AppSetting first, then falls back to process.env.BIN_TRACKING_ENABLED.
 */
export async function isBinTrackingEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cachedValue !== null && now < cacheExpiry) {
    return cachedValue;
  }

  try {
    const setting = await prisma.appSetting.findUnique({
      where: { key: BIN_TRACKING_SETTING_KEY },
    });

    if (setting) {
      cachedValue = setting.value === "true";
      cacheExpiry = now + CACHE_TTL_MS;
      return cachedValue;
    }
  } catch (err) {
    log.warn("could not read bin tracking setting from db, falling back to env", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const envVal = process.env.BIN_TRACKING_ENABLED;
  cachedValue = envVal === "true" || envVal === "1";
  cacheExpiry = now + CACHE_TTL_MS;
  return cachedValue;
}

/**
 * Updates the bin tracking state in the database and updates local cache.
 */
export async function setBinTrackingEnabled(enabled: boolean): Promise<boolean> {
  const val = enabled ? "true" : "false";
  try {
    await prisma.appSetting.upsert({
      where: { key: BIN_TRACKING_SETTING_KEY },
      create: { key: BIN_TRACKING_SETTING_KEY, value: val },
      update: { value: val },
    });
  } catch (err) {
    log.warn("appSetting upsert failed, ensuring table exists", { error: err instanceof Error ? err.message : String(err) });
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AppSetting" (
        "key" TEXT PRIMARY KEY,
        "value" TEXT NOT NULL,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.appSetting.upsert({
      where: { key: BIN_TRACKING_SETTING_KEY },
      create: { key: BIN_TRACKING_SETTING_KEY, value: val },
      update: { value: val },
    });
  }

  cachedValue = enabled;
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  log.info("bin tracking setting updated", { enabled });
  return enabled;
}
