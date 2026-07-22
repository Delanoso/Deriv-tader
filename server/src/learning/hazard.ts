import type { SpikeEvent } from "../types.js";

export const SPIKE_HORIZONS = [100, 500, 1000, 2000] as const;
export type SpikeHorizon = (typeof SPIKE_HORIZONS)[number];

export interface HorizonProb {
  horizonTicks: number;
  /** Empirical P(spike within horizon | survived this long). */
  probability: number | null;
  /** Sample size: gaps still open at current age. */
  survivors: number;
  /** Gaps that spiked inside the horizon among survivors. */
  hits: number;
  /** True when using exponential fallback (no survivors at this age). */
  fallback?: boolean;
}

export interface HazardBin {
  /** Start of age bin (ticks since last spike). */
  ageFrom: number;
  ageTo: number;
  /** P(spike in this bin | survived to ageFrom). */
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
  /** Best short-horizon probability currently available. */
  bestHorizon: HorizonProb | null;
  hazardCurve: HazardBin[];
  /** True when late-age short-horizon odds barely beat early-age odds. */
  timingEdgeWeak: boolean;
  timingNote: string;
}

/**
 * Build conditional spike probabilities from completed inter-spike gaps.
 */
export function buildSpikeForecast(
  spikes: SpikeEvent[],
  ticksSinceLastSpike: number | null,
  horizons: readonly number[] = SPIKE_HORIZONS,
): SpikeForecast {
  const gaps = spikes
    .map((s) => s.ticksSincePrevious)
    .filter((g): g is number => g != null && g > 0)
    .sort((a, b) => a - b);

  const age = ticksSinceLastSpike;
  const meanGap =
    gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const medianGap =
    gaps.length > 0 ? gaps[Math.floor((gaps.length - 1) / 2)] : null;

  const horizonRows: HorizonProb[] = horizons.map((h) =>
    conditionalSpikeProb(gaps, age, h),
  );

  const hazardCurve = buildHazardCurve(gaps, 8);
  const timing = assessTimingEdge(gaps);

  const usable = horizonRows
    .filter((h) => h.probability != null && (!h.fallback ? (h.survivors ?? 0) >= 3 : true))
    .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));

  let timingNote = timing.note;
  if (age != null && gaps.length > 0 && age >= gaps[gaps.length - 1]) {
    timingNote =
      "Already past every observed gap in this window — showing memoryless residual odds (weak timing evidence).";
  }

  return {
    ticksSinceLastSpike: age,
    gapSampleSize: gaps.length,
    meanGap,
    medianGap,
    horizons: horizonRows,
    bestHorizon: usable[0] ?? null,
    hazardCurve,
    timingEdgeWeak: timing.weak,
    timingNote,
  };
}

export function conditionalSpikeProb(
  gaps: number[],
  age: number | null,
  horizon: number,
): HorizonProb {
  if (age == null || gaps.length < 5) {
    return {
      horizonTicks: horizon,
      probability: null,
      survivors: 0,
      hits: 0,
    };
  }

  // Survivors: gaps that lasted longer than current age (still "at risk").
  const survivors = gaps.filter((g) => g > age);
  if (survivors.length === 0) {
    // Already waited longer than every observed gap — no conditional sample.
    // Fall back to memoryless residual odds so the UI still has a number.
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const p = mean > 0 ? 1 - Math.exp(-horizon / mean) : null;
    return {
      horizonTicks: horizon,
      probability: p != null ? Number(p.toFixed(3)) : null,
      survivors: 0,
      hits: 0,
      fallback: true,
    };
  }

  const hits = survivors.filter((g) => g <= age + horizon).length;
  return {
    horizonTicks: horizon,
    probability: Number((hits / survivors.length).toFixed(3)),
    survivors: survivors.length,
    hits,
  };
}

function buildHazardCurve(gaps: number[], bins = 8): HazardBin[] {
  if (gaps.length < 8) return [];

  const max = gaps[gaps.length - 1];
  const width = Math.max(50, Math.ceil(max / bins));
  const out: HazardBin[] = [];

  for (let i = 0; i < bins; i++) {
    const ageFrom = i * width;
    const ageTo = (i + 1) * width;
    const survivors = gaps.filter((g) => g > ageFrom);
    if (survivors.length < 3) {
      out.push({
        ageFrom,
        ageTo,
        hazard: null,
        survivors: survivors.length,
        events: 0,
      });
      continue;
    }
    const events = survivors.filter((g) => g <= ageTo).length;
    out.push({
      ageFrom,
      ageTo,
      hazard: Number((events / survivors.length).toFixed(3)),
      survivors: survivors.length,
      events,
    });
  }
  return out;
}

function assessTimingEdge(gaps: number[]): { weak: boolean; note: string } {
  if (gaps.length < 12) {
    return {
      weak: true,
      note: "Need more completed gaps before trusting a timing edge.",
    };
  }

  const sorted = [...gaps].sort((a, b) => a - b);
  const q25 = sorted[Math.floor(sorted.length * 0.25)];
  const q75 = sorted[Math.floor(sorted.length * 0.75)];

  // Compare P(spike in next 500 | age=q25) vs P(... | age=q75)
  const early = conditionalSpikeProb(sorted, q25, 500);
  const late = conditionalSpikeProb(sorted, q75, 500);

  if (early.probability == null || late.probability == null) {
    return {
      weak: true,
      note: "Not enough survivors in age buckets to judge timing edge.",
    };
  }

  const lift = late.probability - early.probability;
  if (lift < 0.05) {
    return {
      weak: true,
      note: `Timing edge looks weak: P(spike≤500|late) ${late.probability} vs early ${early.probability} (lift ${lift.toFixed(2)}).`,
    };
  }

  return {
    weak: false,
    note: `Some timing lift detected: late-age 500-tick odds ${late.probability} vs early ${early.probability}.`,
  };
}
