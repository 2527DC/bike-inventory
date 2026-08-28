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

const ONE_YEAR = "public, max-age=31536000, immutable"; // keys are unique + immutable

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
    const res = await fetch(plan.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": type, "Cache-Control": ONE_YEAR },
      body: blob,
    });
    if (!res.ok) {
      // A failed preflight lands here as a network error with status 0 — the usual cause is
      // a missing bucket CORS policy, which the Storage settings page can apply.
      throw new Error(
        `Upload failed (${res.status || "network error"}). If this persists, check the bucket CORS policy in Settings → Storage.`
      );
    }
    return plan.publicUrl;
  }

  // Direct: the file passes through our API.
  const form = new FormData();
  form.append("file", blob instanceof File ? blob : new File([blob], key.split("/").pop() || "upload", { type }));
  form.append("key", key);

  const { url } = await apiFetch<{ url: string }>(plan.uploadPath, { method: "POST", body: form });
  return url;
}

/** Images take the same path as everything else; kept as a named entry point for callers. */
export async function uploadImage(file: File, key: string): Promise<string> {
  return uploadMedia(file, key, file.type || "image/jpeg");
}
