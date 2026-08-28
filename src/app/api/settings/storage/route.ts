export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { invalidateStorageCache, DEFAULT_LOCAL_DIR } from "@/lib/storage";

const log = createLogger("settings:storage");

// Read and write the storage configuration.
//
// ONE row holds the settings for BOTH providers at once — the S3 fields (bucket, region,
// keys) and the local field (localDir) never collide — and `provider` records which one is
// live. That is what lets you enter and test S3 credentials while the filesystem is still
// serving, and only switch when the test passes.
//
// `provider` is deliberately NOT writable here. Switching the live provider repoints every
// future upload and is gated on `settings_storage.approve`, in the activate route.

const SettingsSchema = z.object({
  bucket: z.string().trim().max(200).nullish(),
  region: z.string().trim().max(60).nullish(),
  accessKeyId: z.string().trim().max(200).nullish(),
  // The GET below returns a mask. If the client sends the mask back untouched we keep the
  // stored value — otherwise opening the page and pressing Save would wipe the secret.
  secretAccessKey: z.string().trim().max(500).nullish(),
  publicBaseUrl: z.string().trim().max(500).nullish(),
  localDir: z.string().trim().max(500).nullish(),
});

const MASK_PREFIX = "••••";

function mask(secret: string | null): string | null {
  if (!secret) return null;
  return secret.length <= 4 ? MASK_PREFIX : MASK_PREFIX + secret.slice(-4);
}

function isMask(v: string | null | undefined): boolean {
  return typeof v === "string" && v.startsWith(MASK_PREFIX);
}

export async function GET() {
  try {
    await requireFeature("settings_storage", "view");

    const row = await prisma.storageConfig.findUnique({ where: { id: "singleton" } });

    return successResponse({
      provider: row?.provider ?? "LOCAL",
      bucket: row?.bucket ?? null,
      region: row?.region ?? null,
      accessKeyId: row?.accessKeyId ?? null,
      // NEVER the real key. This endpoint is reachable by anyone with settings_storage.view.
      secretAccessKey: mask(row?.secretAccessKey ?? null),
      hasSecret: !!row?.secretAccessKey,
      publicBaseUrl: row?.publicBaseUrl ?? null,
      localDir: row?.localDir ?? DEFAULT_LOCAL_DIR,
      isConnected: row?.isConnected ?? false,
      lastTestedAt: row?.lastTestedAt ?? null,
      lastTestError: row?.lastTestError ?? null,
      configured: !!row,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not read storage settings", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not read the storage settings", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireFeature("settings_storage", "edit");

    const parsed = SettingsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message || "Invalid settings", 400);
    }
    const input = parsed.data;

    const existing = await prisma.storageConfig.findUnique({ where: { id: "singleton" } });

    // A masked secret means "unchanged". An empty string means "clear it". A real value
    // replaces it.
    const secret = isMask(input.secretAccessKey)
      ? (existing?.secretAccessKey ?? null)
      : (input.secretAccessKey || null);

    const data = {
      bucket: input.bucket || null,
      region: input.region || null,
      accessKeyId: input.accessKeyId || null,
      secretAccessKey: secret,
      publicBaseUrl: input.publicBaseUrl?.replace(/\/+$/, "") || null,
      localDir: input.localDir || null,
      // Settings changed, so whatever the last test proved is no longer true. Forcing a
      // re-test is the point: isConnected must never be set by saving a form.
      isConnected: false,
      lastTestError: null,
    };

    const row = await prisma.storageConfig.upsert({
      where: { id: "singleton" },
      update: data,
      create: { id: "singleton", provider: existing?.provider ?? "LOCAL", ...data },
    });

    invalidateStorageCache();
    // Identifiers only — never the credentials themselves.
    log.info("storage settings saved", {
      userId: user.id,
      provider: row.provider,
      bucket: row.bucket,
      region: row.region,
      hasSecret: !!row.secretAccessKey,
    });

    return successResponse({ saved: true, provider: row.provider, isConnected: false });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not save storage settings", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Could not save", 500);
  }
}
