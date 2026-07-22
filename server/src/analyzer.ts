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
  // Target: the discontinuous spike (Boom up / Crash down) — not quiet drift candles.
  const spikeBias = isBoom ? "bullish" : "bearish";
  const spikeAction = isBoom
    ? "Spike hunt: look for Boom UP-spike (CALL / rise)"
    : "Spike hunt: look for Crash DOWN-spike (PUT / fall)";

  const rationale: string[] = [];
  let confidence = 0.2;
  let kind: TradeOpportunity["kind"] = "stand_aside";
  let bias: TradeOpportunity["bias"] = "neutral";
  let action = "Waiting — not in a spike-hunt window";
  let riskNote =
    "We target spikes only. Quiet drift between spikes is ignored on purpose.";

  const mean = ctx.meanInterSpike ?? ADVERTISED_INTERVAL;
  const since = ctx.ticksSinceLastSpike;

  if (ctx.ticksSinceLastSpike == null) {
    kind = "stand_aside";
    bias = "neutral";
    action = "Collecting spike baseline — wait for more history";
    confidence = 0.15;
    rationale.push("Not enough confirmed spikes in the loaded window yet.");
  } else if (ctx.justSpiked) {
    // Cooldown after a spike — do not chase drift candles.
    kind = "stand_aside";
    bias = "neutral";
    action = "Cooldown after spike — wait before next hunt";
    confidence = 0.18;
    rationale.push("A spike just printed. Stand aside until a new hunt window opens.");
    riskNote = "Clusters can happen, but immediate re-entry is usually noise.";
  } else if (since != null && since >= mean * 0.35) {
    // Primary setup: hunt the next spike in the spike direction.
    kind = "spike_watch";
    bias = spikeBias;
    action = spikeAction;
    const ratio = since / mean;
    // Soft ramp; keep capped because gaps are often near-memoryless.
    confidence = Math.min(0.52, 0.26 + ratio * 0.1);
    rationale.push(
      `${since} ticks since last spike vs mean ~${Math.round(mean)} (${(ratio * 100).toFixed(0)}% of mean).`,
    );
    rationale.push(
      isBoom
        ? "Trade thesis: capture the next Boom up-spike, not the soft down-drift."
        : "Trade thesis: capture the next Crash down-spike, not the soft up-drift.",
    );
    if (ratio < 0.85) {
      rationale.push("Still early vs mean gap — size smaller; timing edge is weak.");
    } else {
      rationale.push("Past ~85% of mean gap — watch window is active (still not a guarantee).");
    }
    riskNote =
      "Spike timing is stochastic. Do not average in just because you have waited.";
  } else {
    kind = "stand_aside";
    bias = "neutral";
    action = "Too soon after last spike — skip quiet candles";
    confidence = 0.2;
    rationale.push(
      since != null
        ? `Only ${since} ticks since last spike (need ~${Math.round(mean * 0.35)}+ to open a hunt).`
        : "Spike timing baseline unavailable.",
    );
    rationale.push("Small between-spike candles are not the target.");
  }

  const raw = Number(confidence.toFixed(2));
  let calibrated = raw;
  if (kind === "spike_watch") {
    const learned = learnedRates?.spike_watch;
    if (learned != null) {
      calibrated = blendConfidence(raw, learned, true);
      rationale.push(
        `Learning blend (spike hunts only): ~${(learned * 100).toFixed(0)}% → calibrated ${Math.round(calibrated * 100)}%.`,
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
 * Paper check for spike hunts: enter after cooldown, win if next spike
 * arrives before horizon and pays the spike-direction move.
 */
export function backtestSpikeStrategy(
  symbol: SymbolId,
  ticks: Tick[],
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
  const gaps = spikes
    .map((s) => s.ticksSincePrevious)
    .filter((g): g is number => g != null && g > 0);
  const meanGap =
    gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 2000;
  const cooldown = Math.round(meanGap * 0.35);
  const horizon = Math.max(600, Math.round(meanGap * 0.9));

  const returns: number[] = [];
  let wins = 0;

  for (let i = 0; i < spikes.length - 1; i++) {
    const entryIndex = spikes[i].index + cooldown;
    const nextSpike = spikes[i + 1];
    if (entryIndex >= nextSpike.index) continue;
    if (entryIndex >= ticks.length - 2) continue;

    const entry = ticks[entryIndex].quote;
    const withinHorizon = nextSpike.index - entryIndex <= horizon;
    if (!withinHorizon) {
      // Missed / late — count as loss with near-flat path return
      const exit = ticks[Math.min(ticks.length - 1, entryIndex + horizon)];
      const raw = (exit.quote - entry) / entry;
      const pnl = (isBoom ? raw : -raw) * 100;
      returns.push(pnl);
      continue;
    }

    const spikeRet = ((nextSpike.quote - entry) / entry) * 100;
    // Boom wants up-spike (positive), Crash wants down-spike (negative → flip)
    const pnl = isBoom ? spikeRet : -spikeRet;
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
    avgReturnPct: Number(avg.toFixed(4)),
  };
}

/** @deprecated Use backtestSpikeStrategy — kept as alias for older imports. */
export function backtestDriftStrategy(
  symbol: SymbolId,
  ticks: Tick[],
  _holdTicks = 40,
): {
  trades: number;
  wins: number;
  winRate: number | null;
  avgReturnPct: number | null;
} {
  return backtestSpikeStrategy(symbol, ticks);
}
