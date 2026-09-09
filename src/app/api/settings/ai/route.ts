export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import type { AiProvider } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import {
  AI_PROVIDERS,
  AI_PROVIDER_KEYS,
  isAiProviderKey,
  isModelOf,
  defaultModelOf,
  invalidateAiCache,
  loadActiveAiSettings,
  type AiProviderKey,
} from "@/lib/ai";

const log = createLogger("settings:ai");

// Read and write the AI provider configuration.
//
// ONE row per provider (anthropic, google, openai), each holding its own key and model, and
// `isActive` records which one is live. That is what lets you paste and test an OpenAI key
// while Anthropic is still answering every request, and only switch when the test passes.
//
// `isActive` is deliberately NOT writable here. Switching the live provider repoints every
// statement parse, screenshot scan and catalogue import in the company and is gated on
// `settings_ai.approve`, in the activate route.

const SettingsSchema = z.object({
  provider: z.string(),
  // Absent or empty means "keep the stored model". A model is never wiped by a save — a row
  // with no model falls back to the provider's declared default anyway.
  model: z.string().trim().max(200).nullish(),
  // Absent or empty means "keep the stored key" — the integrations contract, not storage's
  // mask. The GET below never returns the key in any form, so there is nothing for the
  // client to echo back; a non-empty value replaces it, and `clearApiKey` removes it.
  apiKey: z.string().trim().max(500).nullish(),
  clearApiKey: z.boolean().optional(),
});

// The wire shape of one provider. Built field by field on purpose: the row is never spread
// into the response, so `apiKey` cannot leak by accident when a column is added later.
function providerEntry(key: AiProviderKey, row: AiProvider | null | undefined) {
  const info = AI_PROVIDERS[key];
  return {
    key,
    label: info.label,
    model: row?.model ?? null,
    defaultModel: info.defaultModel,
    models: info.models.map((m) => ({ id: m.id, label: m.label })),
    // NEVER the real key — not masked, not its last four characters, nothing. This endpoint
    // is reachable by anyone with settings_ai.view. A boolean is all the screen needs.
    hasApiKey: !!row?.apiKey,
    isActive: row?.isActive ?? false,
    isConnected: row?.isConnected ?? false,
    lastTestedAt: row?.lastTestedAt ?? null,
    lastTestError: row?.lastTestError ?? null,
    supports: info.supports,
    keyHint: info.keyHint,
    keyUrl: info.keyUrl,
  };
}

export async function GET() {
  try {
    await requireFeature("settings_ai", "view");

    let rows = await prisma.aiProvider.findMany();
    if (rows.length === 0) {
      // The first view of this screen is where the env bootstrap must happen. The resolver
      // seeds an anthropic row from ANTHROPIC_API_KEY only while the table is empty (and
      // does nothing when the variable is unset), so reading `findMany` alone would tell the
      // admin "no provider is live" on a fresh deploy where `runAi` would answer fine — and
      // the first save or test after that would create a row and end the bootstrap for good.
      await loadActiveAiSettings();
      rows = await prisma.aiProvider.findMany();
    }
    const byKey = new Map(rows.map((r) => [r.key, r]));

    // Every catalogued provider appears, in catalogue order, whether or not it has a row —
    // the screen is a fixed list of cards, not a list of whatever happens to be saved.
    const providers = AI_PROVIDER_KEYS.map((key) => providerEntry(key, byKey.get(key)));
    const active = rows.find((r) => r.isActive);

    return successResponse({
      providers,
      activeProvider: active && isAiProviderKey(active.key) ? active.key : null,
      configured: rows.length > 0,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not read ai settings", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not read the AI settings", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireFeature("settings_ai", "edit");

    const parsed = SettingsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message || "Invalid settings", 400);
    }
    const input = parsed.data;

    const provider = input.provider;
    if (!isAiProviderKey(provider)) return errorResponse("Unknown AI provider", 400);
    const label = AI_PROVIDERS[provider].label;

    // The dropdown is cosmetic; this is the gate. A typo'd model id would otherwise surface
    // as a 400 from the provider mid-upload, in front of whoever is parsing a statement.
    if (input.model && !isModelOf(provider, input.model)) {
      return errorResponse(`Unknown model for ${label}`, 400);
    }

    const existing = await prisma.aiProvider.findUnique({ where: { key: provider } });

    // `clearApiKey` wins outright. Otherwise a blank key means keep what is stored and a
    // real value replaces it.
    const apiKey = input.clearApiKey ? null : input.apiKey || existing?.apiKey || null;
    if (input.clearApiKey && existing?.isActive) {
      // Not refused — an admin may need to pull a leaked key immediately — but said loudly,
      // because every AI feature now fails until another provider is made live.
      log.warn("api key removed from the LIVE provider — ai features stop until another is activated", {
        userId: user.id,
        provider,
      });
    }

    const model = input.model || existing?.model || null;

    const data = {
      apiKey,
      model,
      updatedById: user.id,
      // Settings changed, so whatever the last test proved is no longer true. Forcing a
      // re-test is the point: isConnected must never be set by saving a form.
      isConnected: false,
      lastTestError: null,
    };

    const row = await prisma.aiProvider.upsert({
      where: { key: provider },
      update: data,
      // A fresh row gets the provider's declared default model, as models.ts promises.
      create: { key: provider, ...data, model: model ?? defaultModelOf(provider) },
    });

    invalidateAiCache();
    // Identifiers only — never the key itself. `apiSaved`, not `hasApiKey`: the logger's
    // redact() blanks any context key that contains "key", and a boolean is the whole point
    // of the line.
    log.info("ai settings saved", {
      userId: user.id,
      provider,
      model: row.model,
      apiSaved: !!row.apiKey,
    });

    return successResponse(providerEntry(provider, row));
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    // Never `error.message` here — not on the wire, not in the log. A
    // PrismaClientValidationError embeds the invocation `data` in its message, and in this
    // route that data is the API key in plain text. This catch is the one path by which the
    // key could reach a browser or a log line; the error's name and code are enough to find
    // the fault without it.
    log.error("could not save ai settings", {
      name: error instanceof Error ? error.name : "unknown",
      code: (error as { code?: string }).code,
    });
    return errorResponse("Could not save the AI settings", 500);
  }
}
