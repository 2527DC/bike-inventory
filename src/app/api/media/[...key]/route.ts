export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { getStorage, LocalProvider, IMMUTABLE_CACHE_CONTROL } from "@/lib/storage";

const log = createLogger("media:serve");

// Serves files held by the LOCAL storage provider. S3 files are fetched straight from the
// bucket or CDN by their public URL and never come through here.
//
// Authenticated on purpose. A bucket behind a public URL is world-readable by design, but
// files on our own disk are not, and quietly making them public because the storage
// provider changed would be a silent downgrade. Anyone signed in can read; the key itself
// is the only addressing, exactly as with the bucket.
const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", avif: "image/avif", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  pdf: "application/pdf",
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  try {
    await requireAuth();

    const { key: segments } = await ctx.params;
    const key = (segments || []).map(decodeURIComponent).join("/");
    if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const storage = await getStorage();
    if (!(storage instanceof LocalProvider)) {
      // The active provider serves its own files. Reaching here means a stored URL points
      // at local storage while the live provider is S3 — the file predates the switch.
      log.warn("local media requested while a different provider is active", { key });
      return NextResponse.json(
        { error: "This file was stored by a different storage provider." },
        { status: 404 }
      );
    }

    // read() resolves the key against the storage root and refuses anything escaping it,
    // so path traversal is handled there rather than trusted here.
    const body = await storage.read(key);
    if (!body) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const ext = key.split(".").pop()?.toLowerCase() || "";
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
        "Content-Length": String(body.byteLength),
        "Cache-Control": IMMUTABLE_CACHE_CONTROL,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    log.error("media serve failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not read the file" }, { status: 500 });
  }
}
