import { atr, buildCandlesFromTicks, ema, momentum, rsi } from "./indicators.js";
import { buildSpikeForecast } from "./learning/hazard.js";
import { blendConfidence } from "./learning/journal.js";
import type { KillStatus } from "./learning/killRules.js";
import type { RegimePreference } from "./learning/regimePrefs.js";
import { ageRegimeFromRatio } from "./learning/regimes.js";
import { detectSpikes, interSpikeStats } from "./spikeDetector.js";
import { SYMBOL_DISPLAY, isBoomSymbol } from "./symbols.js";
import type {
  HorizonProb,
  KillStatus as KillStatusType,
  OpportunityKind,
  SpikeForecast,
  SpikePlan,
  SymbolAnalysis,
  SymbolId,
  Tick,
  TradeOpportunity,
} from "./types.js";

const ADVERTISED_INTERVAL = 1000;

export type CalibrationMap = Partial<
  Record<SymbolId, Partial<Record<Exclude<OpportunityKind, "stand_aside">, number>>>
>;

const IDLE_KILL: KillStatusType = {
  killed: false,
  reason: null,
  liveSamples: 0,
  liveWinRateAfterCost: null,
  liveExpectancyNetPct: null,
  thresholdSamples: 50,
  thresholdWinRateAfterCost: 0.45,
  warning: false,
};

export function analyzeSymbol(
  symbol: SymbolId,
  ticks: Tick[],
  calibration?: CalibrationMap,
  kill: KillStatusType = IDLE_KILL,
  regimePref?: RegimePreference | null,
): SymbolAnalysis {
  const candles = buildCandlesFromTicks(ticks, 60);
  const closes = candles.map((c) => c.close);
  const quotes = ticks.map((t) => t.quote);
  const spikes = detectSpikes(symbol, ticks);
  const lastSpike = spikes.length ? spikes[spikes.length - 1] : null;
  const ticksSinceLastSpike =
    lastSpike != null ? ticks.length - 1 - lastSpike.index : null;
  const stats = interSpikeStats(spikes);
  const forecast = buildSpikeForecast(spikes, ticksSinceLastSpike);

  const indicators = {
    rsi14: rsi(closes, 14),
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    atr14: atr(candles, 14),
    momentum20: momentum(closes, 20),
  };

  const mean = stats.mean;
  const ageRatio =
    mean != null && mean > 0 && ticksSinceLastSpike != null
      ? ticksSinceLastSpike / mean
      : null;
  const age = ageRegimeFromRatio(ageRatio);

  const opportunity = scoreOpportunity(
    symbol,
    {
      ticksSinceLastSpike,
      meanInterSpike: stats.mean,
      justSpiked:
        lastSpike != null &&
        ticksSinceLastSpike != null &&
        ticksSinceLastSpike <= 25,
      forecast,
      kill,
      ageRegime: age,
      regimePref: regimePref ?? null,
    },
    calibration?.[symbol],
  );

  const lastQuote = quotes.length ? quotes[quotes.length - 1] : null;
  const lastEpoch = ticks.length ? ticks[ticks.length - 1].epoch : null;
  const spikePlan = buildSpikePlan({
    symbol,
    lastQuote,
    lastEpoch,
    ticks,
    spikes,
    atr14: indicators.atr14,
    ticksSinceLastSpike,
    meanGap: stats.mean,
    medianGap: stats.median,
    opportunityKind: opportunity.kind,
  });

  return {
    symbol,
    displayName: SYMBOL_DISPLAY[symbol],
    lastQuote,
    lastEpoch,
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
      memorylessNote: forecast.timingNote,
    },
    forecast,
    kill,
    spikePlan,
    candles: candles.slice(-180),
    recentTicks: ticks.slice(-400),
    updatedAt: Date.now(),
  };
}

