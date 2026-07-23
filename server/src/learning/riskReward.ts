/**
 * Risk:reward helpers.
 * Default 1:3 — stop distance is 33% of the target distance from entry.
 */

export const DEFAULT_REWARD_MULTIPLE = Number(
  process.env.RISK_REWARD_MULTIPLE || 3,
);

/** Absolute stop price given entry + target and a reward multiple (default 3). */
export function stopFromTarget(
  entry: number,
  target: number,
  favorUp: boolean,
  rewardMultiple = DEFAULT_REWARD_MULTIPLE,
): number {
  const targetDist = Math.abs(target - entry);
  const stopDist = targetDist / Math.max(1, rewardMultiple);
  const stop = favorUp ? entry - stopDist : entry + stopDist;
  return Number(stop.toFixed(6));
}

/** % stop distance given a % target distance (1:R). */
export function stopPctFromTargetPct(
  targetPct: number,
  rewardMultiple = DEFAULT_REWARD_MULTIPLE,
): number {
  return Number((Math.abs(targetPct) / Math.max(1, rewardMultiple)).toFixed(4));
}
