import type { JournalSignal } from "../types.js";
import { withCostFields } from "./costs.js";
import { decayWeightedMean, decayWeightedRate } from "./decay.js";

export interface WalkForwardReport {
  trainN: number;
  holdoutN: number;
  trainWinRateAfterCost: number | null;
  holdoutWinRateAfterCost: number | null;
  trainExpectancyNetPct: number | null;
  holdoutExpectancyNetPct: number | null;
  /** holdoutExp - trainExp (negative = overfitting / regime shift). */
  gapExpectancy: number | null;
  note: string | null;
  /** Signal ids in the holdout fold — exclude from calibration. */
  holdoutIds: string[];
}

/**
 * Time-ordered walk-forward: oldest (1-holdoutFrac) train, newest holdoutFrac test.
 * Calibration should ignore holdoutIds.
 */
export function walkForwardSplit(
  liveResolved: JournalSignal[],
  holdoutFrac = Number(process.env.WALK_FORWARD_HOLDOUT || 0.2),
  minHoldout = Number(process.env.WALK_FORWARD_MIN_HOLDOUT || 6),
): WalkForwardReport {
  const rows = [...liveResolved]
    .filter((s) => s.status === "win" || s.status === "loss")
    .sort(
      (a, b) =>
        (a.resolvedAt ?? a.createdAt) - (b.resolvedAt ?? b.createdAt),
    );

  if (rows.length < minHoldout * 2) {
    return {
      trainN: rows.length,
      holdoutN: 0,
      trainWinRateAfterCost: null,
      holdoutWinRateAfterCost: null,
      trainExpectancyNetPct: null,
      holdoutExpectancyNetPct: null,
      gapExpectancy: null,
      note: `Need ≥${minHoldout * 2} live decisions for walk-forward`,
      holdoutIds: [],
    };
  }

  const holdoutN = Math.max(
    minHoldout,
    Math.floor(rows.length * Math.min(0.4, Math.max(0.1, holdoutFrac))),
  );
  const split = rows.length - holdoutN;
  const train = rows.slice(0, split);
  const holdout = rows.slice(split);
  const holdoutIds = holdout.map((s) => s.id);

  const trainM = metrics(train);
  const holdM = metrics(holdout);
  const gap =
    trainM.exp != null && holdM.exp != null
      ? Number((holdM.exp - trainM.exp).toFixed(4))
      : null;

  let note: string | null = null;
  if (gap != null && holdM.wr != null && trainM.wr != null) {
    if (gap < -0.02 && holdM.wr + 0.05 < trainM.wr) {
      note = `Holdout weaker than train (Δexp ${gap.toFixed(3)}%) — possible overfit / regime shift.`;
    } else if (gap >= 0) {
      note = `Holdout holds up (Δexp ${gap.toFixed(3)}%).`;
    } else {
      note = `Holdout slightly softer (Δexp ${gap.toFixed(3)}%).`;
    }
  }

  return {
    trainN: train.length,
    holdoutN: holdout.length,
    trainWinRateAfterCost: trainM.wr,
    holdoutWinRateAfterCost: holdM.wr,
    trainExpectancyNetPct: trainM.exp,
    holdoutExpectancyNetPct: holdM.exp,
    gapExpectancy: gap,
    note,
    holdoutIds,
  };
}

function metrics(rows: JournalSignal[]): {
  wr: number | null;
  exp: number | null;
} {
  if (!rows.length) return { wr: null, exp: null };
  const nets = rows.map((s) => {
    if (s.returnNetPct != null) return s.returnNetPct;
    if (s.returnPct == null) return null;
    return withCostFields(s.returnPct).returnNetPct;
  });
  const valid = nets.filter((v): v is number => v != null);
  const wins = valid.filter((v) => v > 0).length;
  const wr = valid.length ? Number((wins / valid.length).toFixed(3)) : null;
  const decayWr = decayWeightedRate(rows, (s) => {
    if (s.winAfterCost != null) return s.winAfterCost;
    if (s.returnNetPct != null) return s.returnNetPct > 0;
    if (s.returnPct == null) return null;
    return withCostFields(s.returnPct).winAfterCost;
  });
  const decayExp = decayWeightedMean(rows, (s) => {
    if (s.returnNetPct != null) return s.returnNetPct;
    if (s.returnPct == null) return null;
    return withCostFields(s.returnPct).returnNetPct;
  });
  return {
    wr: decayWr.rate ?? wr,
    exp: decayExp.mean,
  };
}
