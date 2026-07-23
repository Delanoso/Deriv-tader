/** Half-life for live-trade decay weighting (ms). Default 7 days. */
export const DECAY_HALF_LIFE_MS = Number(
  process.env.LEARN_DECAY_HALF_LIFE_MS || 7 * 24 * 60 * 60 * 1000,
);

type DecaySignal = {
  status: "pending" | "win" | "loss" | "expired";
  resolvedAt?: number;
  createdAt: number;
  returnPct?: number;
  returnNetPct?: number;
  winAfterCost?: boolean;
};

export function decayWeight(
  resolvedAt: number | undefined,
  now = Date.now(),
  halfLifeMs = DECAY_HALF_LIFE_MS,
): number {
  if (resolvedAt == null) return 0;
  const age = Math.max(0, now - resolvedAt);
  return Math.pow(0.5, age / halfLifeMs);
}

export function decayWeightedRate(
  rows: DecaySignal[],
  pick: (s: DecaySignal) => boolean | null,
): { rate: number | null; effectiveN: number } {
  let wYes = 0;
  let wTotal = 0;
  for (const s of rows) {
    if (s.status !== "win" && s.status !== "loss") continue;
    const verdict = pick(s);
    if (verdict == null) continue;
    const w = decayWeight(s.resolvedAt ?? s.createdAt);
    wTotal += w;
    if (verdict) wYes += w;
  }
  if (wTotal < 1e-9) return { rate: null, effectiveN: 0 };
  return {
    rate: Number((wYes / wTotal).toFixed(3)),
    effectiveN: Number(wTotal.toFixed(2)),
  };
}

export function decayWeightedMean(
  rows: DecaySignal[],
  pick: (s: DecaySignal) => number | null,
): { mean: number | null; effectiveN: number } {
  let wSum = 0;
  let wTotal = 0;
  for (const s of rows) {
    if (s.status !== "win" && s.status !== "loss") continue;
    const v = pick(s);
    if (v == null) continue;
    const w = decayWeight(s.resolvedAt ?? s.createdAt);
    wSum += v * w;
    wTotal += w;
  }
  if (wTotal < 1e-9) return { mean: null, effectiveN: 0 };
  return {
    mean: Number((wSum / wTotal).toFixed(4)),
    effectiveN: Number(wTotal.toFixed(2)),
  };
}
