import { atr, buildCandlesFromTicks, ema, momentum, rsi } from "../indicators.js";
import type { Tick } from "../types.js";
import { blendVolConfidence } from "./journal.js";
import type {
  VolAnalysis,
  VolBias,
  VolCandle,
  VolJournalSignal,
  VolPrediction,
  VolSymbolId,
  VolTick,
} from "./types.js";
import { VOL_DISPLAY } from "./types.js";

const HORIZON_TICKS = 400;

export function analyzeVol(
  symbol: VolSymbolId,
  ticks: VolTick[],
  calibrated?: Partial<Record<"up" | "down", number>>,
): VolAnalysis {
  const candles = buildCandlesFromTicks(ticks as Tick[], 60);
  const closes = candles.map((c) => c.close);
  const last = ticks.length ? ticks[ticks.length - 1] : null;
  const price = last?.quote ?? null;

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const mom = momentum(closes, 20);
  const { high: swingHigh, low: swingLow } = recentSwings(candles, 30);

  const prediction = scoreVolDirection({
    price,
    ema9,
    ema21,
    rsi14,
    atr14,
    mom,
    swingHigh,
    swingLow,
    lastEpoch: last?.epoch ?? null,
    calibrated,
  });

  return {
    symbol,
    displayName: VOL_DISPLAY[symbol],
    lastQuote: price,
    lastEpoch: last?.epoch ?? null,
    ticksCollected: ticks.length,
    indicators: {
      rsi14,
      ema9,
      ema21,
      atr14,
      momentum20: mom,
      swingHigh,
      swingLow,
    },
    prediction,
    candles: candles.slice(-180) as VolCandle[],
    recentTicks: ticks.slice(-400),
    updatedAt: Date.now(),
  };
}

function scoreVolDirection(ctx: {
  price: number | null;
  ema9: number | null;
  ema21: number | null;
  rsi14: number | null;
  atr14: number | null;
  mom: number | null;
  swingHigh: number | null;
  swingLow: number | null;
  lastEpoch: number | null;
  calibrated?: Partial<Record<"up" | "down", number>>;
}): VolPrediction {
  const rationale: string[] = [];
  let score = 0;

  if (ctx.price == null || ctx.atr14 == null || ctx.atr14 <= 0) {
    return {
      bias: "neutral",
      action: "Collecting volatility baseline",
      confidence: 0.15,
      horizonTicks: HORIZON_TICKS,
      targets: {
        target: 0,
        stretch: 0,
        invalidation: 0,
        expectedMovePct: 0,
        method: "n/a",
        expectedEpoch: null,
      },
      rationale: ["Need more candles/ATR before projecting direction and range."],
      riskNote: "Volatility indices can reverse quickly — wait for structure.",
    };
  }

  if (ctx.ema9 != null && ctx.ema21 != null) {
    if (ctx.ema9 > ctx.ema21) {
      score += 1;
      rationale.push("EMA9 above EMA21 — short-term uptrend.");
    } else if (ctx.ema9 < ctx.ema21) {
      score -= 1;
      rationale.push("EMA9 below EMA21 — short-term downtrend.");
    }
  }

  if (ctx.mom != null) {
    if (ctx.mom > 0.05) {
      score += 1;
      rationale.push(`Momentum +${ctx.mom.toFixed(2)}% supports upside.`);
    } else if (ctx.mom < -0.05) {
      score -= 1;
      rationale.push(`Momentum ${ctx.mom.toFixed(2)}% supports downside.`);
    }
  }

  if (ctx.rsi14 != null) {
    if (ctx.rsi14 >= 70) {
      score -= 0.5;
      rationale.push(`RSI ${ctx.rsi14.toFixed(1)} stretched high — fade risk up.`);
    } else if (ctx.rsi14 <= 30) {
      score += 0.5;
      rationale.push(`RSI ${ctx.rsi14.toFixed(1)} stretched low — bounce risk up.`);
    } else if (ctx.rsi14 > 55) {
      score += 0.25;
    } else if (ctx.rsi14 < 45) {
      score -= 0.25;
    }
  }

  let bias: VolBias = "neutral";
  if (score >= 0.75) bias = "up";
  else if (score <= -0.75) bias = "down";

  const atr = ctx.atr14;
  const price = ctx.price;
  let target: number;
  let stretch: number;
  let invalidation: number;
  let method = "ATR projection";

  if (bias === "up") {
    const atrTarget = price + atr * 1.5;
    const atrStretch = price + atr * 2.5;
    const struct =
      ctx.swingHigh != null && ctx.swingHigh > price ? ctx.swingHigh : null;
    target = struct != null && struct < atrTarget ? struct : atrTarget;
    stretch = Math.max(atrStretch, struct ?? atrStretch);
    invalidation =
      ctx.swingLow != null && ctx.swingLow < price
        ? Math.max(ctx.swingLow, price - atr)
        : price - atr;
    if (struct != null && struct < atrTarget) method = "Swing high + ATR stretch";
    rationale.push(
      `Upside path: target ${target.toFixed(5)} (~${pct(price, target)}%), stretch ${stretch.toFixed(5)}.`,
    );
  } else if (bias === "down") {
    const atrTarget = price - atr * 1.5;
    const atrStretch = price - atr * 2.5;
    const struct =
      ctx.swingLow != null && ctx.swingLow < price ? ctx.swingLow : null;
    target = struct != null && struct > atrTarget ? struct : atrTarget;
    stretch = Math.min(atrStretch, struct ?? atrStretch);
    invalidation =
      ctx.swingHigh != null && ctx.swingHigh > price
        ? Math.min(ctx.swingHigh, price + atr)
        : price + atr;
    if (struct != null && struct > atrTarget) method = "Swing low + ATR stretch";
    rationale.push(
      `Downside path: target ${target.toFixed(5)} (~${pct(price, target)}%), stretch ${stretch.toFixed(5)}.`,
    );
  } else {
    target = price + atr;
    stretch = price + atr * 2;
    invalidation = price - atr;
    rationale.push("No clear directional edge — stand aside.");
  }

  let confidence = Math.min(0.62, 0.28 + Math.abs(score) * 0.12);
  if (bias === "neutral") confidence = 0.2;

  const raw = Number(confidence.toFixed(2));
  let calibrated = raw;
  if (bias === "up" || bias === "down") {
    calibrated = blendVolConfidence(raw, ctx.calibrated?.[bias]);
    if (ctx.calibrated?.[bias] != null) {
      rationale.push(
        `Learning blend (${bias}): ~${((ctx.calibrated[bias] as number) * 100).toFixed(0)}% → ${Math.round(calibrated * 100)}%.`,
      );
    }
  }

  return {
    bias,
    action:
      bias === "up"
        ? "Expect upside toward target / stretch"
        : bias === "down"
          ? "Expect downside toward target / stretch"
          : "No directional call — wait",
    confidence: raw,
    calibratedConfidence: calibrated,
    horizonTicks: HORIZON_TICKS,
    targets: {
      target: Number(target.toFixed(6)),
      stretch: Number(stretch.toFixed(6)),
      invalidation: Number(invalidation.toFixed(6)),
      expectedMovePct: Number(Math.abs(pctNum(price, target)).toFixed(4)),
      method,
      expectedEpoch:
        ctx.lastEpoch != null ? ctx.lastEpoch + HORIZON_TICKS : null,
    },
    rationale,
    riskNote:
      "Vol 250 moves fast. Treat targets as research levels, not guarantees. Exit if invalidation prints first.",
  };
}

