export type SymbolId =
  | "BOOM300N"
  | "BOOM900"
  | "BOOM1000"
  | "CRASH300N"
  | "CRASH900"
  | "CRASH1000";

export interface Tick {
  epoch: number;
  quote: number;
}

export interface Candle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SpikeEvent {
  index: number;
  epoch: number;
  quote: number;
  magnitude: number;
  ticksSincePrevious: number | null;
}

export type Bias = "bullish" | "bearish" | "neutral";
export type OpportunityKind =
  | "drift_follow"
  | "spike_watch"
  | "post_spike"
  | "stand_aside";

export interface TradeOpportunity {
  kind: OpportunityKind;
  bias: Bias;
  action: string;
  confidence: number;
  calibratedConfidence?: number;
  rationale: string[];
  riskNote: string;
}

export interface HorizonProb {
  horizonTicks: number;
  probability: number | null;
  survivors: number;
  hits: number;
  fallback?: boolean;
}

export interface HazardBin {
  ageFrom: number;
  ageTo: number;
  hazard: number | null;
  survivors: number;
  events: number;
}

export interface SpikeForecast {
  ticksSinceLastSpike: number | null;
  gapSampleSize: number;
  meanGap: number | null;
  medianGap: number | null;
  horizons: HorizonProb[];
  bestHorizon: HorizonProb | null;
  hazardCurve: HazardBin[];
  timingEdgeWeak: boolean;
  timingNote: string;
}

export interface SpikePlan {
  spikeTarget: number;
  stretch: number;
  invalidation: number;
  expectedEpoch: number | null;
  ticksToEta: number | null;
  expectedMovePct: number;
  method: string;
  active: boolean;
}

export interface KillStatus {
  killed: boolean;
  reason: string | null;
  liveSamples: number;
  liveWinRateAfterCost: number | null;
  thresholdSamples: number;
  thresholdWinRateAfterCost: number;
  warning: boolean;
}

export interface IndicatorSnapshot {
  rsi14: number | null;
  ema9: number | null;
  ema21: number | null;
  atr14: number | null;
  momentum20: number | null;
}

export interface ReliabilityStats {
  sampleSpikes: number;
  meanInterSpikeTicks: number | null;
  medianInterSpikeTicks: number | null;
  weibullShapeApprox: number | null;
  memorylessNote: string;
}

export type SignalStatus = "pending" | "win" | "loss" | "expired";

export interface JournalSignal {
  id: string;
  symbol: SymbolId;
  kind: Exclude<OpportunityKind, "stand_aside">;
  bias: Bias;
  confidence: number;
  entryPrice: number;
  entryEpoch: number;
  createdAt: number;
  status: SignalStatus;
  returnPct?: number;
  returnNetPct?: number;
  winAfterCost?: boolean;
  costPctAssumed?: number;
  note?: string;
  source: "live" | "bootstrap";
}

export interface KindStats {
  kind: OpportunityKind | "all";
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
}

export interface Scoreboard {
  overall: KindStats;
  byKind: Partial<Record<Exclude<OpportunityKind, "stand_aside">, KindStats>>;
  resolved: number;
  pending: number;
  overallWinRate: number | null;
  overallWinRateAfterCost: number | null;
}

export interface LearningSummary {
  totalSignals: number;
  pending: number;
  resolved: number;
  overallWinRate: number | null;
  costPctAssumed: number;
  live: {
    overall: KindStats;
    bySymbol: Record<SymbolId, Scoreboard>;
    resolved: number;
    pending: number;
    overallWinRate: number | null;
    overallWinRateAfterCost: number | null;
  };
  seed: {
    overall: KindStats;
    bySymbol: Record<SymbolId, Scoreboard>;
    resolved: number;
    overallWinRate: number | null;
    overallWinRateAfterCost: number | null;
  };
  bySymbol: Record<
    SymbolId,
    {
      overall: KindStats;
      byKind: Partial<Record<Exclude<OpportunityKind, "stand_aside">, KindStats>>;
    }
  >;
  recent: JournalSignal[];
  calibrated: Partial<
    Record<
      SymbolId,
      Partial<Record<Exclude<OpportunityKind, "stand_aside">, number>>
    >
  >;
  updatedAt: number;
}

export interface SymbolAnalysis {
  symbol: SymbolId;
  displayName: string;
  lastQuote: number | null;
  lastEpoch: number | null;
  ticksCollected: number;
  ticksSinceLastSpike: number | null;
  lastSpike: SpikeEvent | null;
  recentSpikes: SpikeEvent[];
  indicators: IndicatorSnapshot;
  opportunity: TradeOpportunity;
  reliability: ReliabilityStats;
  forecast?: SpikeForecast;
  kill?: KillStatus;
  spikePlan?: SpikePlan | null;
  candles: Candle[];
  recentTicks: Tick[];
  updatedAt: number;
}

export interface MarketSnapshot {
  connected: boolean;
  symbols: Partial<Record<SymbolId, SymbolAnalysis>>;
  learning?: LearningSummary;
  vol?: VolSnapshot;
  disclaimer: string;
}

export interface BacktestResult {
  symbol: SymbolId;
  trades: number;
  wins: number;
  winRate: number | null;
  avgReturnPct: number | null;
  ticksUsed: number;
}

/** Volatility 250 research stack (separate from Boom/Crash). */
export type VolSymbolId = "1HZ250V";
export type VolBias = "up" | "down" | "neutral";

export interface VolTargets {
  target: number;
  stretch: number;
  invalidation: number;
  expectedMovePct: number;
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
  candles: Candle[];
  recentTicks: Tick[];
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
  target: number;
  stretch: number;
  invalidation: number;
  horizonTicks: number;
  createdAt: number;
  status: VolSignalStatus;
  returnPct?: number;
  mfePct?: number;
  maePct?: number;
  hitTarget?: boolean;
  hitInvalidation?: boolean;
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
