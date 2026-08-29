// The storage contract. Every provider implements exactly this, and nothing outside
// src/lib/storage should know which one is active.
//
// Two providers exist today: S3 and LOCAL. R2 and Supabase were deliberately not carried
// over — there is nothing to migrate, so they would be code maintained for no benefit.
// Adding one back is a single file plus one line in the factory (see index.ts).

export type StorageProviderKey = "LOCAL" | "S3";

export const STORAGE_PROVIDERS: StorageProviderKey[] = ["LOCAL", "S3"];

export function isStorageProviderKey(v: unknown): v is StorageProviderKey {
  return typeof v === "string" && (STORAGE_PROVIDERS as string[]).includes(v);
}

/** Resolved configuration for one provider. Secrets never leave the server. */
export interface StorageSettings {
  provider: StorageProviderKey;
  bucket: string | null;
  region: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  publicBaseUrl: string | null;
  localDir: string | null;
}

export interface StorageProvider {
  readonly key: StorageProviderKey;

  /**
   * A short-lived URL the browser can PUT straight to, bypassing the serverless
   * request-body limit.
   *
   * Returns **null** when the provider cannot offer one — the local filesystem has no
   * externally reachable endpoint. Callers must treat null as "post through the API
   * instead", never as an error. This is the only behavioural difference the UI sees.
   */
  presignPut(key: string, contentType: string, expiresSeconds?: number): Promise<string | null>;

  /** Server-side upload. Returns the public URL of the stored object. */
  put(key: string, body: ArrayBuffer | Buffer | Blob, contentType: string): Promise<string>;

  /** Used by the connection test to prove a written object is really readable. */
  exists(key: string): Promise<boolean>;

  /** Deleting something already absent is not an error — a retried delete must not fail. */
  delete(key: string): Promise<void>;

  /** The stable, public URL for a key. */
  publicUrl(key: string): string;

  /**
   * Recover a key from a URL this provider issued. MUST return null for any URL it did not
   * issue, so a caller holding a foreign URL cannot talk us into deleting an arbitrary key.
   */
  keyFromUrl(url: string): string | null;
}

/** Thrown when no usable provider is configured. Callers turn this into a 501 + a message. */
export class StorageNotConfiguredError extends Error {
  constructor(message = "Storage is not configured. Set it up in Settings → Storage.") {
    super(message);
    this.name = "StorageNotConfiguredError";
  }
}

/** One year. Keys are unique and immutable, so this is safe and cuts egress hard. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
