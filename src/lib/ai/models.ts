// The AI provider and model catalogue. THE ONLY PLACE A MODEL ID IS WRITTEN DOWN.
//
// Configuration lives in the database (AiProvider rows) but the set of things an admin may
// choose from is declared here, exactly as prisma/rbac-catalog.ts declares modules and the
// database holds grants. A typo'd model id is a 400 mid-upload in front of a user, so the
// settings screen offers a dropdown built from this list and the PUT route validates
// against it with isModelOf() — the dropdown is cosmetic, the route is the gate.
//
// Adding a model is one line here plus a redeploy. Adding a provider is an entry here plus
// an adapter in this directory; the schema needs no change.

export interface AiModelInfo {
  id: string;
  label: string;
}

export interface AiProviderInfo {
  label: string;
  models: readonly AiModelInfo[];
  /** Seeded into a fresh row and used by the env-var bootstrap. Must be one of `models`. */
  defaultModel: string;
  /** What the adapter can attach to a request. Checked before the call, not discovered by it. */
  supports: { pdf: boolean; image: boolean };
  /** Shown as the key input's placeholder so an admin can tell they pasted the right thing. */
  keyHint: string;
  /** Where to mint a key. */
  keyUrl: string;
}

export const AI_PROVIDER_KEYS = ["anthropic", "google", "openai"] as const;
export type AiProviderKey = (typeof AI_PROVIDER_KEYS)[number];

export const AI_PROVIDERS: Record<AiProviderKey, AiProviderInfo> = {
  anthropic: {
    label: "Anthropic (Claude)",
    models: [
      { id: "claude-opus-5", label: "Claude Opus 5 — most capable (default)" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest, cheapest" },
    ],
    defaultModel: "claude-opus-5",
    supports: { pdf: true, image: true },
    keyHint: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  google: {
    label: "Google (Gemini)",
    // Confirmed against https://ai.google.dev/gemini-api/docs/models and /docs/pricing on
    // 8 Sep 2026. 2.5 Pro is the only stable Pro (3.1 Pro is preview-only); 3.8 Flash is the
    // page's primary recommendation and the newest stable model. Gemini accepts an inline
    // PDF the same way as an inline image, so supports.pdf holds for all three.
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro — most capable" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash — balanced (default)" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite — fastest, cheapest" },
    ],
    defaultModel: "gemini-3.8-flash",
    supports: { pdf: true, image: true },
    keyHint: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  openai: {
    label: "OpenAI",
    // Confirmed against https://developers.openai.com/api/docs/models and /docs/pricing on
    // 8 Sep 2026, and cross-checked against the model-id union shipped in openai@7.10.0.
    // gpt-5 / gpt-5-mini / gpt-5-nano still exist but are two generations behind.
    models: [
      { id: "gpt-6-astra", label: "GPT-6 Astra — most capable" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra — balanced (default)" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna — fastest, cheapest" },
    ],
    defaultModel: "gpt-5.6-terra",
    // The Responses API accepts an inline base64 PDF (input_file.file_data); chat
    // completions does not. The adapter uses the Responses API for exactly this reason.
    supports: { pdf: true, image: true },
    keyHint: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
  },
};

export function isAiProviderKey(v: unknown): v is AiProviderKey {
  return typeof v === "string" && (AI_PROVIDER_KEYS as readonly string[]).includes(v);
}

export function isModelOf(provider: AiProviderKey, model: string): boolean {
  return AI_PROVIDERS[provider].models.some((m) => m.id === model);
}

/** The model to use for a row that has none saved — the provider's declared default. */
export function defaultModelOf(provider: AiProviderKey): string {
  return AI_PROVIDERS[provider].defaultModel;
}
