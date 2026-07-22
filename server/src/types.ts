export type SymbolId = "BOOM1000" | "CRASH1000";

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
  createdAt: number;
  status: SignalStatus;
  resolvedAt?: number;
  exitPrice?: number;
  exitEpoch?: number;
  returnPct?: number;
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
}

export interface LearningSummary {
  totalSignals: number;
  pending: number;
  resolved: number;
  overallWinRate: number | null;
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
  candles: Candle[];
  recentTicks: Tick[];
  updatedAt: number;
}

export interface MarketSnapshot {
  connected: boolean;
  symbols: Record<SymbolId, SymbolAnalysis>;
  learning: LearningSummary;
  disclaimer: string;
}
