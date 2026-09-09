// The Test button behind Settings → AI. It reads the row it is asked about — not the active
// one, and not through the resolver's cache — because the admin is testing the key they
// just saved, which may belong to a provider that is not live yet. It never throws and it
// never writes: the route records the outcome on the row.
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { getAdapter } from "./adapters";
import { AI_PROVIDERS, defaultModelOf, type AiProviderKey } from "./models";
import { AiError } from "./types";

const log = createLogger("ai:self-test");

export interface AiSelfTestResult {
  ok: boolean;
  error?: string;
  model: string;
  latencyMs: number;
}

/** What the admin reads under the button. Written for a person, not a log file. */
function describe(error: unknown): string {
  if (error instanceof AiError) {
    switch (error.kind) {
      case "auth":
        return "The API key was rejected";
      case "rate_limit":
        return "Rate limited by the provider — try again in a minute";
      case "overloaded":
        return "The provider is overloaded — try again in a minute";
      case "network":
        return "Could not reach the provider";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export async function runAiSelfTest(provider: AiProviderKey): Promise<AiSelfTestResult> {
  const label = AI_PROVIDERS[provider].label;
  const started = Date.now();
  let model = defaultModelOf(provider);

  try {
    const row = await prisma.aiProvider.findUnique({ where: { key: provider } });
    model = row?.model ?? model;

    if (!row?.apiKey) {
      log.warn("self-test with no key saved", { provider });
      return { ok: false, error: `No API key is saved for ${label}`, model, latencyMs: Date.now() - started };
    }

    log.debug("-> self-test", { provider, model });
    // Any completion passes — the point is that the key and model answered at all. The cap
    // is 256 rather than a handful because on Opus 5 / Sonnet 5 adaptive thinking spends
    // from the same budget; a 16-token cap would stop on max_tokens before a word came out.
    // That would still count as an answer — only the resolver refuses those — but a real
    // "OK" costs nothing extra and reads better in the log.
    await getAdapter(provider).complete(
      { purpose: "settings.self_test", prompt: "Reply with the single word OK.", maxTokens: 256 },
      { apiKey: row.apiKey, model },
    );

    const latencyMs = Date.now() - started;
    log.info("self-test passed", { provider, model, latencyMs });
    return { ok: true, model, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - started;
    log.error("self-test failed", {
      provider,
      model,
      latencyMs,
      kind: error instanceof AiError ? error.kind : undefined,
      status: error instanceof AiError ? error.status : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: describe(error), model, latencyMs };
  }
}
