export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { isAiProviderKey, invalidateAiCache, runAiSelfTest } from "@/lib/ai";

const log = createLogger("settings:ai:test");

// One real call against the saved key and model. Changes nothing except the test result on
// the row — switching the live provider is a separate, more privileged action (../activate).
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("settings_ai", "edit");

    const body = await req.json().catch(() => null);
    const provider = body?.provider;
    if (!isAiProviderKey(provider)) {
      return errorResponse("Choose a provider to test: anthropic, google or openai", 400);
    }

    log.info("ai test requested", { userId: user.id, provider });
    const result = await runAiSelfTest(provider);

    const row = await prisma.aiProvider.findUnique({ where: { key: provider } });

    // isConnected describes THE LIVE PROVIDER, so only a test of the live provider may set
    // it. Testing OpenAI while Anthropic is answering must not make the app claim the live
    // provider is healthy — or unhealthy.
    const testedLive = row?.isActive === true;

    // A test NEVER creates a row. With nothing saved the result already says so ("No API key
    // is saved for …"), and a row made here would be keyless — which matters more than it
    // looks: the resolver seeds anthropic from ANTHROPIC_API_KEY only while the table is
    // EMPTY, so a test-before-save on a fresh deploy would switch the env bootstrap off for
    // good and leave every AI feature at 501 until someone pasted the key by hand.
    if (row) {
      await prisma.aiProvider.update({
        where: { key: provider },
        data: {
          lastTestedAt: new Date(),
          lastTestError: result.ok ? null : (result.error ?? "Test failed"),
          ...(testedLive ? { isConnected: result.ok } : {}),
        },
      });
    }

    if (testedLive) invalidateAiCache();

    log.info("ai test finished", {
      userId: user.id,
      provider,
      model: result.model,
      ok: result.ok,
      latencyMs: result.latencyMs,
      testedLive,
      // false = nothing saved for this provider, so the outcome was not written anywhere
      recorded: row !== null,
    });

    return successResponse({
      ok: result.ok,
      provider,
      model: result.model,
      latencyMs: result.latencyMs,
      error: result.error ?? null,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    // Name and code only, never the message — see the PUT catch in ../route.ts.
    log.error("ai test failed to run", {
      name: error instanceof Error ? error.name : "unknown",
      code: (error as { code?: string }).code,
    });
    return errorResponse("The test could not run", 500);
  }
}
