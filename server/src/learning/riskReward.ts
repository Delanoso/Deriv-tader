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

/**
 * Keep the stop on the far side of the spike base / crash ceiling.
 * Boom (favorUp): stop must sit below the shelf so price can retest the base.
 * Crash: stop must sit above the ceiling so price can retest from below.
 */
export function stopBeyondShelf(
  stop: number,
  shelf: number | null | undefined,
  favorUp: boolean,
  buffer = 0,
): number {
  if (
    shelf == null ||
    !Number.isFinite(shelf) ||
    !Number.isFinite(stop) ||
    !Number.isFinite(buffer)
  ) {
    return stop;
  }
  const pad = Math.max(0, buffer);
  if (favorUp) {
    return Number(Math.min(stop, shelf - pad).toFixed(6));
  }
  return Number(Math.max(stop, shelf + pad).toFixed(6));
}

/** % stop distance given a % target distance (1:R). */
export function stopPctFromTargetPct(
  targetPct: number,
  rewardMultiple = DEFAULT_REWARD_MULTIPLE,
): number {
  return Number((Math.abs(targetPct) / Math.max(1, rewardMultiple)).toFixed(4));
}
