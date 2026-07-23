import { buildCandlesFromTicks, ema } from "../indicators.js";
import { detectSpikes } from "../spikeDetector.js";
import { isBoomSymbol } from "../symbols.js";
import type { Candle, SpikeEvent, SymbolId, Tick } from "../types.js";

export type PlaybookId =
  | "sr_reversal"
  | "ema_cross"
  | "order_block"
  | "spike_base_retest";

export interface PlaybookHit {
  id: PlaybookId;
  label: string;
  /** 0–1 strength of the setup. */
  score: number;
  detail: string;
  /** Key shelf / base / ceiling price when relevant. */
  shelfPrice?: number;
}

export interface ConfluenceSnapshot {
  hits: PlaybookHit[];
  /** How many playbooks agree with the spike direction. */
  count: number;
  /** Combined 0–1 confluence score. */
  score: number;
  /** Short labels for UI / journal. */
  labels: string[];
  /** Best spike-base / crash-ceiling shelf when that pattern is active. */
  shelfPrice?: number;
}

/**
 * Evaluate retail Boom/Crash playbooks as confluence filters
 * (not standalone entry systems).
 */
export function evaluateConfluence(
  symbol: SymbolId,
  ticks: Tick[],
): ConfluenceSnapshot {
  if (ticks.length < 200) {
    return { hits: [], count: 0, score: 0, labels: [] };
  }

  const isBoom = isBoomSymbol(symbol);
  const candles1m = buildCandlesFromTicks(ticks, 60);
  const candles15m = buildCandlesFromTicks(ticks, 900);
  const price = ticks[ticks.length - 1].quote;
  const spikes = detectSpikes(symbol, ticks);

  const hits: PlaybookHit[] = [];

  const sr = supportResistanceHit(isBoom, candles15m, candles1m, price);
  if (sr) hits.push(sr);

  const cross = emaCrossHit(isBoom, candles1m);
  if (cross) hits.push(cross);

  const ob = orderBlockHit(isBoom, candles1m, spikes, price);
  if (ob) hits.push(ob);

  const retest = spikeBaseRetestHit(isBoom, candles1m, spikes, price);
  if (retest) hits.push(retest);

  const score =
    hits.length === 0
      ? 0
      : Math.min(
          1,
          hits.reduce((a, h) => a + h.score, 0) / Math.max(1, hits.length) +
            (hits.length - 1) * 0.12,
        );

  const shelfHit = hits.find((h) => h.id === "spike_base_retest" && h.shelfPrice != null);
  return {
    hits,
    count: hits.length,
    score: Number(score.toFixed(3)),
    labels: hits.map((h) => h.label),
    shelfPrice: shelfHit?.shelfPrice,
  };
}

