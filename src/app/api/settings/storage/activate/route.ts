export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { isStorageProviderKey, invalidateStorageCache } from "@/lib/storage";
import { runStorageTest } from "@/lib/storage/self-test";

const log = createLogger("settings:storage:activate");

// Switch the live storage provider.
//
// Gated on `approve`, not `edit`: fixing a typo in a bucket name and repointing where every
// future photo in the company is written are different-sized decisions, and this codebase
// expresses that distinction as a permission rather than as a role name.
//
// The test is re-run here rather than trusting an earlier one. A stored isConnected could
// be minutes or weeks old, and the credentials may have been rotated since — activating on
// stale evidence is how uploads start failing silently.
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("settings_storage", "approve");

    const body = await req.json().catch(() => null);
    const provider = body?.provider;
    if (!isStorageProviderKey(provider)) {
      return errorResponse("Choose a provider to activate: S3 or LOCAL", 400);
    }

    log.info("activation requested", { userId: user.id, provider });

    const result = await runStorageTest(provider);
    if (!result.ok) {
      // Record the failure so the screen can explain it, but do NOT switch.
      await prisma.storageConfig.upsert({
        where: { id: "singleton" },
        update: { lastTestedAt: new Date(), lastTestError: result.error ?? "Test failed" },
        create: {
          id: "singleton",
          provider: "LOCAL",
          lastTestedAt: new Date(),
          lastTestError: result.error ?? "Test failed",
        },
      });
      log.warn("activation refused — the provider failed its test", { provider });
      return errorResponse(
        result.error || "That provider failed its connection test, so it was not activated.",
        400
      );
    }

    const row = await prisma.storageConfig.upsert({
      where: { id: "singleton" },
      update: { provider, isConnected: true, lastTestedAt: new Date(), lastTestError: null },
      create: {
        id: "singleton",
        provider,
        isConnected: true,
        lastTestedAt: new Date(),
        lastTestError: null,
      },
    });

    invalidateStorageCache();
    log.info("live storage provider switched", { userId: user.id, provider: row.provider });

    return successResponse({
      activated: true,
      provider: row.provider,
      steps: result.steps,
      // Said plainly because it surprises people: existing files are NOT moved. Stored URLs
      // are absolute, so old media keeps loading from wherever it was written.
      note: "New uploads go to this provider. Files already stored stay where they are and keep working.",
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("activation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Could not activate", 500);
  }
}