export function resolveVolPending(
  pending: VolJournalSignal[],
  ticks: VolTick[],
  update: (id: string, patch: Partial<VolJournalSignal>) => void,
): number {
  let n = 0;
  for (const signal of pending) {
    const entryIdx = findIndex(ticks, signal.entryEpoch, signal.entryTickIndex);
    if (entryIdx < 0) continue;
    const end = Math.min(ticks.length - 1, entryIdx + signal.horizonTicks);
    if (ticks.length - 1 - entryIdx < 8) continue;

    let hitTarget = false;
    let hitInvalidation = false;
    let exitIdx = end;
    let mfe = 0;
    let mae = 0;

    for (let i = entryIdx + 1; i <= end; i++) {
      const px = ticks[i].quote;
      const signed = ((px - signal.entryPrice) / signal.entryPrice) * 100;
      const fav = signal.bias === "up" ? signed : -signed;
      const adv = -fav;
      mfe = Math.max(mfe, fav);
      mae = Math.max(mae, adv);

      if (signal.bias === "up") {
        if (px >= signal.target) {
          hitTarget = true;
          exitIdx = i;
          break;
        }
        if (px <= signal.invalidation) {
          hitInvalidation = true;
          exitIdx = i;
          break;
        }
      } else {
        if (px <= signal.target) {
          hitTarget = true;
          exitIdx = i;
          break;
        }
        if (px >= signal.invalidation) {
          hitInvalidation = true;
          exitIdx = i;
          break;
        }
      }
    }

    const reachedHorizon = exitIdx === end && !hitTarget && !hitInvalidation;
    if (!hitTarget && !hitInvalidation && !reachedHorizon) continue;

    const exit = ticks[exitIdx];
    const retSigned =
      signal.bias === "up"
        ? ((exit.quote - signal.entryPrice) / signal.entryPrice) * 100
        : ((signal.entryPrice - exit.quote) / signal.entryPrice) * 100;

    const status = hitTarget || retSigned > 0 ? "win" : "loss";
    update(signal.id, {
      status: hitTarget ? "win" : hitInvalidation ? "loss" : status,
      resolvedAt: Date.now(),
      exitPrice: exit.quote,
      exitEpoch: exit.epoch,
      returnPct: Number(retSigned.toFixed(5)),
      mfePct: Number(mfe.toFixed(5)),
      maePct: Number(mae.toFixed(5)),
      hitTarget,
      hitInvalidation,
      note: hitTarget
        ? "Hit primary target"
        : hitInvalidation
          ? "Hit invalidation first"
          : "Horizon expired",
    });
    n += 1;
  }
  return n;
}