/** 15m S/R: Boom near support, Crash near resistance, with macro bias. */
function supportResistanceHit(
  isBoom: boolean,
  candles15m: Candle[],
  candles1m: Candle[],
  price: number,
): PlaybookHit | null {
  if (candles15m.length < 12 || candles1m.length < 5) return null;

  const swings = swingLevels(candles15m, 2);
  if (!swings.supports.length && !swings.resistances.length) return null;

  const atr15 = roughAtr(candles15m, 8);
  const band = Math.max(price * 0.0008, (atr15 ?? price * 0.002) * 0.55);

  // Macro trend on 15m EMA9 vs EMA21.
  const closes15 = candles15m.map((c) => c.close);
  const e9 = ema(closes15, 9);
  const e21 = ema(closes15, 21);
  const macroOk =
    e9 != null && e21 != null
      ? isBoom
        ? e9 >= e21 * 0.999
        : e9 <= e21 * 1.001
      : true;

  if (isBoom) {
    const support = nearestBelow(swings.supports, price);
    if (support == null) return null;
    const dist = price - support;
    if (dist < 0 || dist > band) return null;
    // Prefer price still dipping / flat on 1m into the zone.
    const last1 = candles1m[candles1m.length - 1];
    const prev1 = candles1m[candles1m.length - 2];
    const dipping = last1.close <= prev1.close * 1.0005;
    if (!dipping && dist > band * 0.35) return null;
    const closeness = 1 - dist / band;
    const score = Math.min(
      0.92,
      0.45 + closeness * 0.35 + (macroOk ? 0.12 : 0),
    );
    return {
      id: "sr_reversal",
      label: "15m support",
      score: Number(score.toFixed(3)),
      detail: `Price ${pct(dist / price)} above 15m support ${support.toFixed(3)}${macroOk ? " · macro ok" : ""}`,
    };
  }

  const resistance = nearestAbove(swings.resistances, price);
  if (resistance == null) return null;
  const dist = resistance - price;
  if (dist < 0 || dist > band) return null;
  const last1 = candles1m[candles1m.length - 1];
  const prev1 = candles1m[candles1m.length - 2];
  const lifting = last1.close >= prev1.close * 0.9995;
  if (!lifting && dist > band * 0.35) return null;
  const closeness = 1 - dist / band;
  const score = Math.min(
    0.92,
    0.45 + closeness * 0.35 + (macroOk ? 0.12 : 0),
  );
  return {
    id: "sr_reversal",
    label: "15m resistance",
    score: Number(score.toFixed(3)),
    detail: `Price ${pct(dist / price)} below 15m resistance ${resistance.toFixed(3)}${macroOk ? " · macro ok" : ""}`,
  };
}

/** Fresh 9/21 EMA cross on 1m in the spike direction. */
function emaCrossHit(isBoom: boolean, candles1m: Candle[]): PlaybookHit | null {
  if (candles1m.length < 30) return null;
  const closes = candles1m.map((c) => c.close);
  const series9 = emaSeries(closes, 9);
  const series21 = emaSeries(closes, 21);
  if (!series9.length || !series21.length) return null;

  // Align to shared tail length.
  const n = Math.min(series9.length, series21.length);
  const a9 = series9.slice(-n);
  const a21 = series21.slice(-n);

  // Look for a cross in the last 3 bars.
  for (let look = 1; look <= 3; look++) {
    const i = a9.length - look;
    if (i < 1) continue;
    const prevDiff = a9[i - 1] - a21[i - 1];
    const curDiff = a9[i] - a21[i];
    const bullCross = prevDiff <= 0 && curDiff > 0;
    const bearCross = prevDiff >= 0 && curDiff < 0;
    if (isBoom && bullCross) {
      const freshness = look === 1 ? 0.82 : look === 2 ? 0.7 : 0.58;
      return {
        id: "ema_cross",
        label: "EMA 9/21 cross up",
        score: freshness,
        detail: `1m EMA9 crossed above EMA21 ${look} bar(s) ago`,
      };
    }
    if (!isBoom && bearCross) {
      const freshness = look === 1 ? 0.82 : look === 2 ? 0.7 : 0.58;
      return {
        id: "ema_cross",
        label: "EMA 9/21 cross down",
        score: freshness,
        detail: `1m EMA9 crossed below EMA21 ${look} bar(s) ago`,
      };
    }
  }
  return null;
}

/**
 * Supply/demand order block: last opposing candle before a large spike.
 * Boom buys demand (bearish OB before up-spike); Crash sells supply.
 */
