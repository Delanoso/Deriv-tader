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
  /** Wins' typical MAE before success — stop should sit beyond this. */
  winMaeP75: number | null;
  /** Losses' typical MFE before fail — target shouldn't sit beyond early noise. */
  lossMfeP75: number | null;
  note: string;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Learn stop/target distances from live MFE/MAE path stats.
 * Stop ≈ beyond typical adverse on wins; target ≈ inside typical favorable on wins.
 */
export function buildLevelHints(
  liveSignals: JournalSignal[],
  symbols: SymbolId[],
  minN = Number(process.env.LEVEL_TUNE_MIN_N || 8),
): Partial<Record<SymbolId, LevelHint>> {
  const out: Partial<Record<SymbolId, LevelHint>> = {};

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

    const winMaes = rows
      .filter((s) => s.status === "win")
      .map((s) => s.maePct!)
      .sort((a, b) => a - b);
    const lossMfes = rows
      .filter((s) => s.status === "loss")
      .map((s) => s.mfePct!)
      .sort((a, b) => a - b);

    const winMaeP75 = quantile(winMaes, 0.75);
    const lossMfeP75 = quantile(lossMfes, 0.75);
    const mfeP50 = quantile(mfes, 0.5) ?? avgMfe;

    // Stop: a bit beyond what winning paths typically endure.
    const stopPct = Number(
      Math.max(
        0.02,
        Math.min(2.5, (winMaeP75 ?? avgMae) * 1.15 + 0.01),
      ).toFixed(4),
    );
    // Target: inside median MFE so wins can actually print; avoid chasing stretch.
    const targetPct = Number(
      Math.max(
        0.03,
        Math.min(3.5, Math.min(mfeP50 * 0.85, (lossMfeP75 ?? mfeP50) * 0.95 + 0.02)),
      ).toFixed(4),
    );

    out[symbol] = {
      symbol,
      stopPct,
      targetPct,
      basedOnN: rows.length,
      avgMfePct: Number(avgMfe.toFixed(4)),
      avgMaePct: Number(avgMae.toFixed(4)),
      winMaeP75: winMaeP75 != null ? Number(winMaeP75.toFixed(4)) : null,
      lossMfeP75: lossMfeP75 != null ? Number(lossMfeP75.toFixed(4)) : null,
      note: `From ${rows.length} live paths: stop≈${stopPct}% · target≈${targetPct}% (MFE ${avgMfe.toFixed(3)} / MAE ${avgMae.toFixed(3)})`,
    };
  }

  return out;
}

/** Blend ATR/mag plan with learned % distances when hints exist. */
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
  // Keep stretch a bit beyond learned target.
  const stretch = isBoom
    ? entry * (1 + (hint.targetPct * 1.45) / 100)
    : entry * (1 - (hint.targetPct * 1.45) / 100);

  // Soft blend 60% learned / 40% structural so we don't overfit tiny books.
  const mix = (learned: number, structural: number) =>
    Number((learned * 0.6 + structural * 0.4).toFixed(5));

  return {
    spikeTarget: mix(target, base.spikeTarget),
    stretch: mix(stretch, base.stretch),
    invalidation: mix(stop, base.invalidation),
    methodSuffix: ` · MFE/MAE tune n=${hint.basedOnN}`,
  };
}
