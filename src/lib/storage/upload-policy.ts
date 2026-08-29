// What may be uploaded, and where. ONE definition, shared by both upload paths.
//
// This exists because there are two ways a file reaches storage — a presigned PUT straight
// to the bucket (/api/media/presign) and a POST through the API (/api/upload, used when the
// provider cannot presign). Before this module they each carried their own rules and had
// already drifted: presign allowed 100 MB images and videos, upload allowed 5 MB images
// only. The same file succeeded or failed depending on which provider happened to be live.

/** Uploads are namespaced per feature so a caller cannot overwrite arbitrary keys. */
export const ALLOWED_PREFIXES = [
  "vendor-issues/",
  "second-hand/",
  "expenses/",
  "products/",
  // Staff LMS content images — product playbook covers, lesson thumbnails. Without this
  // entry every LMS upload fails with "Invalid upload path", and the 400 names the path
  // rather than the allowlist, so it reads like a client bug rather than a missing prefix.
  "staff-lms/",
];

/** Videos are compressed client-side; this is a hard backstop, not the expected size. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface UploadCheck {
  ok: boolean;
  error?: string;
}

/** Validate a key. Rejects traversal, odd characters, and anything outside the allowlist. */
export function checkKey(key: string): UploadCheck {
  if (!key) return { ok: false, error: "Invalid upload path" };
  if (key.includes("..") || key.length > 200) return { ok: false, error: "Invalid upload path" };
  if (!/^[a-z0-9/_.-]+$/i.test(key)) return { ok: false, error: "Invalid upload path" };
  if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
    return { ok: false, error: "Invalid upload path" };
  }
  return { ok: true };
}

export function checkContentType(contentType: string): UploadCheck {
  if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
    return { ok: false, error: "Only images and videos are allowed" };
  }
  return { ok: true };
}

export function checkSize(size: number): UploadCheck {
  if (!size || size > MAX_UPLOAD_BYTES) return { ok: false, error: "File too large" };
  return { ok: true };
}

/** All three, in the order whose message is most useful to the caller. */
export function checkUpload(key: string, contentType: string, size: number): UploadCheck {
  for (const c of [checkKey(key), checkContentType(contentType), checkSize(size)]) {
    if (!c.ok) return c;
  }
  return { ok: true };
}

/** A unique, immutable key under `prefix`. Immutability is what makes year-long caching safe. */
export function buildKey(prefix: string, filename: string): string {
  const ext = (filename.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const clean = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `${clean}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}
