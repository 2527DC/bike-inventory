// Provider key → adapter. Adding a provider is an entry in models.ts, an adapter file, and
// one line here; the schema does not change.
import type { AiProviderKey } from "./models";
import type { AiAdapter } from "./types";
import { anthropicAdapter } from "./anthropic";
import { googleAdapter } from "./google";
import { openaiAdapter } from "./openai";

const ADAPTERS: Record<AiProviderKey, AiAdapter> = {
  anthropic: anthropicAdapter,
  google: googleAdapter,
  openai: openaiAdapter,
};

export function getAdapter(key: AiProviderKey): AiAdapter {
  return ADAPTERS[key];
}
