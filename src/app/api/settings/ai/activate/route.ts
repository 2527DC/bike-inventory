export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { AI_PROVIDERS, isAiProviderKey, invalidateAiCache, runAiSelfTest } from "@/lib/ai";

const log = createLogger("settings:ai:activate");

// Thrown from inside the activation transaction when the row's key is gone, so the catch can
// tell "nothing left to go live with" apart from a database failure.
class KeyRemovedError extends Error {
  constructor() {
    super("api key removed during activation");
    this.name = "KeyRemovedError";
  }
}

// Switch the live AI provider.
//
// Gated on `approve`, not `edit`: pasting a key and repointing every statement parse,
// screenshot scan and catalogue import in the company are different-sized decisions, and
// this codebase expresses that distinction as a permission rather than as a role name.
//
// The test is re-run here rather than trusting an earlier one. A stored isConnected could
// be minutes or weeks old, and the key may have been revoked since — activating on stale
// evidence is how uploads start failing silently.
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("settings_ai", "approve");

    const body = await req.json().catch(() => null);
    const provider = body?.provider;
    if (!isAiProviderKey(provider)) {
      return errorResponse("Choose a provider to make live: anthropic, google or openai", 400);
    }
    const label = AI_PROVIDERS[provider].label;

    const row = await prisma.aiProvider.findUnique({ where: { key: provider } });
    if (!row?.apiKey) {
      return errorResponse(`Save an API key for ${label} before making it live`, 400);
    }

    log.info("activation requested", { userId: user.id, provider });

    const result = await runAiSelfTest(provider);
    if (!result.ok) {
      // Record the failure so the screen can explain it, but do NOT switch.
      await prisma.aiProvider.update({
        where: { key: provider },
        data: { lastTestedAt: new Date(), lastTestError: result.error ?? "Test failed" },
      });
      log.warn("activation refused — the provider failed its test", {
        userId: user.id,
        provider,
        model: result.model,
      });
      return errorResponse(
        `${label} failed the test: ${result.error ?? "Test failed"}. The live provider was not changed.`,
        400
      );
    }

    // One transaction, so there is never a moment with two live rows or none: the resolver
    // reads "the active row", and two of them would make the answer depend on row order.
    //
    // Interactive rather than a batch, because the flip is CONDITIONAL on the key still
    // being there. The key check above ran before the self-test, and a "remove key" save
    // can land in that gap; a plain update would then go live on a keyless row — the screen
    // saying Live while every AI feature answers 501.
    try {
      await prisma.$transaction(async (tx) => {
        const flipped = await tx.aiProvider.updateMany({
          where: { key: provider, apiKey: { not: null } },
          data: {
            isActive: true,
            isConnected: true,
            lastTestedAt: new Date(),
            lastTestError: null,
            updatedById: user.id,
          },
        });
        if (flipped.count === 0) throw new KeyRemovedError();
        await tx.aiProvider.updateMany({
          where: { isActive: true, NOT: { key: provider } },
          data: { isActive: false },
        });
      });
    } catch (error) {
      if (!(error instanceof KeyRemovedError)) throw error;
      log.warn("activation refused — the key was removed while the test ran", {
        userId: user.id,
        provider,
      });
      return errorResponse(
        `The ${label} key was removed while it was being activated. Save it again.`,
        409
      );
    }

    invalidateAiCache();
    log.info("ai provider activated", { userId: user.id, provider, model: result.model });

    return successResponse({ activeProvider: provider });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    // Name and code only, never the message — see the PUT catch in ../route.ts.
    log.error("activation failed", {
      name: error instanceof Error ? error.name : "unknown",
      code: (error as { code?: string }).code,
    });
    return errorResponse("Could not activate the provider", 500);
  }
}