function orderBlockHit(
  isBoom: boolean,
  candles1m: Candle[],
  spikes: SpikeEvent[],
  price: number,
): PlaybookHit | null {
  if (candles1m.length < 40 || spikes.length < 3) return null;

  // Use the most recent "massive" spikes to build zones (skip the latest few
  // minutes so the zone is from a completed move).
  const nowEpoch = candles1m[candles1m.length - 1].epoch;
  const candidates = spikes
    .filter((s) => s.epoch < nowEpoch - 180)
    .slice(-12);

  const zones: { low: number; high: number; mag: number; epoch: number }[] = [];
  for (const spike of candidates) {
    const idx = candles1m.findIndex((c) => c.epoch >= spike.epoch - 60);
    if (idx < 2) continue;
    // Candle that closed just before the spike candle.
    const before = candles1m[idx - 1];
    const bearish = before.close < before.open;
    const bullish = before.close > before.open;
    if (isBoom && !bearish) continue;
    if (!isBoom && !bullish) continue;
    const mag = Math.abs(spike.magnitude);
    // Keep only relatively large spikes for institutional footprint.
    if (mag < 0.0015) continue;
    zones.push({
      low: Math.min(before.open, before.close, before.low),
      high: Math.max(before.open, before.close, before.high),
      mag,
      epoch: before.epoch,
    });
  }

  if (!zones.length) return null;

  // Prefer the nearest zone that price has returned into.
  let best: (typeof zones)[0] | null = null;
  let bestDist = Infinity;
  for (const z of zones) {
    const mid = (z.low + z.high) / 2;
    const half = Math.max((z.high - z.low) * 0.5, price * 0.0004);
    const inZone = price >= z.low - half * 0.15 && price <= z.high + half * 0.15;
    if (!inZone) continue;
    const dist = Math.abs(price - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = z;
    }
  }
  if (!best) return null;

  const width = Math.max(best.high - best.low, price * 0.0003);
  const closeness = 1 - Math.min(1, bestDist / width);
  const score = Math.min(0.9, 0.5 + closeness * 0.3 + Math.min(0.15, best.mag * 40));

  return {
    id: "order_block",
    label: isBoom ? "Demand zone" : "Supply zone",
    score: Number(score.toFixed(3)),
    detail: `Price inside ${isBoom ? "demand" : "supply"} block ${best.low.toFixed(3)}–${best.high.toFixed(3)}`,
  };
}

export interface PlaybookEvalRow {
  playbook: PlaybookId | "baseline";
  signals: number;
  spikeHits: number;
  hitRate: number | null;
  avgMfePct: number | null;
  note: string;
}

/**
 * Walk history: when a playbook fires on a 1m bar close, did a favorable
 * spike print within `horizonTicks`? Compare vs baseline (every mid-age bar).
 */
export function evaluatePlaybooksHistorically(
  symbol: SymbolId,
  ticks: Tick[],
  horizonTicks = 400,
): PlaybookEvalRow[] {
  if (ticks.length < 1500) {
    return [
      {
        playbook: "baseline",
        signals: 0,
        spikeHits: 0,
        hitRate: null,
        avgMfePct: null,
        note: "Need more ticks to evaluate",
      },
    ];
  }

  const isBoom = isBoomSymbol(symbol);
  const spikes = detectSpikes(symbol, ticks);
  const candles1m = buildCandlesFromTicks(ticks, 60);

  type Acc = { signals: number; hits: number; mfe: number[] };
  const acc: Record<PlaybookId | "baseline", Acc> = {
    baseline: { signals: 0, hits: 0, mfe: [] },
    sr_reversal: { signals: 0, hits: 0, mfe: [] },
    ema_cross: { signals: 0, hits: 0, mfe: [] },
    order_block: { signals: 0, hits: 0, mfe: [] },
    spike_base_retest: { signals: 0, hits: 0, mfe: [] },
  };

  // Sample sparsely — full bar walk × spike detect is too heavy on 15k ticks.
  const start = Math.max(80, Math.floor(candles1m.length * 0.3));
  const step = Math.max(3, Math.floor((candles1m.length - start) / 40));

  for (let ci = start; ci < candles1m.length - 2; ci += step) {
    const epoch = candles1m[ci].epoch;
    let tickEnd = ticks.findIndex((t) => t.epoch > epoch + 59);
    if (tickEnd < 0) tickEnd = ticks.length;
    // Keep evaluation windows bounded for speed.
    const sliceStart = Math.max(0, tickEnd - 8000);
    const window = ticks.slice(sliceStart, tickEnd);
    if (window.length < 400) continue;

    const conf = evaluateConfluence(symbol, window);
    const price = window[window.length - 1].quote;
    const absIndex = tickEnd - 1;
    const outcome = forwardSpikeOutcome(
      spikes,
      absIndex,
      price,
      horizonTicks,
      isBoom,
      ticks,
    );

    acc.baseline.signals += 1;
    if (outcome.hit) acc.baseline.hits += 1;
    acc.baseline.mfe.push(outcome.mfePct);

    for (const h of conf.hits) {
      const bucket = acc[h.id];
      bucket.signals += 1;
      if (outcome.hit) bucket.hits += 1;
      bucket.mfe.push(outcome.mfePct);
    }
  }

  const rows: PlaybookEvalRow[] = (
    [
      "baseline",
      "sr_reversal",
      "ema_cross",
      "order_block",
      "spike_base_retest",
    ] as const
  ).map((id) => {
    const a = acc[id];
    const hitRate = a.signals ? a.hits / a.signals : null;
    const avgMfePct = a.mfe.length
      ? a.mfe.reduce((x, y) => x + y, 0) / a.mfe.length
      : null;
    return {
      playbook: id,
      signals: a.signals,
      spikeHits: a.hits,
      hitRate,
      avgMfePct,
      note: noteFor(
        id,
        hitRate,
        acc.baseline.signals ? acc.baseline.hits / acc.baseline.signals : null,
      ),
    };
  });

  return rows;
}