export function bootstrapVolHistory(
  symbol: VolSymbolId,
  ticks: VolTick[],
  max = 60,
): VolJournalSignal[] {
  if (ticks.length < 900) return [];
  const out: VolJournalSignal[] = [];
  let lastBias: string | null = null;

  for (let i = 500; i < ticks.length - HORIZON_TICKS && out.length < max; i += 80) {
    const window = ticks.slice(0, i + 1);
    const analysis = analyzeVol(symbol, window);
    const pred = analysis.prediction;
    if (pred.bias === "neutral") continue;
    if (pred.bias === lastBias) continue;
    lastBias = pred.bias;

    const entry = window[window.length - 1];
    const future = ticks;
    const entryIdx = i;
    const end = Math.min(ticks.length - 1, entryIdx + pred.horizonTicks);
    let hitTarget = false;
    let hitInvalidation = false;
    let exitIdx = end;
    let mfe = 0;
    let mae = 0;

    for (let j = entryIdx + 1; j <= end; j++) {
      const px = future[j].quote;
      const signed = ((px - entry.quote) / entry.quote) * 100;
      const fav = pred.bias === "up" ? signed : -signed;
      mfe = Math.max(mfe, fav);
      mae = Math.max(mae, -fav);
      if (pred.bias === "up") {
        if (px >= pred.targets.target) {
          hitTarget = true;
          exitIdx = j;
          break;
        }
        if (px <= pred.targets.invalidation) {
          hitInvalidation = true;
          exitIdx = j;
          break;
        }
      } else {
        if (px <= pred.targets.target) {
          hitTarget = true;
          exitIdx = j;
          break;
        }
        if (px >= pred.targets.invalidation) {
          hitInvalidation = true;
          exitIdx = j;
          break;
        }
      }
    }

    const exit = future[exitIdx];
    const ret =
      pred.bias === "up"
        ? ((exit.quote - entry.quote) / entry.quote) * 100
        : ((entry.quote - exit.quote) / entry.quote) * 100;

    out.push({
      id: `vol-boot-${entry.epoch}-${out.length}`,
      symbol,
      bias: pred.bias,
      confidence: pred.confidence,
      entryPrice: entry.quote,
      entryEpoch: entry.epoch,
      entryTickIndex: entryIdx,
      target: pred.targets.target,
      stretch: pred.targets.stretch,
      invalidation: pred.targets.invalidation,
      horizonTicks: pred.horizonTicks,
      createdAt: Date.now(),
      status: hitTarget ? "win" : hitInvalidation || ret <= 0 ? "loss" : "win",
      resolvedAt: Date.now(),
      exitPrice: exit.quote,
      exitEpoch: exit.epoch,
      returnPct: Number(ret.toFixed(5)),
      mfePct: Number(mfe.toFixed(5)),
      maePct: Number(mae.toFixed(5)),
      hitTarget,
      hitInvalidation,
      note: "bootstrap",
      source: "bootstrap",
    });
  }
  return out;
}

function recentSwings(
  candles: { high: number; low: number }[],
  lookback: number,
): { high: number | null; low: number | null } {
  if (candles.length < 5) return { high: null, low: null };
  const slice = candles.slice(-lookback);
  return {
    high: Math.max(...slice.map((c) => c.high)),
    low: Math.min(...slice.map((c) => c.low)),
  };
}

function findIndex(ticks: VolTick[], epoch: number, hint: number): number {
  if (hint >= 0 && hint < ticks.length && ticks[hint].epoch === epoch) return hint;
  for (let i = ticks.length - 1; i >= Math.max(0, ticks.length - 6000); i--) {
    if (ticks[i].epoch === epoch) return i;
  }
  return -1;
}

function pct(from: number, to: number): string {
  return pctNum(from, to).toFixed(3);
}

function pctNum(from: number, to: number): number {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}
