export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { isR2Configured, r2PresignPut, r2PublicUrl } from "@/lib/r2";

// Uploads are namespaced per feature; refuse anything outside these prefixes so a
// presign can't overwrite arbitrary keys.
const ALLOWED_PREFIXES = [
  "vendor-issues/",
  "second-hand/",
  "expenses/",
  "products/",
  // Staff LMS content images — product playbook covers, lesson thumbnails. Without this
  // entry every LMS upload fails with "Invalid upload path", and the 400 names the path
  // rather than the allowlist, so it reads like a client bug rather than a missing prefix.
  "staff-lms/",
];
const MAX_BYTES = 100 * 1024 * 1024; // videos are compressed client-side; this is a hard backstop

export async function POST(req: NextRequest) {
  try {
    await requireAuth();

    if (!isR2Configured()) {
      // Caller falls back to Supabase storage until R2 env vars are set.
      return errorResponse("R2 storage not configured", 501);
    }

    const body = await req.json().catch(() => null);
    const key = typeof body?.key === "string" ? body.key : "";
    const contentType = typeof body?.contentType === "string" ? body.contentType : "";
    const size = typeof body?.size === "number" ? body.size : 0;

    if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p)) || key.includes("..") || key.length > 200) {
      return errorResponse("Invalid upload path", 400);
    }
    if (!/^[a-z0-9/_.-]+$/i.test(key)) return errorResponse("Invalid upload path", 400);
    if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
      return errorResponse("Only images and videos are allowed", 400);
    }
    if (!size || size > MAX_BYTES) return errorResponse("File too large", 400);

    const uploadUrl = await r2PresignPut(key);
    return successResponse({ uploadUrl, publicUrl: r2PublicUrl(key) }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Presign failed", 500);
  }
}
