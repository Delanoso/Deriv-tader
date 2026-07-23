import type { JournalSignal, SymbolId } from "../types.js";
import { stopFromTarget, stopPctFromTargetPct } from "./riskReward.js";

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
 * Learn target from live paths, then set stop to 1/3 of that target (1:3 R:R).
 */
export function buildLevelHints(
  liveSignals: JournalSignal[],
  symbols: SymbolId[],
  minN = Number(process.env.LEVEL_TUNE_MIN_N || 8),
): Partial<Record<SymbolId, LevelHint>> {
  const out: Partial<Record<SymbolId, LevelHint>> = {};
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

    // Target: capture typical win MFE, stay above noise / loss MFE.
    const rawTarget = Math.max(
      winMfeP50 ?? avgMfe * 0.9,
      (lossMfeP75 ?? 0) * 1.1 + 0.04,
    );
    const targetPct = Number(
      Math.max(targetFloor, Math.min(targetCeil, rawTarget)).toFixed(4),
    );
    const stopPct = stopPctFromTargetPct(targetPct);

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
      note: `1:3 R:R tune n=${rows.length}: target≈${targetPct}% · stop≈${stopPct}% (33% of target)`,
    };
  }

  return out;
}

/** Blend structural target with learned %, then force stop = 1/3 of target. */
export function applyLevelHint(
  entry: number,
  isBoom: boolean,
  base: { spikeTarget: number; stretch: number; invalidation: number },
  hint: LevelHint | undefined,
): { spikeTarget: number; stretch: number; invalidation: number; methodSuffix: string } {
  if (!hint || entry <= 0) {
    return {
      spikeTarget: base.spikeTarget,
      stretch: base.stretch,
      invalidation: stopFromTarget(entry, base.spikeTarget, isBoom),
      methodSuffix: " · 1:3 R:R",
    };
  }

  const target = isBoom
    ? entry * (1 + hint.targetPct / 100)
    : entry * (1 - hint.targetPct / 100);
  const stretch = isBoom
    ? entry * (1 + (hint.targetPct * 1.55) / 100)
    : entry * (1 - (hint.targetPct * 1.55) / 100);

  const mixTarget = (learned: number, structural: number) =>
    Number((learned * 0.55 + structural * 0.45).toFixed(5));

  const spikeTarget = mixTarget(target, base.spikeTarget);
  const stretchPx = mixTarget(stretch, base.stretch);

  return {
    spikeTarget,
    stretch: stretchPx,
    invalidation: stopFromTarget(entry, spikeTarget, isBoom),
    methodSuffix: ` · 1:3 R:R tune n=${hint.basedOnN}`,
  };
}
