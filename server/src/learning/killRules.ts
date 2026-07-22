import type { KindStats, SymbolId } from "../types.js";

export interface KillRuleConfig {
  minSamples: number;
  minWinRateAfterCost: number;
}

export const DEFAULT_KILL: KillRuleConfig = {
  minSamples: Number(process.env.KILL_MIN_SAMPLES || 50),
  minWinRateAfterCost: Number(process.env.KILL_MIN_WR || 0.45),
};

export interface KillStatus {
  killed: boolean;
  reason: string | null;
  liveSamples: number;
  liveWinRateAfterCost: number | null;
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

  if (!spikeStats || samples === 0) {
    return {
      killed: false,
      reason: null,
      liveSamples: 0,
      liveWinRateAfterCost: null,
      thresholdSamples: cfg.minSamples,
      thresholdWinRateAfterCost: cfg.minWinRateAfterCost,
      warning: false,
    };
  }

  const warning =
    samples >= Math.max(15, Math.floor(cfg.minSamples / 2)) &&
    wr != null &&
    wr < cfg.minWinRateAfterCost;

  if (samples >= cfg.minSamples && wr != null && wr < cfg.minWinRateAfterCost) {
    return {
      killed: true,
      reason: `Kill rule: live spike-hunt after-cost WR ${(wr * 100).toFixed(1)}% < ${(cfg.minWinRateAfterCost * 100).toFixed(0)}% over ${samples} decisions.`,
      liveSamples: samples,
      liveWinRateAfterCost: wr,
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
    thresholdSamples: cfg.minSamples,
    thresholdWinRateAfterCost: cfg.minWinRateAfterCost,
    warning,
  };
}

export type KillMap = Partial<Record<SymbolId, KillStatus>>;
