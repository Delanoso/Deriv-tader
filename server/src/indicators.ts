import type { Candle, Tick } from "./types.js";

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    trs.push(
      Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close),
      ),
    );
  }
  return sma(trs, period);
}

export function momentum(values: number[], lookback = 20): number | null {
  if (values.length <= lookback) return null;
  const latest = values[values.length - 1];
  const earlier = values[values.length - 1 - lookback];
  if (earlier === 0) return null;
  return ((latest - earlier) / earlier) * 100;
}

export function buildCandlesFromTicks(
  ticks: Tick[],
  granularitySec = 60,
): Candle[] {
  if (ticks.length === 0) return [];
  const candles: Candle[] = [];
  let bucket = Math.floor(ticks[0].epoch / granularitySec) * granularitySec;
  let open = ticks[0].quote;
  let high = ticks[0].quote;
  let low = ticks[0].quote;
  let close = ticks[0].quote;

  for (const tick of ticks) {
    const b = Math.floor(tick.epoch / granularitySec) * granularitySec;
    if (b !== bucket) {
      candles.push({ epoch: bucket, open, high, low, close });
      bucket = b;
      open = tick.quote;
      high = tick.quote;
      low = tick.quote;
      close = tick.quote;
    } else {
      high = Math.max(high, tick.quote);
      low = Math.min(low, tick.quote);
      close = tick.quote;
    }
  }
  candles.push({ epoch: bucket, open, high, low, close });
  return candles;
}