/**
 * User-observed pattern:
 * retest of the base of a prior spike, with a tight cluster / W shape at the
 * same shelf before the next larger move in the spike direction.
 */
function spikeBaseRetestHit(
  isBoom: boolean,
  candles1m: Candle[],
  spikes: SpikeEvent[],
  price: number,
): PlaybookHit | null {
  if (candles1m.length < 24 || spikes.length < 3) return null;

  const atr1 = roughAtr(candles1m, 12) ?? price * 0.0015;
  const baseBand = Math.max(price * 0.00045, atr1 * 0.45);
  const recent = spikes.slice(-10).reverse();

  for (const spike of recent) {
    const idx = candles1m.findIndex((c) => c.epoch >= spike.epoch);
    if (idx < 2 || idx >= candles1m.length - 4) continue;
    const anchor = candles1m[Math.max(0, idx - 1)];
    const base = isBoom ? anchor.low : anchor.high;

    // Price must be back near that old shelf now.
    const dist = Math.abs(price - base);
    if (dist > baseBand) continue;

    // Inspect the last few candles for repeated touches around the same shelf.
    const cluster = candles1m.slice(-6);
    const touches = cluster.filter((c) =>
      isBoom
        ? Math.abs(c.low - base) <= baseBand
        : Math.abs(c.high - base) <= baseBand,
    );
    if (touches.length < 2) continue;

    // Require a small W / double-bottom (or M / double-top for Crash).
    const pivots = cluster.map((c) => (isBoom ? c.low : c.high));
    const pivotSpan = Math.max(...pivots) - Math.min(...pivots);
    if (pivotSpan > baseBand * 3.2) continue;

    const first = touches[0];
    const last = touches[touches.length - 1];
    const separated = Math.abs(last.epoch - first.epoch) >= 60;
    if (!separated) continue;

    const miniSpikes = cluster.filter((c) =>
      isBoom
        ? c.close > c.open && c.high - c.low >= baseBand * 0.7
        : c.close < c.open && c.high - c.low >= baseBand * 0.7,
    ).length;

    const score = Math.min(
      0.94,
      0.52 +
        (touches.length >= 3 ? 0.12 : 0.06) +
        Math.min(0.16, miniSpikes * 0.05) +
        (1 - Math.min(1, dist / baseBand)) * 0.14,
    );

    return {
      id: "spike_base_retest",
      label: isBoom ? "Spike-base retest" : "Crash-ceiling retest",
      score: Number(score.toFixed(3)),
      detail: `${
        isBoom ? "Retesting prior boom base" : "Retesting prior crash ceiling"
      } near ${base.toFixed(3)} with ${touches.length} shelf touch${
        touches.length === 1 ? "" : "es"
      } and ${miniSpikes} micro-spike${miniSpikes === 1 ? "" : "s"}`,
      shelfPrice: Number(base.toFixed(5)),
    };
  }

  return null;
}

