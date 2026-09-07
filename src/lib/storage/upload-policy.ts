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
  // Transfer documents (P15): the tax invoice or delivery challan that has to travel with an
  // inter-store movement. The ONLY prefix that accepts application/pdf — see PREFIX_TYPES.
  "transfers/",
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

/**
 * What each prefix accepts, where it differs from the default.
 *
 * The default everywhere else is images and videos: those uploads are photographs of damage,
 * of a second-hand bike, of a receipt. A transfer document is different in kind — it is a tax
 * invoice raised in Zoho Books and downloaded as a PDF, and the whole point of attaching it is
 * that it is the document a tax officer would ask for. Re-photographing a PDF to satisfy an
 * image-only rule would be absurd, so `transfers/` takes PDFs as well as photos (a phone
 * picture of a signed challan is a perfectly good record).
 *
 * Video is deliberately NOT in the transfer list. Nothing about a document is a video, and
 * leaving it out keeps a 100 MB clip from being filed as an invoice.
 */
const PREFIX_TYPES: Record<string, (contentType: string) => boolean> = {
  "transfers/": (t) => t === "application/pdf" || t.startsWith("image/"),
};

/**
 * @param key Optional, and today nothing omits it: `checkUpload` is the only caller and it
 *            always passes one. Optional rather than required so that a future caller
 *            validating a bare content type falls back to the image/video rule instead of
 *            silently getting the permissive transfer rule for a key it never supplied.
 */
export function checkContentType(contentType: string, key?: string): UploadCheck {
  if (key) {
    const prefix = Object.keys(PREFIX_TYPES).find((p) => key.startsWith(p));
    if (prefix) {
      return PREFIX_TYPES[prefix](contentType)
        ? { ok: true }
        : { ok: false, error: "Only PDF files and images are allowed for transfer documents" };
    }
  }
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
  for (const c of [checkKey(key), checkContentType(contentType, key), checkSize(size)]) {
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
