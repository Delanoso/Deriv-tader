import type { SymbolAnalysis } from "../types.js";

export type AgeRegime = "early" | "mid" | "late" | "overdue";
export type RsiRegime = "oversold" | "neutral" | "overbought";

export interface TradeRegime {
  ageRegime: AgeRegime;
  rsiRegime: RsiRegime;
  ageRatio: number | null;
  weibullShape: number | null;
  timingEdgeWeak: boolean;
  rsi14: number | null;
  hourUtc: number;
  pSpike500: number | null;
  stopPct: number | null;
}

export function ageRegimeFromRatio(ratio: number | null): AgeRegime {
  if (ratio == null) return "mid";
  if (ratio < 0.45) return "early";
  if (ratio < 0.85) return "mid";
  if (ratio < 1.25) return "late";
  return "overdue";
}

export function rsiRegimeFromValue(rsi: number | null): RsiRegime {
  if (rsi == null) return "neutral";
  if (rsi < 35) return "oversold";
  if (rsi > 65) return "overbought";
  return "neutral";
}

export function crossRegimeKey(age: AgeRegime, rsi: RsiRegime): string {
  return `${age}|${rsi}`;
}

export function buildRegime(analysis: SymbolAnalysis): TradeRegime {
  const mean = analysis.reliability.meanInterSpikeTicks;
  const since = analysis.ticksSinceLastSpike;
  const ageRatio =
    mean != null && mean > 0 && since != null ? Number((since / mean).toFixed(3)) : null;
  const p500 =
    analysis.forecast?.horizons.find((h) => h.horizonTicks === 500)?.probability ??
    null;
  const stopPct =
    analysis.spikePlan != null && analysis.lastQuote
      ? Number(
          (
            (Math.abs(analysis.spikePlan.invalidation - analysis.lastQuote) /
              analysis.lastQuote) *
            100
          ).toFixed(4),
        )
      : null;
  const rsi14 = analysis.indicators.rsi14;

  return {
    ageRegime: ageRegimeFromRatio(ageRatio),
    rsiRegime: rsiRegimeFromValue(rsi14),
    ageRatio,
    weibullShape: analysis.reliability.weibullShapeApprox,
    timingEdgeWeak: analysis.forecast?.timingEdgeWeak ?? true,
    rsi14,
    hourUtc: new Date().getUTCHours(),
    pSpike500: p500,
    stopPct,
  };
}
