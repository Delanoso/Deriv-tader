/**
 * Round-trip cost assumption in percent points (e.g. 0.02 = 2 bps).
 * Override with COST_PCT_ROUND_TRIP env (still in percent points).
 */
export const DEFAULT_COST_PCT = Number(process.env.COST_PCT_ROUND_TRIP || 0.02);

export function netReturnPct(
  grossReturnPct: number,
  costPct = DEFAULT_COST_PCT,
): number {
  return Number((grossReturnPct - costPct).toFixed(5));
}

export function withCostFields(grossReturnPct: number, costPct = DEFAULT_COST_PCT) {
  const net = netReturnPct(grossReturnPct, costPct);
  return {
    returnPct: grossReturnPct,
    returnNetPct: net,
    winAfterCost: net > 0,
    costPctAssumed: costPct,
  };
}
