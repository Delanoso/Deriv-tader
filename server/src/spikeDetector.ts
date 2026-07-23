import type { SpikeEvent, SymbolId, Tick } from "./types.js";

export interface SpikeDetectorOptions {
  zThreshold?: number;
  /** Minimum absolute return to count as a spike (fraction). */
  minAbsReturn?: number;
  /** Also accept returns above this multiple of the median abs return. */
  medianMultiple?: number;
}

/**
 * Detect spikes using a robust z-score on tick-to-tick returns.
 * Boom spikes are large positive jumps; Crash spikes are large negative jumps.
 */
export function detectSpikes(
  symbol: SymbolId,
  ticks: Tick[],
  zThresholdOrOpts: number | SpikeDetectorOptions = 10,
  maybeMinAbsReturn = 0.0008,
): SpikeEvent[] {
  const opts: Required<SpikeDetectorOptions> =
    typeof zThresholdOrOpts === "number"
      ? {
          zThreshold: zThresholdOrOpts,
          minAbsReturn: maybeMinAbsReturn,
          medianMultiple: 80,
        }
      : {
          zThreshold: zThresholdOrOpts.zThreshold ?? 10,
          minAbsReturn: zThresholdOrOpts.minAbsReturn ?? 0.0008,
          medianMultiple: zThresholdOrOpts.medianMultiple ?? 80,
        };

  if (ticks.length < 50) return [];

  const returns: number[] = [];
  for (let i = 1; i < ticks.length; i++) {
    const prev = ticks[i - 1].quote;
    returns.push(prev === 0 ? 0 : (ticks[i].quote - prev) / prev);
  }

  const abs = returns.map((r) => Math.abs(r));
  const median = quantile(abs, 0.5);
  const mad = quantile(
    abs.map((v) => Math.abs(v - median)),
    0.5,
  );
  const scale = mad === 0 ? std(abs) || 1e-9 : mad * 1.4826;
  const dynamicFloor = Math.max(opts.minAbsReturn, median * opts.medianMultiple);

  const expectedSign = symbol.startsWith("BOOM") ? 1 : -1;
  const spikes: SpikeEvent[] = [];
  let lastSpikeIndex = -1;

  for (let i = 0; i < returns.length; i++) {
    const r = returns[i];
    const z = Math.abs(r) / scale;
    const signedOk = expectedSign > 0 ? r > 0 : r < 0;
    if (signedOk && z >= opts.zThreshold && Math.abs(r) >= dynamicFloor) {
      // Avoid counting immediate neighbors of an already-marked spike.
      if (lastSpikeIndex >= 0 && i + 1 - lastSpikeIndex < 5) continue;
      const tickIndex = i + 1;
      spikes.push({
        index: tickIndex,
        epoch: ticks[tickIndex].epoch,
        quote: ticks[tickIndex].quote,
        magnitude: r,
        ticksSincePrevious:
          lastSpikeIndex >= 0 ? tickIndex - lastSpikeIndex : null,
      });
      lastSpikeIndex = tickIndex;
    }
  }

  return spikes;
}

export function interSpikeStats(spikes: SpikeEvent[]): {
  mean: number | null;
  median: number | null;
  shapeApprox: number | null;
} {
  const gaps = spikes
    .map((s) => s.ticksSincePrevious)
    .filter((g): g is number => g != null && g > 0);
  if (gaps.length < 3) {
    return { mean: null, median: null, shapeApprox: null };
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const median = quantile(gaps, 0.5);
  const variance =
    gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / (gaps.length - 1);
  const cv = Math.sqrt(variance) / mean;
  const shapeApprox = cv > 0 ? 1 / cv : null;
  return { mean, median, shapeApprox };
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) /
    Math.max(1, values.length - 1);
  return Math.sqrt(v);
}
