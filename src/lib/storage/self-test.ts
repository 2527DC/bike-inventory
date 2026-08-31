// Prove a storage configuration actually works, before anyone trusts it with a photo.
//
// Used by both the Test button and by Make active — activation runs the same check and
// refuses to switch if it fails, so a broken provider can never become the live one.
import { createLogger } from "@/lib/logger";
import { LocalProvider } from "./local";
import { S3Provider } from "./s3";
import { buildProvider, loadStorageSettings } from "./index";
import type { StorageProviderKey } from "./types";

const log = createLogger("storage:self-test");

export interface StorageTestStep {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface StorageTestResult {
  ok: boolean;
  provider: StorageProviderKey;
  steps: StorageTestStep[];
  error?: string;
}

/**
 * Round-trip a throwaway object: write it, read it back, delete it.
 *
 * Writing alone is not proof. A bucket can accept a PUT and still be unreadable at the
 * public URL, which is exactly the misconfiguration that would otherwise surface days later
 * as broken images nobody can explain.
 *
 * `browserOrigin` is where the person running the test has their browser — the origin a
 * real upload would come FROM. Every step above it runs server-side with IAM credentials,
 * which is why this test used to pass on a bucket where no browser upload could ever
 * succeed: a server-side PUT has no origin and never triggers a preflight. Pass it and the
 * CORS step below closes that hole.
 */
export async function runStorageTest(
  provider: StorageProviderKey,
  browserOrigin?: string | null
): Promise<StorageTestResult> {
  const steps: StorageTestStep[] = [];
  const fail = (error: string): StorageTestResult => ({ ok: false, provider, steps, error });

  const settings = await loadStorageSettings();
  if (!settings) {
    return fail("Nothing is configured yet. Enter the settings and save them first.");
  }

  let store;
  try {
    store = buildProvider({ ...settings, provider });
    steps.push({ name: "Read settings", ok: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    steps.push({ name: "Read settings", ok: false, detail });
    return fail(detail);
  }

  // The filesystem gets an extra check first: on Vercel the root is read-only, and finding
  // that out here is the entire reason this provider refuses to activate there.
  if (store instanceof LocalProvider) {
    const probe = await store.probeWritable();
    steps.push({ name: "Filesystem is writable", ok: probe.ok, detail: probe.reason });
    if (!probe.ok) return fail(probe.reason || "The storage directory is not writable.");
  }

  const key = `products/.connection-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  const body = Buffer.from(`storage self-test ${new Date().toISOString()}`);

  try {
    await store.put(key, body, "text/plain");
    steps.push({ name: "Write a test object", ok: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    steps.push({ name: "Write a test object", ok: false, detail });
    log.error("self-test write failed", { provider, error: detail });
    return fail(detail);
  }

  let readBack = false;
  try {
    readBack = await store.exists(key);
    steps.push({
      name: "Read it back",
      ok: readBack,
      detail: readBack ? undefined : "The object was written but could not be read back.",
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    steps.push({ name: "Read it back", ok: false, detail });
  }

  // Always attempt cleanup, even when the read failed — otherwise a repeatedly failing
  // test quietly litters the bucket with test objects.
  try {
    await store.delete(key);
    steps.push({ name: "Clean up", ok: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    steps.push({ name: "Clean up", ok: false, detail });
    log.warn("self-test could not delete its own test object", { key, provider, error: detail });
  }

  if (!readBack) return fail("The test object was written but could not be read back.");

  // ── Browser uploads (S3 only) ───────────────────────────────────────────────
  // Deliberately NOT part of `ok`. A missing CORS rule does not make the provider unusable
  // — uploads fall back through /api/upload (src/lib/media-upload.ts) — so failing the
  // whole test here would refuse activation for a bucket that works. It is reported as its
  // own step because it is the difference between fast direct uploads and every photo
  // passing through a serverless function.
  if (store instanceof S3Provider) {
    const origins = await store.readCorsOrigins();

    if (origins === null) {
      steps.push({
        name: "Browser uploads (CORS)",
        ok: true,
        detail: "Could not check — the IAM user has no s3:GetBucketCors. Not necessarily a problem.",
      });
    } else if (!browserOrigin) {
      steps.push({
        name: "Browser uploads (CORS)",
        ok: true,
        detail: `The bucket allows ${origins.length} origin(s). The app origin could not be determined from this request.`,
      });
    } else {
      const allowed = origins.includes("*") || origins.includes(browserOrigin);
      steps.push({
        name: "Browser uploads (CORS)",
        ok: allowed,
        detail: allowed
          ? `${browserOrigin} may upload directly to the bucket.`
          : `${browserOrigin} is NOT in the bucket CORS policy, so direct uploads fail their preflight and are routed through the app instead. Press "Apply CORS" to fix it.`,
      });
      if (!allowed) {
        log.warn("bucket CORS does not allow the app origin", { provider, browserOrigin });
      }
    }
  }

  log.info("storage self-test passed", { provider });
  return { ok: true, provider, steps };
}
