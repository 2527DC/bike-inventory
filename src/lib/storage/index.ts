// Storage resolver. The only thing outside this directory that anything should import.
//
// Which provider is live is DATA, not configuration-at-boot: it comes from the
// StorageConfig row and can be changed from Settings → Storage with no redeploy. The same
// reasoning the RBAC layer uses for permissions.
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { S3Provider } from "./s3";
import { LocalProvider, DEFAULT_LOCAL_DIR } from "./local";
import {
  StorageNotConfiguredError,
  isStorageProviderKey,
  type StorageProvider,
  type StorageProviderKey,
  type StorageSettings,
} from "./types";

const log = createLogger("storage");

export * from "./types";
export { S3Provider } from "./s3";
export { LocalProvider, DEFAULT_LOCAL_DIR } from "./local";

// A short cache, not a permanent one. Every upload would otherwise cost a database round
// trip, but a provider switch must take effect quickly without a redeploy — 30s is the
// compromise, and activate() invalidates it immediately anyway.
const CACHE_MS = 30_000;
let cached: { at: number; provider: StorageProvider | null } | null = null;

/** Drop the cache. Call after any write to StorageConfig. */
export function invalidateStorageCache(): void {
  cached = null;
}

/**
 * Settings from the database, or — before a row exists — from environment variables.
 *
 * The env path is bootstrap only: it means a fresh deploy with S3_* set works before anyone
 * opens the settings screen. Once a row exists the database always wins, otherwise changing
 * the provider in the UI would appear to do nothing on a host that still has the env vars.
 */
export async function loadStorageSettings(): Promise<StorageSettings | null> {
  const row = await prisma.storageConfig.findUnique({ where: { id: "singleton" } });

  if (row) {
    const provider: StorageProviderKey = isStorageProviderKey(row.provider) ? row.provider : "LOCAL";
    return {
      provider,
      bucket: row.bucket,
      region: row.region,
      accessKeyId: row.accessKeyId,
      secretAccessKey: row.secretAccessKey,
      publicBaseUrl: row.publicBaseUrl,
      localDir: row.localDir,
    };
  }

  const env = (n: string) => {
    const v = process.env[n];
    return v && v.trim() ? v.trim() : null;
  };

  if (env("S3_BUCKET") && env("S3_REGION") && env("S3_ACCESS_KEY_ID") && env("S3_SECRET_ACCESS_KEY")) {
    log.info("no StorageConfig row — bootstrapping from S3_* environment variables");
    return {
      provider: "S3",
      bucket: env("S3_BUCKET"),
      region: env("S3_REGION"),
      accessKeyId: env("S3_ACCESS_KEY_ID"),
      secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
      publicBaseUrl: env("S3_PUBLIC_BASE_URL"),
      localDir: null,
    };
  }

  return null;
}

/** Build a provider from settings without touching the cache or the database. */
export function buildProvider(settings: StorageSettings): StorageProvider {
  if (settings.provider === "S3") return new S3Provider(settings);
  return new LocalProvider({ ...settings, localDir: settings.localDir || DEFAULT_LOCAL_DIR });
}

/**
 * The live provider.
 *
 * Throws StorageNotConfiguredError when nothing usable is set up. That is a *defined*
 * outcome, not a crash: callers turn it into a 501 telling the user to visit
 * Settings → Storage. On Vercel with no S3 configured this is exactly what happens, which
 * is the intended behaviour — better an honest refusal than writing to a filesystem the
 * platform wipes between requests.
 */
export async function getStorage(): Promise<StorageProvider> {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    if (cached.provider) return cached.provider;
    throw new StorageNotConfiguredError();
  }

  const settings = await loadStorageSettings();
  if (!settings) {
    cached = { at: Date.now(), provider: null };
    log.warn("no storage provider is configured");
    throw new StorageNotConfiguredError();
  }

  try {
    const provider = buildProvider(settings);
    cached = { at: Date.now(), provider };
    return provider;
  } catch (e) {
    // Incomplete settings — e.g. S3 selected with no bucket. Cache the negative result so a
    // broken configuration does not hammer the database on every upload attempt.
    cached = { at: Date.now(), provider: null };
    log.error("storage settings are incomplete", {
      provider: settings.provider,
      error: e instanceof Error ? e.message : String(e),
    });
    throw new StorageNotConfiguredError(
      "Storage is configured but incomplete. Check Settings → Storage."
    );
  }
}

/** getStorage() that answers null instead of throwing, for callers that degrade gracefully. */
export async function tryGetStorage(): Promise<StorageProvider | null> {
  try {
    return await getStorage();
  } catch {
    return null;
  }
}

/** True when a provider is configured and usable. Cheap enough for a status endpoint. */
export async function isStorageConfigured(): Promise<boolean> {
  return (await tryGetStorage()) !== null;
}
