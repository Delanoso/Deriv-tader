import type { JournalSignal, SymbolId } from "../types.js";

export interface LevelHint {
  symbol: SymbolId;
  /** Suggested stop distance as % of entry (adverse). */
  stopPct: number;
  /** Suggested target distance as % of entry (favorable). */
  targetPct: number;
  basedOnN: number;
  avgMfePct: number;
  avgMaePct: number;
  winMaeP75: number | null;
  winMaeP90: number | null;
  winMfeP50: number | null;
  lossMfeP75: number | null;
  note: string;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(q * (sorted.length - 1))),
  );
  return sorted[i];
}

/**
 * Learn stop/target from live paths.
 * Critical fix vs v1: stops were tiny (~0.05%) and caused mass stopouts.
 * Now: stop beyond win MAE p90 with ATR floor; target from win MFE median.
 */
export function buildLevelHints(
  liveSignals: JournalSignal[],
  symbols: SymbolId[],
  minN = Number(process.env.LEVEL_TUNE_MIN_N || 8),
): Partial<Record<SymbolId, LevelHint>> {
  const out: Partial<Record<SymbolId, LevelHint>> = {};
  const stopFloor = Number(process.env.LEVEL_STOP_FLOOR_PCT || 0.15);
  const stopCeil = Number(process.env.LEVEL_STOP_CEIL_PCT || 1.25);
  const targetFloor = Number(process.env.LEVEL_TARGET_FLOOR_PCT || 0.12);
  const targetCeil = Number(process.env.LEVEL_TARGET_CEIL_PCT || 2.5);

  for (const symbol of symbols) {
    const rows = liveSignals.filter(
      (s) =>
        s.symbol === symbol &&
        s.kind === "spike_watch" &&
        (s.status === "win" || s.status === "loss") &&
        s.mfePct != null &&
        s.maePct != null,
    );
    if (rows.length < minN) continue;

    const mfes = rows.map((s) => s.mfePct!).sort((a, b) => a - b);
    const maes = rows.map((s) => s.maePct!).sort((a, b) => a - b);
    const avgMfe = mfes.reduce((a, b) => a + b, 0) / mfes.length;
    const avgMae = maes.reduce((a, b) => a + b, 0) / maes.length;

    const wins = rows.filter((s) => s.status === "win");
    const winMaes = wins.map((s) => s.maePct!).sort((a, b) => a - b);
    const winMfes = wins.map((s) => s.mfePct!).sort((a, b) => a - b);
    const lossMfes = rows
      .filter((s) => s.status === "loss")
      .map((s) => s.mfePct!)
      .sort((a, b) => a - b);

    const winMaeP75 = quantile(winMaes, 0.75);
    const winMaeP90 = quantile(winMaes, 0.9);
    const winMfeP50 = quantile(winMfes, 0.5);
    const lossMfeP75 = quantile(lossMfes, 0.75);

    // Wider stop: past what most winning paths survive.
    const rawStop = (winMaeP90 ?? winMaeP75 ?? avgMae) * 1.35 + 0.02;
    const stopPct = Number(
      Math.max(stopFloor, Math.min(stopCeil, rawStop)).toFixed(4),
    );

    // Target: capture typical win MFE, stay above noise / loss MFE.
    const rawTarget = Math.max(
      winMfeP50 ?? avgMfe * 0.9,
      (lossMfeP75 ?? 0) * 1.1 + 0.04,
    );
    const targetPct = Number(
      Math.max(targetFloor, Math.min(targetCeil, rawTarget)).toFixed(4),
    );

    out[symbol] = {
      symbol,
      stopPct,
      targetPct,
      basedOnN: rows.length,
      avgMfePct: Number(avgMfe.toFixed(4)),
      avgMaePct: Number(avgMae.toFixed(4)),
      winMaeP75: winMaeP75 != null ? Number(winMaeP75.toFixed(4)) : null,
      winMaeP90: winMaeP90 != null ? Number(winMaeP90.toFixed(4)) : null,
      winMfeP50: winMfeP50 != null ? Number(winMfeP50.toFixed(4)) : null,
      lossMfeP75: lossMfeP75 != null ? Number(lossMfeP75.toFixed(4)) : null,
      note: `Wide-stop tune n=${rows.length}: stop≈${stopPct}% (win MAE p90) · target≈${targetPct}% (win MFE p50)`,
    };
  }

  return out;
}

/** Blend ATR/mag plan with learned % distances — prefer wider learned stops. */
export function applyLevelHint(
  entry: number,
  isBoom: boolean,
  base: { spikeTarget: number; stretch: number; invalidation: number },
  hint: LevelHint | undefined,
): { spikeTarget: number; stretch: number; invalidation: number; methodSuffix: string } {
  if (!hint || entry <= 0) {
    return { ...base, methodSuffix: "" };
  }

  const target = isBoom
    ? entry * (1 + hint.targetPct / 100)
    : entry * (1 - hint.targetPct / 100);
  const stop = isBoom
    ? entry * (1 - hint.stopPct / 100)
    : entry * (1 + hint.stopPct / 100);
  const stretch = isBoom
    ? entry * (1 + (hint.targetPct * 1.55) / 100)
    : entry * (1 - (hint.targetPct * 1.55) / 100);

  // Prefer learned stop (wider); blend target more evenly with structural spike mag.
  const mixStop = (learned: number, structural: number) => {
    // Pick the wider stop (further from entry).
    if (isBoom) return Number(Math.min(learned, structural).toFixed(5));
    return Number(Math.max(learned, structural).toFixed(5));
  };
  const mixTarget = (learned: number, structural: number) =>
    Number((learned * 0.55 + structural * 0.45).toFixed(5));

  return {
    spikeTarget: mixTarget(target, base.spikeTarget),
    stretch: mixTarget(stretch, base.stretch),
    invalidation: mixStop(stop, base.invalidation),
    methodSuffix: ` · wide-stop tune n=${hint.basedOnN}`,
  };
}
