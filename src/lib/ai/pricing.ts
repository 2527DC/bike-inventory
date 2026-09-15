// Token pricing rates per million (1M) tokens.
// Source: Provider pricing as of September 2026.

export interface ModelRate {
  inputPer1M: number;  // in USD
  outputPer1M: number; // in USD
}

export const USD_TO_INR_RATE = 85.0;

export const MODEL_PRICING: Record<string, ModelRate> = {
  // Anthropic
  "claude-opus-5": { inputPer1M: 5.0, outputPer1M: 25.0 },
  "claude-sonnet-5": { inputPer1M: 2.0, outputPer1M: 10.0 },
  "claude-haiku-4-5": { inputPer1M: 1.0, outputPer1M: 5.0 },

  // Google
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 5.0 },
  "gemini-3.8-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },
  "gemini-3.5-flash-lite": { inputPer1M: 0.0375, outputPer1M: 0.15 },

  // OpenAI
  "gpt-6-astra": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "gpt-5.6-terra": { inputPer1M: 1.25, outputPer1M: 5.0 },
  "gpt-5.6-luna": { inputPer1M: 0.15, outputPer1M: 0.6 },
};

// Default fallback if a model is not listed (assumes mid-tier rates)
const DEFAULT_FALLBACK_RATE: ModelRate = {
  inputPer1M: 1.0,
  outputPer1M: 5.0,
};

/**
 * Calculate estimated cost in USD and INR for given token counts.
 * Round to 6 decimal places for USD, 4 decimal places for INR.
 */
export function calculateAiCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): { costUsd: number; costInr: number } {
  const rate = MODEL_PRICING[model] ?? DEFAULT_FALLBACK_RATE;

  const costUsd =
    (Math.max(0, inputTokens) * rate.inputPer1M +
      Math.max(0, outputTokens) * rate.outputPer1M) /
    1_000_000;

  const costInr = costUsd * USD_TO_INR_RATE;

  return {
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    costInr: Math.round(costInr * 10_000) / 10_000,
  };
}
