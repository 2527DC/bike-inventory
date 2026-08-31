// Client-side media upload.
//
// The server decides where files go; this module only asks how to send one. Two answers:
//
//   mode "presigned" — PUT straight to the bucket. Large videos bypass the serverless
//                      request-body limit entirely, which is the whole reason this exists.
//   mode "direct"    — POST through /api/upload, for a provider with no externally
//                      reachable endpoint (the local filesystem).
//
// This used to branch on an HTTP 501 from the presign route to mean "fall back to
// Supabase", which was invisible to anyone reading the calling code. The provider is now
// explicit and comes from the database.
import { apiFetch, ApiError } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("media:upload-client");

const ONE_YEAR = "public, max-age=31536000, immutable"; // keys are unique + immutable

// A presigned PUT can fail before it ever reaches S3 — the browser rejects it at the CORS
// preflight when the bucket carries no matching rule, and reports a network error with no
// status that names neither CORS nor the bucket. That is a bucket misconfiguration, but a
// person uploading a photo of a second-hand cycle cannot act on it, so this module falls
// back to POSTing through /api/upload, which is server-side and has no origin to check.
//
// The cap is what makes the fallback safe to take silently: a serverless request body is
// limited to 4.5 MB on Vercel, so anything larger MUST go straight to the bucket and a
// failure there has to surface as a failure. Compressed photos are 30–150 KB (maxEdge 800,
// webp), so the flow that actually hits the CORS wall is comfortably inside it; videos are
// not, and they keep the original error.
const DIRECT_FALLBACK_MAX_BYTES = 4 * 1024 * 1024;

interface PresignPresigned {
  mode: "presigned";
  uploadUrl: string;
  publicUrl: string;
  provider: string;
}

interface PresignDirect {
  mode: "direct";
  uploadPath: string;
  provider: string;
}

type PresignResponse = PresignPresigned | PresignDirect;

/**
 * Upload a blob under `key` and return the URL to store.
 *
 * Throws with a message written for a human — these surface in toasts, so "Storage is not
 * configured. Set it up in Settings → Storage." is the actual product behaviour when
 * nothing has been set up yet, not a developer error string.
 */
export async function uploadMedia(blob: Blob, key: string, contentType?: string): Promise<string> {
  const type = contentType || (blob as File).type || "application/octet-stream";

  let plan: PresignResponse;
  try {
    plan = await apiFetch<PresignResponse>("/api/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, contentType: type, size: blob.size }),
    });
  } catch (e) {
    // A 501 is "no storage configured" and already carries a useful message from the
    // server. Anything else gets a generic one so a raw stack never reaches a toast.
    if (e instanceof ApiError && e.status === 501) throw new Error(e.message);
    throw new Error(e instanceof Error ? e.message : "Could not prepare the upload. Try again.");
  }

  if (plan.mode === "presigned") {
    // Third-party endpoint, so a raw fetch is correct here: there is no JSON envelope to
    // read and apiFetch would try to parse one.
    let res: Response | null = null;
    let networkError: string | null = null;
    try {
      res = await fetch(plan.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": type, "Cache-Control": ONE_YEAR },
        body: blob,
      });
    } catch (e) {
      // fetch() REJECTS (it does not resolve with a status) when the request never
      // completed: a rejected CORS preflight, DNS failure, or offline. There is no status
      // to read, which is why the browser console shows ERR_FAILED and nothing else.
      networkError = e instanceof Error ? e.message : "network error";
    }

    if (res?.ok) return plan.publicUrl;

    const detail = networkError ? `network error — ${networkError}` : `status ${res!.status}`;

    if (blob.size <= DIRECT_FALLBACK_MAX_BYTES) {
      log.warn("presigned PUT failed, falling back to the API", {
        provider: plan.provider,
        key,
        bytes: blob.size,
        detail,
      });
      return putThroughApi(blob, key, type, "/api/upload");
    }

    log.error("presigned PUT failed and the file is too large to proxy", {
      provider: plan.provider,
      key,
      bytes: blob.size,
      detail,
    });
    throw new Error(
      `Upload failed (${networkError ? "network error" : res!.status}). The file is too large to send through the app, so it must go straight to the bucket — check the bucket CORS policy in Settings → Storage.`
    );
  }

  // Direct: the provider cannot presign (the local filesystem), so the file always passes
  // through our API.
  return putThroughApi(blob, key, type, plan.uploadPath);
}

/** POST the blob through our own API, which uploads server-side. No origin, so no CORS. */
async function putThroughApi(blob: Blob, key: string, type: string, path: string): Promise<string> {
  const form = new FormData();
  form.append("file", blob instanceof File ? blob : new File([blob], key.split("/").pop() || "upload", { type }));
  form.append("key", key);

  const { url } = await apiFetch<{ url: string }>(path, { method: "POST", body: form });
  log.debug("stored via the API", { key, bytes: blob.size });
  return url;
}

/** Images take the same path as everything else; kept as a named entry point for callers. */
export async function uploadImage(file: File, key: string): Promise<string> {
  return uploadMedia(file, key, file.type || "image/jpeg");
}
