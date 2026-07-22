import type { RegimeBucketStats } from "../types.js";
import type { AgeRegime } from "./regimes.js";

export interface RegimePreference {
  /** Soft multiplier for raw confidence (≈0.82–1.08). */
  confidenceMult: number;
  /** Best age band when ranking is clear. */
  prefer: AgeRegime | null;
  /** Human-readable note for the opportunity panel. */
  note: string | null;
  /** True when current band is clearly worse than the best band. */
  currentWeak: boolean;
}

interface RankedRegime {
  key: AgeRegime;
  n: number;
  exp: number;
}

function decidedN(stats: RegimeBucketStats["stats"]): number {
  return stats.winsAfterCost + stats.lossesAfterCost;
}

function expectancy(stats: RegimeBucketStats["stats"]): number | null {
  return stats.decayExpectancyNetPct ?? stats.expectancyNetPct;
}

export function rankRegimesByExpectancy(
  buckets: RegimeBucketStats[],
  minN = 6,
): RankedRegime[] {
  return buckets
    .map((b) => ({
      key: b.key as AgeRegime,
      n: decidedN(b.stats),
      exp: expectancy(b.stats),
    }))
    .filter((b): b is RankedRegime => b.n >= minN && b.exp != null)
    .sort((a, b) => b.exp - a.exp);
}

/**
 * Soft preference from seed/live regime buckets — never a hard kill by itself.
 * Prefer live buckets when they have enough mass; otherwise use seed.
 */
export function scoreAgeRegime(
  age: AgeRegime,
  liveBuckets: RegimeBucketStats[] | undefined,
  seedBuckets: RegimeBucketStats[] | undefined,
): RegimePreference {
  const liveRanked = rankRegimesByExpectancy(liveBuckets ?? [], 5);
  const seedRanked = rankRegimesByExpectancy(seedBuckets ?? [], 6);
  const ranked = liveRanked.length >= 2 ? liveRanked : seedRanked;
  const source = liveRanked.length >= 2 ? "live" : "seed";

  if (ranked.length < 2) {
    return {
      confidenceMult: 1,
      prefer: null,
      note: null,
      currentWeak: false,
    };
  }

  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const spread = best.exp - worst.exp;
  if (spread < 0.015) {
    return {
      confidenceMult: 1,
      prefer: best.key,
      note: null,
      currentWeak: false,
    };
  }

  const current = ranked.find((r) => r.key === age);
  const prefer = best.key;

  if (!current) {
    return {
      confidenceMult: 1,
      prefer,
      note: `${source}: prefer ${prefer} age regime (exp ${best.exp.toFixed(3)}%).`,
      currentWeak: false,
    };
  }

  const gapFromBest = best.exp - current.exp;
  const currentWeak = gapFromBest >= 0.02 && current.exp < best.exp;

  let confidenceMult = 1;
  if (current.key === best.key) {
    confidenceMult = 1.06;
  } else if (currentWeak) {
    // Soft dampen — still allow journaling so live can overturn seed.
    confidenceMult = current.exp < 0 ? 0.84 : 0.9;
  } else if (current.key === worst.key && spread >= 0.025) {
    confidenceMult = 0.88;
  }

  const note = currentWeak
    ? `${source}: ${age} underperforms ${prefer} (exp ${current.exp.toFixed(3)}% vs ${best.exp.toFixed(3)}%).`
    : current.key === prefer
      ? `${source}: ${age} is the stronger age band (exp ${current.exp.toFixed(3)}%).`
      : `${source}: prefer ${prefer} over ${age} when choosing hunts.`;

  return {
    confidenceMult: Number(confidenceMult.toFixed(3)),
    prefer,
    note,
    currentWeak,
  };
}
