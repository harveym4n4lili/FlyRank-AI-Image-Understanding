// Notional list prices (USD per 1M tokens) used for cost tracking and the budget guard.
// The free tier bills $0 — that is logged separately as billed_usd — but every call still gets a
// realistic price so the budget guard has something to enforce. Verify against the Gemini pricing
// page when changing models; unknown models fall back to DEFAULT_PRICE.
export interface ModelPrice {
  inputPerM: number;
  outputPerM: number; // thinking tokens are billed as output
}

const PRICES: Record<string, ModelPrice> = {
  "gemini-3.8-flash": { inputPerM: 0.3, outputPerM: 2.5 },
  "gemini-embedding-2": { inputPerM: 0.15, outputPerM: 0 },
};

const DEFAULT_PRICE: ModelPrice = { inputPerM: 0.5, outputPerM: 3 };

export function priceFor(model: string): ModelPrice {
  return PRICES[model] ?? DEFAULT_PRICE;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceFor(model);
  return (inputTokens * price.inputPerM + outputTokens * price.outputPerM) / 1_000_000;
}
