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
  /** Raw model confidence before learning calibration. */
  confidence: number;
  /** Confidence after blending with live journal hit-rates. */
  calibratedConfidence?: number;
  rationale: string[];
  riskNote: string;
  /** Predictor-mode edge score 0–1 from learned pockets. */
  edgeScore?: number;
  /** Whether learned entry policy allows a hunt. */
  policyAllow?: boolean;
  policyReasons?: string[];
  /** Active retail playbook confluence (S/R, EMA cross, order block, retest). */
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

/** Chart-facing projection for the next spike hunt (price + timing). */
export interface SpikePlan {
  /** Expected spike print level (Boom up / Crash down). */
  spikeTarget: number;
  /** Stretch / larger spike magnitude level. */
  stretch: number;
  /** Hunt invalidates if price prints here first. */
  invalidation: number;
  /** Epoch where the median-gap ETA lands (may be in the future). */
  expectedEpoch: number | null;
  /** Ticks remaining until median-gap ETA (0 if overdue). */
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
  entryTickIndex: number;
  horizonTicks: number;
  /** Paper-trade levels snapped at entry (optional on older rows). */
  target?: number;
  stretch?: number;
  invalidation?: number;
  /** Regime snapshot at entry (learning feature set). */
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
  /** Gross directional return % before costs. */
  returnPct?: number;
  /** Net return % after assumed round-trip cost. */
  returnNetPct?: number;
  winAfterCost?: boolean;
  costPctAssumed?: number;
  hitTarget?: boolean;
  hitInvalidation?: boolean;
  /** Max favorable excursion % along the path. */
  mfePct?: number;
  /** Max adverse excursion % along the path. */
  maePct?: number;
  /** How the paper trade closed. */
  outcome?: "spike" | "target" | "stopout" | "expired" | "open";
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
  /** Wins counted only when net return after cost > 0. */
  winsAfterCost: number;
  lossesAfterCost: number;
  winRateAfterCost: number | null;
  avgReturnNetPct: number | null;
  /** Alias of avg net return — primary optimization target. */
  expectancyNetPct: number | null;
  avgMfePct: number | null;
  avgMaePct: number | null;
  /** Recency-weighted after-cost win rate. */
  decayWinRateAfterCost: number | null;
  /** Recency-weighted expectancy. */
  decayExpectancyNetPct: number | null;
  decayEffectiveN: number;
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
  winMaeP90: number | null;
  winMfeP50: number | null;
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
  /** Assumed round-trip cost used for net metrics (% points). */
  costPctAssumed: number;
  /** Honest live-only scoreboard (excludes bootstrap seed). */
  live: {
    overall: KindStats;
    bySymbol: Record<SymbolId, Scoreboard>;
    resolved: number;
    pending: number;
    overallWinRate: number | null;
    overallWinRateAfterCost: number | null;
  };
  /** Bootstrap/seed scoreboard — useful context, not for confidence. */
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
  /** Live spike-hunt stats broken down by age regime (per symbol). */
  regimes: Partial<Record<SymbolId, RegimeBucketStats[]>>;
  /** Seed/bootstrap spike-hunt stats by age regime (context only). */
  seedRegimes: Partial<Record<SymbolId, RegimeBucketStats[]>>;
  /** Live age × RSI cross buckets. */
  crossRegimes?: Partial<Record<SymbolId, RegimeBucketStats[]>>;
  /** Live outcome mix (spike/target/stop/expiry). */
  outcomes?: OutcomeBreakdown;
  outcomesBySymbol?: Partial<Record<SymbolId, OutcomeBreakdown>>;
  /** Per-symbol / per-regime focus weights from live expectancy. */
  focus?: {
    bySymbol: Partial<Record<SymbolId, FocusWeightView>>;
    byAgeRegime?: Partial<
      Record<SymbolId, Partial<Record<string, FocusWeightView>>>
    >;
    rows: FocusWeightView[];
  };
  /** Learned stop/target distances from MFE/MAE. */
  levelHints?: Partial<Record<SymbolId, LevelHintView>>;
  /** Time-ordered train vs holdout report. */
  walkForward?: WalkForwardView;
  /** Short auto insights from ablation-style regime comparison. */
  insights: string[];
  /** Entry-gate allow/reject counters since process start. */
  gateTelemetry?: {
    allowed: number;
    rejected: number;
    reasons: Record<string, number>;
    updatedAt: number;
  };
  recent: JournalSignal[];
  /** Calibrated from LIVE decay-weighted expectancy/hit-rate only (excl. holdout). */
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
  forecast: SpikeForecast;
  kill: KillStatus;
  /** Next-spike price/time markers for the chart. */
  spikePlan: SpikePlan | null;
  candles: Candle[];
  recentTicks: Tick[];
  updatedAt: number;
}

export interface MarketSnapshot {
  connected: boolean;
  symbols: Partial<Record<SymbolId, SymbolAnalysis>>;
  learning: LearningSummary;
  /** Volatility-index research stack (separate from Boom/Crash spike hunts). */
  vol?: import("./vol/types.js").VolSnapshot;
  disclaimer: string;
}
