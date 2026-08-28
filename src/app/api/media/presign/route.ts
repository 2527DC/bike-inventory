export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { getStorage, StorageNotConfiguredError } from "@/lib/storage";
import { checkUpload } from "@/lib/storage/upload-policy";

const log = createLogger("media:presign");

// The path allowlist, type and size rules live in @/lib/storage/upload-policy, shared with
// /api/upload. They used to be declared here and there separately, and had already drifted.

export async function POST(req: NextRequest) {
  try {
    await requireAuth();

    const body = await req.json().catch(() => null);
    const key = typeof body?.key === "string" ? body.key : "";
    const contentType = typeof body?.contentType === "string" ? body.contentType : "";
    const size = typeof body?.size === "number" ? body.size : 0;

    // Validate BEFORE resolving the provider: a bad request is the caller's bug either way,
    // and there is no reason to touch the database to tell them so.
    const check = checkUpload(key, contentType, size);
    if (!check.ok) return errorResponse(check.error!, 400);

    const storage = await getStorage();
    const uploadUrl = await storage.presignPut(key, contentType);

    // null means this provider has no externally reachable endpoint (the local filesystem).
    // The browser posts the file through /api/upload instead. This is a normal path, not a
    // failure — the client branches on `mode`.
    if (!uploadUrl) {
      return successResponse({ mode: "direct", uploadPath: "/api/upload", provider: storage.key }, 201);
    }

    return successResponse(
      { mode: "presigned", uploadUrl, publicUrl: storage.publicUrl(key), provider: storage.key },
      201
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof StorageNotConfiguredError) {
      // 501: the request was fine, the server has no storage set up. The message is written
      // for the person who will see it in a toast, not for a log file.
      log.warn("upload attempted with no storage configured");
      return errorResponse(error.message, 501);
    }
    log.error("presign failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Presign failed", 500);
  }
}
