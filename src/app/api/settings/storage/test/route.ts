export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { isStorageProviderKey, invalidateStorageCache } from "@/lib/storage";
import { runStorageTest } from "@/lib/storage/self-test";

const log = createLogger("settings:storage:test");

// Dry run against the saved settings. Changes nothing except the test result on the row —
// switching the live provider is a separate, more privileged action (../activate).
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("settings_storage", "edit");

    const body = await req.json().catch(() => null);
    const provider = body?.provider;
    if (!isStorageProviderKey(provider)) {
      return errorResponse("Choose a provider to test: S3 or LOCAL", 400);
    }

    log.info("storage test requested", { userId: user.id, provider });
    // The Origin header is where the browser running this test lives, which is exactly the
    // origin a real upload would need the bucket to allow. Passing it turns the CORS step
    // from a guess into a check.
    const result = await runStorageTest(provider, req.headers.get("origin"));

    const row = await prisma.storageConfig.findUnique({ where: { id: "singleton" } });

    // isConnected describes THE LIVE PROVIDER, so only a test of the live provider may set
    // it. Testing S3 while the filesystem is serving must not make the app claim the live
    // provider is healthy.
    const testedLive = row?.provider === provider;

    await prisma.storageConfig.upsert({
      where: { id: "singleton" },
      update: {
        lastTestedAt: new Date(),
        lastTestError: result.ok ? null : (result.error ?? "Test failed"),
        ...(testedLive ? { isConnected: result.ok } : {}),
      },
      create: {
        id: "singleton",
        provider,
        lastTestedAt: new Date(),
        lastTestError: result.ok ? null : (result.error ?? "Test failed"),
        isConnected: result.ok,
      },
    });

    if (testedLive) invalidateStorageCache();

    return successResponse({
      ok: result.ok,
      provider: result.provider,
      steps: result.steps,
      error: result.error,
      testedLiveProvider: testedLive,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("storage test failed to run", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Test failed to run", 500);
  }
}