function forwardSpikeOutcome(
  spikes: SpikeEvent[],
  fromTickIndex: number,
  entry: number,
  horizonTicks: number,
  isBoom: boolean,
  ticks: Tick[],
): { hit: boolean; mfePct: number } {
  const end = Math.min(ticks.length - 1, fromTickIndex + horizonTicks);
  let mfe = 0;
  for (let i = fromTickIndex + 1; i <= end; i++) {
    const q = ticks[i].quote;
    const move = isBoom ? (q - entry) / entry : (entry - q) / entry;
    if (move > mfe) mfe = move;
  }
  const hit = spikes.some(
    (s) => s.index > fromTickIndex && s.index <= fromTickIndex + horizonTicks,
  );
  return { hit, mfePct: mfe * 100 };
}

function noteFor(
  id: PlaybookId | "baseline",
  hitRate: number | null,
  base: number | null,
): string {
  if (id === "baseline") return "Random mid-sample bars (control)";
  if (hitRate == null || base == null) return "Insufficient signals";
  const lift = hitRate - base;
  if (lift >= 0.05) return `Helps vs baseline (+${(lift * 100).toFixed(1)} pp)`;
  if (lift <= -0.05) return `Hurts vs baseline (${(lift * 100).toFixed(1)} pp)`;
  return `Flat vs baseline (${(lift * 100).toFixed(1)} pp)`;
}

function swingLevels(candles: Candle[], pivot = 2): {
  supports: number[];
  resistances: number[];
} {
  const supports: number[] = [];
  const resistances: number[] = [];
  for (let i = pivot; i < candles.length - pivot; i++) {
    let isLow = true;
    let isHigh = true;
    for (let j = 1; j <= pivot; j++) {
      if (candles[i].low > candles[i - j].low || candles[i].low > candles[i + j].low) {
        isLow = false;
      }
      if (
        candles[i].high < candles[i - j].high ||
        candles[i].high < candles[i + j].high
      ) {
        isHigh = false;
      }
    }
    if (isLow) supports.push(candles[i].low);
    if (isHigh) resistances.push(candles[i].high);
  }
  return {
    supports: supports.slice(-8),
    resistances: resistances.slice(-8),
  };
}

function nearestBelow(levels: number[], price: number): number | null {
  let best: number | null = null;
  for (const lv of levels) {
    if (lv <= price && (best == null || lv > best)) best = lv;
  }
  return best;
}

function nearestAbove(levels: number[], price: number): number | null {
  let best: number | null = null;
  for (const lv of levels) {
    if (lv >= price && (best == null || lv < best)) best = lv;
  }
  return best;
}

function roughAtr(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1] ?? c;
    trs.push(
      Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)),
    );
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function pct(frac: number): string {
  return `${(frac * 100).toFixed(3)}%`;
}

/**
 * Soft edge boost from confluence.
 * Disabled by default after live history showed order-blocks / S/R / EMA-cross
 * more often flat or harmful than helpful vs baseline spike timing.
 * Set PLAYBOOK_EDGE_BOOST=1 to re-enable experimentally.
 */
export function confluenceEdgeBoost(conf: ConfluenceSnapshot): {
  boost: number;
  reasons: string[];
} {
  const enabled =
    process.env.PLAYBOOK_EDGE_BOOST === "1" ||
    process.env.PLAYBOOK_EDGE_BOOST === "true";
  if (!enabled || conf.count === 0) {
    return {
      boost: 0,
      reasons:
        conf.count > 0
          ? conf.hits.map(
              (h) =>
                `Playbook (info): ${h.label} (${Math.round(h.score * 100)}%)`,
            )
          : [],
    };
  }
  const boost = Math.min(0.14, conf.count * 0.045 + conf.score * 0.06);
  return {
    boost: Number(boost.toFixed(3)),
    reasons: conf.hits.map(
      (h) => `Playbook: ${h.label} (${Math.round(h.score * 100)}%)`,
    ),
  };
}
