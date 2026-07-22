import { atr, buildCandlesFromTicks, ema, momentum, rsi } from "./indicators.js";
import { blendConfidence } from "./learning/journal.js";
import { detectSpikes, interSpikeStats } from "./spikeDetector.js";
import type {
  OpportunityKind,
  SymbolAnalysis,
  SymbolId,
  Tick,
  TradeOpportunity,
} from "./types.js";

const DISPLAY: Record<SymbolId, string> = {
  BOOM1000: "Boom 1000",
  CRASH1000: "Crash 1000",
};

const ADVERTISED_INTERVAL = 1000;

export type CalibrationMap = Partial<
  Record<SymbolId, Partial<Record<Exclude<OpportunityKind, "stand_aside">, number>>>
>;

export function analyzeSymbol(
  symbol: SymbolId,
  ticks: Tick[],
  calibration?: CalibrationMap,
): SymbolAnalysis {
  const candles = buildCandlesFromTicks(ticks, 60);
  const closes = candles.map((c) => c.close);
  const quotes = ticks.map((t) => t.quote);
  const spikes = detectSpikes(symbol, ticks);
  const lastSpike = spikes.length ? spikes[spikes.length - 1] : null;
  const ticksSinceLastSpike =
    lastSpike != null ? ticks.length - 1 - lastSpike.index : null;
  const stats = interSpikeStats(spikes);

  const indicators = {
    rsi14: rsi(closes, 14),
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    atr14: atr(candles, 14),
    momentum20: momentum(closes, 20),
  };

  const opportunity = scoreOpportunity(
    symbol,
    {
      ticksSinceLastSpike,
      meanInterSpike: stats.mean,
      rsi: indicators.rsi14,
      ema9: indicators.ema9,
      ema21: indicators.ema21,
      momentum: indicators.momentum20,
      justSpiked:
        lastSpike != null &&
        ticksSinceLastSpike != null &&
        ticksSinceLastSpike <= 25,
    },
    calibration?.[symbol],
  );

  return {
    symbol,
    displayName: DISPLAY[symbol],
    lastQuote: quotes.length ? quotes[quotes.length - 1] : null,
    lastEpoch: ticks.length ? ticks[ticks.length - 1].epoch : null,
    ticksCollected: ticks.length,
    ticksSinceLastSpike,
    lastSpike,
    recentSpikes: spikes.slice(-8),
    indicators,
    opportunity,
    reliability: {
      sampleSpikes: spikes.length,
      meanInterSpikeTicks: stats.mean,
      medianInterSpikeTicks: stats.median,
      weibullShapeApprox: stats.shapeApprox,
      memorylessNote:
        stats.shapeApprox != null && stats.shapeApprox < 1.2
          ? "Inter-spike gaps look near-memoryless: waiting longer does not strongly raise spike odds."
          : "Need more spikes (or shape > ~1.2) before treating wait-time as informative.",
    },
    candles: candles.slice(-180),
    recentTicks: ticks.slice(-400),
    updatedAt: Date.now(),
  };
}

