import { atr, buildCandlesFromTicks, ema, momentum, rsi } from "./indicators.js";
import { buildSpikeForecast } from "./learning/hazard.js";
import { blendConfidence } from "./learning/journal.js";
import type { KillStatus } from "./learning/killRules.js";
import { applyLevelHint, type LevelHint } from "./learning/levelTune.js";
import { stopFromTarget } from "./learning/riskReward.js";
import type { EntryPolicyDecision } from "./learning/entryPolicy.js";
import { predictorMode } from "./learning/entryPolicy.js";
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
  opts?: {
    levelHint?: LevelHint | null;
    focusWeight?: number;
    focusNote?: string | null;
    entryPolicy?: EntryPolicyDecision | null;
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
    } | null;
  },
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
      focusWeight: opts?.focusWeight ?? 1,
      focusNote: opts?.focusNote ?? null,
      entryPolicy: opts?.entryPolicy ?? null,
      confluence: opts?.confluence ?? null,
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
    levelHint: opts?.levelHint ?? null,
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
  levelHint?: LevelHint | null;
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

  const baseTarget = isBoom ? price * (1 + medMag) : price * (1 - medMag);
  const baseStretch = isBoom ? price * (1 + stretchMag) : price * (1 - stretchMag);
  const invalidation = isBoom
    ? Math.min(price - atr * 1.35, price * (1 - medMag * 0.55))
    : Math.max(price + atr * 1.35, price * (1 + medMag * 0.55));

  const tuned = applyLevelHint(
    price,
    isBoom,
    {
      spikeTarget: baseTarget,
      stretch: baseStretch,
      invalidation,
    },
    ctx.levelHint ?? undefined,
  );

  // Hard 1:3 R:R — stop is always 33% of the target distance.
  const rrStop = stopFromTarget(price, tuned.spikeTarget, isBoom);
  const gap = ctx.medianGap ?? ctx.meanGap;
  let ticksToEta: number | null = null;
  let expectedEpoch: number | null = null;
  if (gap != null && ctx.ticksSinceLastSpike != null) {
    ticksToEta = Math.max(0, Math.round(gap - ctx.ticksSinceLastSpike));
    const dt = estimateTickSeconds(ctx.ticks);
    expectedEpoch = ctx.lastEpoch + Math.round(ticksToEta * dt);
  }

  return {
    spikeTarget: tuned.spikeTarget,
    stretch: tuned.stretch,
    invalidation: rrStop,
    expectedEpoch,
    ticksToEta,
    expectedMovePct: Number(
      ((Math.abs(tuned.spikeTarget - price) / price) * 100).toFixed(4),
    ),
    method: `Median spike mag · 1:3 R:R stop · median-gap ETA${tuned.methodSuffix}`,
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
    focusWeight?: number;
    focusNote?: string | null;
    entryPolicy?: EntryPolicyDecision | null;
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
    } | null;
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
  let edgeScore = 0.3;
  let policyAllow: boolean | undefined;
  let policyReasons: string[] | undefined;
  const confluence = ctx.confluence
    ? {
        count: ctx.confluence.count,
        score: ctx.confluence.score,
        labels: ctx.confluence.labels,
        shelfPrice: ctx.confluence.shelfPrice,
        hits: ctx.confluence.hits,
      }
    : undefined;

  const mean = ctx.meanInterSpike ?? ADVERTISED_INTERVAL;
  const since = ctx.ticksSinceLastSpike;
  const p500 = horizonOf(ctx.forecast, 500);
  const p1000 = horizonOf(ctx.forecast, 1000);
  const predMode = predictorMode();
  // Predictor mode prefers quality windows; learn-max opens earlier.
  const learnMax =
    !predMode &&
    (process.env.PAPER_LEARN_MAX == null ||
      process.env.PAPER_LEARN_MAX === "" ||
      (process.env.PAPER_LEARN_MAX !== "0" &&
        process.env.PAPER_LEARN_MAX !== "false"));
  const watchAgeRatio = Number(
    process.env.SPIKE_WATCH_AGE_RATIO || (learnMax ? 0.28 : predMode ? 0.4 : 0.35),
  );

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
  } else if (since != null && since >= mean * watchAgeRatio) {
    kind = "spike_watch";
    bias = spikeBias;
    action = spikeAction;
    const ratio = since / mean;

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

    if (ctx.focusWeight != null && ctx.focusWeight !== 1) {
      confidence = Math.min(0.58, confidence * ctx.focusWeight);
      if (ctx.focusNote) rationale.push(ctx.focusNote);
    }

    // Predictor policy: only keep spike_watch when learned pocket has edge.
    if (predMode && ctx.entryPolicy) {
      policyAllow = ctx.entryPolicy.allow;
      policyReasons = ctx.entryPolicy.reasons;
      edgeScore = ctx.entryPolicy.edgeScore;
      for (const r of ctx.entryPolicy.reasons.slice(0, 4)) {
        rationale.push(r);
      }
      if (!ctx.entryPolicy.allow) {
        kind = "stand_aside";
        bias = "neutral";
        action = "No learned edge — stand aside";
        confidence = Math.min(confidence, 0.22);
        riskNote =
          "Predictor mode only signals when live age×RSI / age pockets show non-negative expectancy.";
      } else {
        confidence = Math.min(0.72, confidence * (0.75 + edgeScore * 0.5));
        action = `${spikeAction} · edge ${(edgeScore * 100).toFixed(0)}%`;
        riskNote =
          "Learned-pocket hunt. Spikes remain stochastic — size small and respect the stop.";
      }
    } else {
      riskNote =
        "Spike timing is stochastic. Size from horizon odds, not hope.";
    }
  } else {
    action = "Too soon after last spike — skip quiet candles";
    confidence = 0.2;
    rationale.push(
      since != null
        ? `Only ${since} ticks since last spike (need ~${Math.round(mean * watchAgeRatio)}+ to open a hunt).`
        : "Spike timing baseline unavailable.",
    );
    if (p500?.probability != null) {
      rationale.push(`Even now, P(spike≤500 ticks)=${fmtProb(p500)}.`);
    }
  }

  // Chart pattern override: spike-base / crash-ceiling retest can open a hunt
  // even when learned pockets are flat or age window is early.
  const patternMin = Number(process.env.PATTERN_TRADE_MIN || 0.55);
  const patternHit = confluence?.hits?.find((h) => h.id === "spike_base_retest");
  const coolEnough =
    ctx.ticksSinceLastSpike == null || ctx.ticksSinceLastSpike > 40;
  if (
    patternHit &&
    patternHit.score >= patternMin &&
    coolEnough &&
    !ctx.kill.killed
  ) {
    kind = "spike_watch";
    bias = spikeBias;
    policyAllow = true;
    edgeScore = Math.max(edgeScore, patternHit.score);
    confidence = Math.max(confidence, Math.min(0.7, 0.35 + patternHit.score * 0.4));
    action = `${spikeAction} · pattern ${(patternHit.score * 100).toFixed(0)}%`;
    rationale.push(
      `Pattern trade: ${patternHit.label} (${Math.round(patternHit.score * 100)}%) — ${patternHit.detail ?? "shelf retest"}`,
    );
    riskNote =
      "Pattern hunt from spike-base / crash-ceiling retest. Exit only on stop or target.";
  }

  const raw = Number(Math.max(0.08, Math.min(0.72, confidence)).toFixed(2));
  let calibrated = raw;
  if (kind === "spike_watch") {
    const learned = learnedRates?.spike_watch;
    if (learned != null) {
      calibrated = blendConfidence(raw, learned, true);
      rationale.push(
        `Learning blend (spike hunts): ~${(learned * 100).toFixed(0)}% → calibrated ${Math.round(calibrated * 100)}%.`,
      );
    }
    if (predMode && edgeScore > 0) {
      calibrated = Number(
        Math.min(0.78, calibrated * (0.7 + edgeScore * 0.45)).toFixed(2),
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
    edgeScore,
    policyAllow,
    policyReasons,
    confluence,
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
