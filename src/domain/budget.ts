export interface BudgetLimits {
  maxUsdPerDay: number;
  maxCallsPerDay: number;
}

export interface SpendSoFar {
  usd: number;
  calls: number;
}

export type BudgetCheck = { allowed: true } | { allowed: false; reason: string };

// Checked before every AI call. Limits are per workspace per UTC day; blocked calls are not counted.
export function checkBudget(spent: SpendSoFar, limits: BudgetLimits): BudgetCheck {
  if (spent.calls >= limits.maxCallsPerDay) {
    return { allowed: false, reason: `daily call limit reached (${spent.calls}/${limits.maxCallsPerDay})` };
  }
  if (spent.usd >= limits.maxUsdPerDay) {
    return {
      allowed: false,
      reason: `daily budget reached ($${spent.usd.toFixed(4)} of $${limits.maxUsdPerDay.toFixed(2)})`,
    };
  }
  return { allowed: true };
}

export class BudgetExceededError extends Error {
  constructor(reason: string) {
    super(`AI budget guard: ${reason}`);
    this.name = "BudgetExceededError";
  }
}