function buildSpikePlan(ctx: {
  symbol: SymbolId;
  lastQuote: number | null;
  lastEpoch: number | null;
  ticks: Tick[];
  spikes: { magnitude: number }[];
  atr14: number | null;
  ticksSinceLastSpike: number | null;
  meanGap: number | null;
  medianGap: number | null;
  opportunityKind: OpportunityKind;
}): SpikePlan | null {
  if (ctx.lastQuote == null || ctx.lastEpoch == null) return null;
  if (ctx.spikes.length < 2) return null;

  const isBoom = isBoomSymbol(ctx.symbol);
  const mags = ctx.spikes
    .map((s) => Math.abs(s.magnitude))
    .filter((m) => m > 0)
    .sort((a, b) => a - b);
  if (!mags.length) return null;

  const medMag = mags[Math.floor(mags.length * 0.5)] ?? mags[0];
  const stretchMag = mags[Math.floor(mags.length * 0.75)] ?? medMag;
  const price = ctx.lastQuote;
  const atr = ctx.atr14 != null && ctx.atr14 > 0 ? ctx.atr14 : price * medMag;

  const spikeTarget = isBoom ? price * (1 + medMag) : price * (1 - medMag);
  const stretch = isBoom ? price * (1 + stretchMag) : price * (1 - stretchMag);
  const invalidation = isBoom
    ? Math.min(price - atr, price * (1 - medMag * 0.35))
    : Math.max(price + atr, price * (1 + medMag * 0.35));

  const gap = ctx.medianGap ?? ctx.meanGap;
  let ticksToEta: number | null = null;
  let expectedEpoch: number | null = null;
  if (gap != null && ctx.ticksSinceLastSpike != null) {
    ticksToEta = Math.max(0, Math.round(gap - ctx.ticksSinceLastSpike));
    const dt = estimateTickSeconds(ctx.ticks);
    expectedEpoch = ctx.lastEpoch + Math.round(ticksToEta * dt);
  }

  return {
    spikeTarget: Number(spikeTarget.toFixed(5)),
    stretch: Number(stretch.toFixed(5)),
    invalidation: Number(invalidation.toFixed(5)),
    expectedEpoch,
    ticksToEta,
    expectedMovePct: Number((Math.abs(spikeTarget - price) / price * 100).toFixed(4)),
    method: "Median spike magnitude + ATR invalidation · median-gap ETA",
    active: ctx.opportunityKind === "spike_watch",
  };
}

function estimateTickSeconds(ticks: Tick[]): number {
  if (ticks.length < 3) return 1;
  const a = ticks[ticks.length - 1].epoch;
  const b = ticks[ticks.length - 11]?.epoch ?? ticks[0].epoch;
  const n = Math.min(10, ticks.length - 1);
  const dt = (a - b) / n;
  return dt > 0 && dt < 10 ? dt : 1;
}

