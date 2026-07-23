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
  edgeScore?: number;
  policyAllow?: boolean;
  policyReasons?: string[];
  confluence?: {
    count: number;
    score: number;
    labels: string[];
    shelfPrice?: number;
    hits?: Array<{
      id: string;
      label: string;
      score: number;
      detail?: string;
      shelfPrice?: number;
    }>;
  };
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
  liveExpectancyNetPct?: number | null;
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
  entryTickIndex?: number;
  horizonTicks?: number;
  target?: number;
  stretch?: number;
  invalidation?: number;
  regime?: {
    ageRegime: "early" | "mid" | "late" | "overdue";
    rsiRegime?: "oversold" | "neutral" | "overbought";
    ageRatio: number | null;
    weibullShape: number | null;
    timingEdgeWeak: boolean;
    rsi14: number | null;
    hourUtc: number;
    pSpike500: number | null;
    stopPct: number | null;
  };
  createdAt: number;
  status: SignalStatus;
  resolvedAt?: number;
  exitPrice?: number;
  exitEpoch?: number;
  returnPct?: number;
  returnNetPct?: number;
  winAfterCost?: boolean;
  costPctAssumed?: number;
  hitTarget?: boolean;
  hitInvalidation?: boolean;
  mfePct?: number;
  maePct?: number;
  outcome?: "spike" | "target" | "stopout" | "expired" | "open";
  note?: string;
  source: "live" | "bootstrap" | "manual";
  pattern?: {
    id: "spike_base_retest";
    score: number;
    shelfPrice: number;
    nearShelf: boolean;
    distToShelfPct: number | null;
  };
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
  expectancyNetPct?: number | null;
  avgMfePct?: number | null;
  avgMaePct?: number | null;
  decayWinRateAfterCost?: number | null;
  decayExpectancyNetPct?: number | null;
  decayEffectiveN?: number;
}

export interface Scoreboard {
  overall: KindStats;
  byKind: Partial<Record<Exclude<OpportunityKind, "stand_aside">, KindStats>>;
  resolved: number;
  pending: number;
  overallWinRate: number | null;
  overallWinRateAfterCost: number | null;
}

export interface RegimeBucketStats {
  key: string;
  label: string;
  stats: KindStats;
}

export interface OutcomeBreakdown {
  spike: number;
  target: number;
  stopout: number;
  expired: number;
  other: number;
  total: number;
  dominantLoss: "spike" | "target" | "stopout" | "expired" | null;
  note: string | null;
}

export interface FocusWeightView {
  key: string;
  label: string;
  n: number;
  expectancyNetPct: number | null;
  weight: number;
  deprioritize: boolean;
  note: string;
}

export interface LevelHintView {
  symbol: SymbolId;
  stopPct: number;
  targetPct: number;
  basedOnN: number;
  avgMfePct: number;
  avgMaePct: number;
  winMaeP75: number | null;
  lossMfeP75: number | null;
  note: string;
}

export interface WalkForwardView {
  trainN: number;
  holdoutN: number;
  trainWinRateAfterCost: number | null;
  holdoutWinRateAfterCost: number | null;
  trainExpectancyNetPct: number | null;
  holdoutExpectancyNetPct: number | null;
  gapExpectancy: number | null;
  note: string | null;
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
  regimes?: Partial<Record<SymbolId, RegimeBucketStats[]>>;
  seedRegimes?: Partial<Record<SymbolId, RegimeBucketStats[]>>;
  crossRegimes?: Partial<Record<SymbolId, RegimeBucketStats[]>>;
  outcomes?: OutcomeBreakdown;
  outcomesBySymbol?: Partial<Record<SymbolId, OutcomeBreakdown>>;
  focus?: {
    bySymbol: Partial<Record<SymbolId, FocusWeightView>>;
    byAgeRegime?: Partial<
      Record<SymbolId, Partial<Record<string, FocusWeightView>>>
    >;
    rows: FocusWeightView[];
  };
  levelHints?: Partial<Record<SymbolId, LevelHintView>>;
  walkForward?: WalkForwardView;
  insights?: string[];
  gateTelemetry?: {
    allowed: number;
    rejected: number;
    reasons: Record<string, number>;
    updatedAt: number;
  };
  recent: JournalSignal[];
  calibrated: Partial<
    Record<
      SymbolId,
      Partial<Record<Exclude<OpportunityKind, "stand_aside">, number>>
    >
  >;
  patternStats?: {
    withPattern: KindStats;
    withoutPattern: KindStats;
    nearShelf: KindStats;
    bySymbol?: Partial<
      Record<
        SymbolId,
        {
          withPattern: KindStats;
          withoutPattern: KindStats;
          nearShelf: KindStats;
        }
      >
    >;
  };
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
  timeframe?: {
    candleSec: number;
    minHoldTicks: number;
    horizonTicks: number;
  };
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
  exitPrice?: number;
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

export interface VolOutcomeBreakdown {
  spike: number;
  target: number;
  stopout: number;
  expired: number;
  other: number;
  total: number;
  dominantLoss: "spike" | "target" | "stopout" | "expired" | null;
  note: string | null;
}

export interface VolFocusWeight {
  key: string;
  label: string;
  n: number;
  expectancyNetPct: number | null;
  weight: number;
  deprioritize: boolean;
  note: string;
}

export interface VolFocusMap {
  byBias: Partial<Record<"up" | "down", VolFocusWeight>>;
  rows: VolFocusWeight[];
  preferred: "up" | "down" | null;
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
  outcomes: VolOutcomeBreakdown;
  outcomesByBias: {
    up: VolOutcomeBreakdown;
    down: VolOutcomeBreakdown;
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
