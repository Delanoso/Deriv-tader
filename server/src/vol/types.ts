import type { FocusWeightView, OutcomeBreakdown } from "../types.js";

export type VolSymbolId = "1HZ250V";

export const VOL_SYMBOLS: VolSymbolId[] = ["1HZ250V"];

export const VOL_DISPLAY: Record<VolSymbolId, string> = {
  "1HZ250V": "Volatility 250 · 1m",
};

export type VolBias = "up" | "down" | "neutral";

export interface VolTick {
  epoch: number;
  quote: number;
}

export interface VolCandle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface VolTargets {
  /** Primary target in the predicted direction. */
  target: number;
  /** Stretch / runner target. */
  stretch: number;
  /** Stop / invalidation level. */
  invalidation: number;
  /** Expected move size in % from entry to primary target. */
  expectedMovePct: number;
  /** Method used for levels. */
  method: string;
  /** Epoch for horizon ETA marker on the chart. */
  expectedEpoch?: number | null;
}

export interface VolPrediction {
  bias: VolBias;
  action: string;
  confidence: number;
  calibratedConfidence?: number;
  horizonTicks: number;
  targets: VolTargets;
  rationale: string[];
  riskNote: string;
}

export interface VolIndicators {
  rsi14: number | null;
  ema9: number | null;
  ema21: number | null;
  atr14: number | null;
  momentum20: number | null;
  swingHigh: number | null;
  swingLow: number | null;
}

export interface VolAnalysis {
  symbol: VolSymbolId;
  displayName: string;
  lastQuote: number | null;
  lastEpoch: number | null;
  ticksCollected: number;
  timeframe: {
    candleSec: number;
    minHoldTicks: number;
    horizonTicks: number;
  };
  indicators: VolIndicators;
  prediction: VolPrediction;
  candles: VolCandle[];
  recentTicks: VolTick[];
  updatedAt: number;
}

export type VolSignalStatus = "pending" | "win" | "loss" | "expired";

export interface VolJournalSignal {
  id: string;
  symbol: VolSymbolId;
  bias: Exclude<VolBias, "neutral">;
  confidence: number;
  entryPrice: number;
  entryEpoch: number;
  entryTickIndex: number;
  target: number;
  stretch: number;
  invalidation: number;
  horizonTicks: number;
  createdAt: number;
  status: VolSignalStatus;
  resolvedAt?: number;
  exitPrice?: number;
  exitEpoch?: number;
  returnPct?: number;
  returnNetPct?: number;
  winAfterCost?: boolean;
  costPctAssumed?: number;
  mfePct?: number;
  maePct?: number;
  hitTarget?: boolean;
  hitInvalidation?: boolean;
  outcome?: "spike" | "target" | "stopout" | "expired" | "open";
  note?: string;
  source: "live" | "bootstrap";
}

export interface VolKindStats {
  total: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number | null;
  avgReturnPct: number | null;
  winsAfterCost: number;
  lossesAfterCost: number;
  winRateAfterCost: number | null;
  avgReturnNetPct: number | null;
  expectancyNetPct: number | null;
  avgMfePct: number | null;
  avgMaePct: number | null;
  targetHitRate: number | null;
  decayWinRateAfterCost: number | null;
  decayExpectancyNetPct: number | null;
  decayEffectiveN: number;
}

export interface VolFocusMap {
  byBias: Partial<Record<"up" | "down", FocusWeightView>>;
  rows: FocusWeightView[];
  preferred: "up" | "down" | null;
}

export interface VolLearningSummary {
  totalSignals: number;
  pending: number;
  resolved: number;
  overallWinRate: number | null;
  targetHitRate: number | null;
  costPctAssumed: number;
  byBias: {
    up: VolKindStats;
    down: VolKindStats;
  };
  outcomes: OutcomeBreakdown;
  outcomesByBias: {
    up: OutcomeBreakdown;
    down: OutcomeBreakdown;
  };
  insights: string[];
  focus: VolFocusMap;
  recent: VolJournalSignal[];
  calibrated: Partial<Record<"up" | "down", number>>;
  updatedAt: number;
}

export interface VolSnapshot {
  connected: boolean;
  analysis: VolAnalysis | null;
  learning: VolLearningSummary;
}
