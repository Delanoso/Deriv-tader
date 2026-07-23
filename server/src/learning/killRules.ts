import type { KindStats, SymbolId } from "../types.js";

export interface KillRuleConfig {
  minSamples: number;
  minWinRateAfterCost: number;
  /** Kill when decay/flat expectancy is below this (percent points). */
  minExpectancyNetPct: number;
}

export const DEFAULT_KILL: KillRuleConfig = {
  minSamples: Number(process.env.KILL_MIN_SAMPLES || 50),
  minWinRateAfterCost: Number(process.env.KILL_MIN_WR || 0.45),
  minExpectancyNetPct: Number(process.env.KILL_MIN_EXPECTANCY || 0),
};

export interface KillStatus {
  killed: boolean;
  reason: string | null;
  liveSamples: number;
  liveWinRateAfterCost: number | null;
  liveExpectancyNetPct: number | null;
  thresholdSamples: number;
  thresholdWinRateAfterCost: number;
  /** Soft warning before hard kill. */
  warning: boolean;
}

export function evaluateKillRule(
  spikeStats: KindStats | undefined,
  cfg: KillRuleConfig = DEFAULT_KILL,
): KillStatus {
  const samples = spikeStats
    ? spikeStats.winsAfterCost + spikeStats.lossesAfterCost
    : 0;
  const wr = spikeStats?.winRateAfterCost ?? null;
  const exp =
    spikeStats?.decayExpectancyNetPct ?? spikeStats?.expectancyNetPct ?? null;
  const effN = Math.max(samples, spikeStats?.decayEffectiveN ?? 0);

  if (!spikeStats || samples === 0) {
    return {
      killed: false,
      reason: null,
      liveSamples: 0,
      liveWinRateAfterCost: null,
      liveExpectancyNetPct: null,
      thresholdSamples: cfg.minSamples,
      thresholdWinRateAfterCost: cfg.minWinRateAfterCost,
      warning: false,
    };
  }

  const wrBad = wr != null && wr < cfg.minWinRateAfterCost;
  const expBad = exp != null && exp < cfg.minExpectancyNetPct;
  const warnSamples = Math.max(15, Math.floor(cfg.minSamples / 2));

  const warning =
    (samples >= warnSamples && wrBad) ||
    (effN >= warnSamples && expBad);

  if (samples >= cfg.minSamples && wrBad) {
    return {
      killed: true,
      reason: `Kill rule: live spike-hunt after-cost WR ${(wr! * 100).toFixed(1)}% < ${(cfg.minWinRateAfterCost * 100).toFixed(0)}% over ${samples} decisions.`,
      liveSamples: samples,
      liveWinRateAfterCost: wr,
      liveExpectancyNetPct: exp,
      thresholdSamples: cfg.minSamples,
      thresholdWinRateAfterCost: cfg.minWinRateAfterCost,
      warning: true,
    };
  }

  if (effN >= cfg.minSamples && expBad) {
    return {
      killed: true,
      reason: `Kill rule: live expectancy ${exp!.toFixed(3)}% < ${cfg.minExpectancyNetPct.toFixed(3)}% (decay-weighted n≈${effN.toFixed(0)}).`,
      liveSamples: samples,
      liveWinRateAfterCost: wr,
      liveExpectancyNetPct: exp,
      thresholdSamples: cfg.minSamples,
      thresholdWinRateAfterCost: cfg.minWinRateAfterCost,
      warning: true,
    };
  }

  return {
    killed: false,
    reason: null,
    liveSamples: samples,
    liveWinRateAfterCost: wr,
    liveExpectancyNetPct: exp,
    thresholdSamples: cfg.minSamples,
    thresholdWinRateAfterCost: cfg.minWinRateAfterCost,
    warning,
  };
}

export type KillMap = Partial<Record<SymbolId, KillStatus>>;