function scoreOpportunity(
  symbol: SymbolId,
  ctx: {
    ticksSinceLastSpike: number | null;
    meanInterSpike: number | null;
    justSpiked: boolean;
    forecast: SpikeForecast;
    kill: KillStatus | KillStatusType;
    ageRegime?: string;
    regimePref?: RegimePreference | null;
  },
  learnedRates?: Partial<Record<Exclude<OpportunityKind, "stand_aside">, number>>,
): TradeOpportunity {
  const isBoom = isBoomSymbol(symbol);
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
  const p500 = horizonOf(ctx.forecast, 500);
  const p1000 = horizonOf(ctx.forecast, 1000);

  if (ctx.kill.killed) {
    kind = "stand_aside";
    bias = "neutral";
    action = "Kill rule active — stand aside";
    confidence = 0.1;
    rationale.push(ctx.kill.reason || "Live spike-hunt edge failed kill criteria.");
    riskNote = "Edge invalidated by live after-cost results. Do not force trades.";
  } else if (ctx.ticksSinceLastSpike == null) {
    action = "Collecting spike baseline — wait for more history";
    confidence = 0.15;
    rationale.push("Not enough confirmed spikes in the loaded window yet.");
  } else if (ctx.justSpiked) {
    action = "Cooldown after spike — wait before next hunt";
    confidence = 0.18;
    rationale.push("A spike just printed. Stand aside until a new hunt window opens.");
    riskNote = "Clusters can happen, but immediate re-entry is usually noise.";
  } else if (since != null && since >= mean * 0.35) {
    kind = "spike_watch";
    bias = spikeBias;
    action = spikeAction;
    const ratio = since / mean;

    // Blend age ratio with empirical short-horizon probability when available.
    const empiric = p500?.probability ?? p1000?.probability;
    if (empiric != null) {
      confidence = Math.min(0.55, 0.22 + empiric * 0.45 + Math.min(ratio, 1.5) * 0.05);
      rationale.push(
        `Empirical P(spike≤500)=${fmtProb(p500)} · P(≤1000)=${fmtProb(p1000)} (age ${since}).`,
      );
    } else {
      confidence = Math.min(0.48, 0.26 + ratio * 0.1);
      rationale.push(
        `${since} ticks since last spike vs mean ~${Math.round(mean)} (${(ratio * 100).toFixed(0)}% of mean).`,
      );
    }

    rationale.push(
      isBoom
        ? "Trade thesis: capture the next Boom up-spike, not quiet candles."
        : "Trade thesis: capture the next Crash down-spike, not quiet candles.",
    );
    rationale.push(ctx.forecast.timingNote);

    if (ctx.forecast.timingEdgeWeak) {
      confidence = Math.min(confidence, 0.42);
      rationale.push("Timing edge weak/flat — confidence capped.");
    }
    if (ctx.kill.warning) {
      confidence = Math.min(confidence, 0.35);
      rationale.push(
        `Kill warning: live after-cost WR ${pct(ctx.kill.liveWinRateAfterCost)} on ${ctx.kill.liveSamples} samples.`,
      );
    }

    if (ctx.regimePref?.note) {
      confidence = Math.min(0.58, confidence * ctx.regimePref.confidenceMult);
      rationale.push(ctx.regimePref.note);
      if (ctx.ageRegime) {
        rationale.push(`Current age regime: ${ctx.ageRegime}.`);
      }
    }

    riskNote =
      "Spike timing is stochastic. Size from horizon odds, not hope.";
  } else {
    action = "Too soon after last spike — skip quiet candles";
    confidence = 0.2;
    rationale.push(
      since != null
        ? `Only ${since} ticks since last spike (need ~${Math.round(mean * 0.35)}+ to open a hunt).`
        : "Spike timing baseline unavailable.",
    );
    if (p500?.probability != null) {
      rationale.push(`Even now, P(spike≤500 ticks)=${fmtProb(p500)}.`);
    }
  }

  const raw = Number(Math.max(0.08, Math.min(0.6, confidence)).toFixed(2));
  let calibrated = raw;
  if (kind === "spike_watch") {
    const learned = learnedRates?.spike_watch;
    if (learned != null) {
      calibrated = blendConfidence(raw, learned, true);
      rationale.push(
        `Learning blend (spike hunts): ~${(learned * 100).toFixed(0)}% → calibrated ${Math.round(calibrated * 100)}%.`,
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

function horizonOf(forecast: SpikeForecast, h: number): HorizonProb | null {
  return forecast.horizons.find((x) => x.horizonTicks === h) ?? null;
}

function fmtProb(h: HorizonProb | null | undefined): string {
  if (!h || h.probability == null) return "n/a";
  return `${(h.probability * 100).toFixed(0)}% (n=${h.survivors})`;
}

function pct(v: number | null): string {
  if (v == null) return "n/a";
  return `${(v * 100).toFixed(1)}%`;
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

  const isBoom = isBoomSymbol(symbol);
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
      const exit = ticks[Math.min(ticks.length - 1, entryIndex + horizon)];
      const raw = (exit.quote - entry) / entry;
      const pnl = (isBoom ? raw : -raw) * 100;
      returns.push(pnl);
      continue;
    }

    const spikeRet = ((nextSpike.quote - entry) / entry) * 100;
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

/** @deprecated Use backtestSpikeStrategy */
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
