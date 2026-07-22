export type VolSymbolId = "1HZ250V";

export const VOL_SYMBOLS: VolSymbolId[] = ["1HZ250V"];

export const VOL_DISPLAY: Record<VolSymbolId, string> = {
  "1HZ250V": "Volatility 250 (1s)",
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
  avgMfePct: number | null;
  avgMaePct: number | null;
  targetHitRate: number | null;
}

export interface VolLearningSummary {
  totalSignals: number;
  pending: number;
  resolved: number;
  overallWinRate: number | null;
  targetHitRate: number | null;
  byBias: {
    up: VolKindStats;
    down: VolKindStats;
  };
  recent: VolJournalSignal[];
  calibrated: Partial<Record<"up" | "down", number>>;
  updatedAt: number;
}

export interface VolSnapshot {
  connected: boolean;
  analysis: VolAnalysis | null;
  learning: VolLearningSummary;
}