function scoreOpportunity(
  symbol: SymbolId,
  ctx: {
    ticksSinceLastSpike: number | null;
    meanInterSpike: number | null;
    rsi: number | null;
    ema9: number | null;
    ema21: number | null;
    momentum: number | null;
    justSpiked: boolean;
  },
  learnedRates?: Partial<Record<Exclude<OpportunityKind, "stand_aside">, number>>,
): TradeOpportunity {
  const isBoom = symbol === "BOOM1000";
  // Between spikes: Boom drifts down, Crash drifts up.
  const driftBias = isBoom ? "bearish" : "bullish";
  const spikeBias = isBoom ? "bullish" : "bearish";
  const driftAction = isBoom
    ? "Favor PUT / short-bias during quiet drift"
    : "Favor CALL / long-bias during quiet drift";
  const spikeAction = isBoom
    ? "Spike-watch: Boom up-spike possible"
    : "Spike-watch: Crash down-spike possible";

  const rationale: string[] = [];
  let confidence = 0.28;
  let kind: TradeOpportunity["kind"] = "stand_aside";
  let bias: TradeOpportunity["bias"] = "neutral";
  let action = "No clear edge — stand aside";
  let riskNote =
    "Synthetic Boom/Crash spikes are stochastic. Treat every signal as probabilistic, never certain.";

  if (ctx.justSpiked) {
    kind = "post_spike";
    bias = driftBias;
    action = isBoom
      ? "Post-spike: look for resumed downward drift (PUT bias)"
      : "Post-spike: look for resumed upward drift (CALL bias)";
    confidence = 0.55;
    rationale.push("A spike just printed; historical mean behavior resumes drift.");
    riskNote =
      "Clusters can happen. Size small and wait for the first quiet ticks after the spike.";
  } else if (
    ctx.ticksSinceLastSpike != null &&
    ctx.meanInterSpike != null &&
    ctx.ticksSinceLastSpike > ctx.meanInterSpike * 0.85
  ) {
    // Soft spike-watch — research says this edge is weak if memoryless
    kind = "spike_watch";
    bias = spikeBias;
    action = spikeAction;
    const ratio = ctx.ticksSinceLastSpike / (ctx.meanInterSpike || ADVERTISED_INTERVAL);
    confidence = Math.min(0.48, 0.3 + ratio * 0.08);
    rationale.push(
      `${ctx.ticksSinceLastSpike} ticks since last spike vs mean ~${Math.round(ctx.meanInterSpike)}.`,
    );
    rationale.push(
      "If gaps are memoryless, overtime alone is a weak predictor — keep confidence capped.",
    );
    riskNote =
      "Do not average into spike bets just because you have waited a long time.";
  } else {
    kind = "drift_follow";
    bias = driftBias;
    action = driftAction;
    confidence = 0.42;
    rationale.push(
      isBoom
        ? "Boom quiet phase typically drifts lower between up-spikes."
        : "Crash quiet phase typically drifts higher between down-spikes.",
    );

    if (ctx.ema9 != null && ctx.ema21 != null) {
      const trendAligned =
        (isBoom && ctx.ema9 < ctx.ema21) || (!isBoom && ctx.ema9 > ctx.ema21);
      if (trendAligned) {
        confidence += 0.08;
        rationale.push("EMA9/EMA21 aligned with expected drift.");
      } else {
        confidence -= 0.05;
        rationale.push("EMA cross fights the expected drift — reduce size.");
      }
    }

    if (ctx.rsi != null) {
      if (isBoom && ctx.rsi > 65) {
        confidence += 0.05;
        rationale.push(`RSI ${ctx.rsi.toFixed(1)} elevated — pullback drift more attractive.`);
      } else if (!isBoom && ctx.rsi < 35) {
        confidence += 0.05;
        rationale.push(`RSI ${ctx.rsi.toFixed(1)} depressed — bounce drift more attractive.`);
      }
    }

    if (ctx.momentum != null) {
      const momAligned =
        (isBoom && ctx.momentum < 0) || (!isBoom && ctx.momentum > 0);
      if (momAligned) {
        confidence += 0.04;
        rationale.push("Short-horizon momentum agrees with drift.");
      }
    }

    confidence = Math.max(0.2, Math.min(0.62, confidence));
    riskNote =
      "Drift trades can be wiped by the next spike. Prefer tight risk and avoid holding through fatigue.";
  }

  if (ctx.ticksSinceLastSpike == null) {
    kind = "stand_aside";
    bias = "neutral";
    action = "Collecting spike baseline — wait for more history";
    confidence = 0.15;
    rationale.push("Not enough confirmed spikes in the loaded window yet.");
  }

  const raw = Number(confidence.toFixed(2));
  let calibrated = raw;
  if (kind !== "stand_aside") {
    const learned = learnedRates?.[kind];
    if (learned != null) {
      calibrated = blendConfidence(raw, learned, true);
      rationale.push(
        `Learning blend: journal rate ~${(learned * 100).toFixed(0)}% → calibrated ${Math.round(calibrated * 100)}%.`,
      );
    }
  }

  return {
    kind,
    bias,
    action,
    confidence: raw,
    calibratedConfidence: calibrated,
    rationale,
    riskNote,
  };
}

/**
 * Lightweight paper backtest: enter drift-direction after quiet ticks,
 * exit on next spike or max hold.
 */
export function backtestDriftStrategy(
  symbol: SymbolId,
  ticks: Tick[],
  holdTicks = 40,
): {
  trades: number;
  wins: number;
  winRate: number | null;
  avgReturnPct: number | null;
} {
  const spikes = detectSpikes(symbol, ticks);
  if (spikes.length < 4 || ticks.length < 200) {
    return { trades: 0, wins: 0, winRate: null, avgReturnPct: null };
  }

  const isBoom = symbol === "BOOM1000";
  const spikeIndexes = new Set(spikes.map((s) => s.index));
  const returns: number[] = [];
  let wins = 0;

  for (let i = 0; i < spikes.length - 1; i++) {
    const entryIndex = spikes[i].index + 5;
    if (entryIndex >= ticks.length - 2) continue;
    const exitCap = Math.min(entryIndex + holdTicks, spikes[i + 1].index);
    // Skip if another spike lands immediately
    let aborted = false;
    for (let j = entryIndex; j <= exitCap; j++) {
      if (spikeIndexes.has(j) && j !== spikes[i + 1].index) {
        aborted = true;
        break;
      }
    }
    if (aborted) continue;

    const entry = ticks[entryIndex].quote;
    const exit = ticks[exitCap].quote;
    const raw = (exit - entry) / entry;
    // Drift: Boom short, Crash long
    const pnl = isBoom ? -raw : raw;
    returns.push(pnl);
    if (pnl > 0) wins += 1;
  }

  if (!returns.length) {
    return { trades: 0, wins: 0, winRate: null, avgReturnPct: null };
  }

  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  return {
    trades: returns.length,
    wins,
    winRate: Number((wins / returns.length).toFixed(3)),
    avgReturnPct: Number((avg * 100).toFixed(4)),
  };
}
