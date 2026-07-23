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

/** Absolute target price given entry + stop so risk:reward stays at `rewardMultiple`. */
export function targetFromStop(
  entry: number,
  stop: number,
  favorUp: boolean,
  rewardMultiple = DEFAULT_REWARD_MULTIPLE,
): number {
  const stopDist = Math.abs(entry - stop);
  const targetDist = stopDist * Math.max(1, rewardMultiple);
  const target = favorUp ? entry + targetDist : entry - targetDist;
  return Number(target.toFixed(6));
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

/**
 * Apply shelf-aware stop, then restore 1:R target/stretch from the final stop.
 */
export function applyShelfAwareLevels(input: {
  entry: number;
  target: number;
  stretch: number;
  shelf?: number | null;
  favorUp: boolean;
  buffer?: number;
  rewardMultiple?: number;
}): {
  stop: number;
  target: number;
  stretch: number;
  shelfAdjusted: boolean;
  stopPct: number;
} {
  const multiple = input.rewardMultiple ?? DEFAULT_REWARD_MULTIPLE;
  const buffer = input.buffer ?? 0;
  const rrStop = stopFromTarget(
    input.entry,
    input.target,
    input.favorUp,
    multiple,
  );
  const stop = stopBeyondShelf(
    rrStop,
    input.shelf,
    input.favorUp,
    buffer,
  );
  const shelfAdjusted = stop !== rrStop;
  let target = input.target;
  let stretch = input.stretch;
  if (shelfAdjusted) {
    target = targetFromStop(input.entry, stop, input.favorUp, multiple);
    const oldSpan = Math.abs(input.target - input.entry);
    const stretchRatio =
      oldSpan > 0 ? Math.abs(input.stretch - input.entry) / oldSpan : 1.55;
    const span = Math.abs(target - input.entry);
    stretch = input.favorUp
      ? input.entry + span * Math.max(1.2, stretchRatio)
      : input.entry - span * Math.max(1.2, stretchRatio);
    stretch = Number(stretch.toFixed(6));
  }
  const stopPct =
    input.entry > 0
      ? Number(((Math.abs(stop - input.entry) / input.entry) * 100).toFixed(4))
      : 0;
  return { stop, target, stretch, shelfAdjusted, stopPct };
}

/** True when entry is close enough to the spike base / crash ceiling. */
export function isNearShelf(
  entry: number,
  shelf: number | null | undefined,
  atr: number | null | undefined,
  atrMult = Number(process.env.PATTERN_NEAR_SHELF_ATR || 1.15),
): boolean {
  if (shelf == null || !Number.isFinite(shelf) || !Number.isFinite(entry)) {
    return false;
  }
  const band =
    atr != null && atr > 0 && Number.isFinite(atr)
      ? atr * Math.max(0.25, atrMult)
      : Math.abs(entry) * 0.0015;
  return Math.abs(entry - shelf) <= band;
}

export function distToShelfPct(
  entry: number,
  shelf: number | null | undefined,
): number | null {
  if (shelf == null || !Number.isFinite(shelf) || !(entry > 0)) return null;
  return Number(((Math.abs(entry - shelf) / entry) * 100).toFixed(4));
}

/** % stop distance given a % target distance (1:R). */
export function stopPctFromTargetPct(
  targetPct: number,
  rewardMultiple = DEFAULT_REWARD_MULTIPLE,
): number {
  return Number((Math.abs(targetPct) / Math.max(1, rewardMultiple)).toFixed(4));
}
