import type {
  LearningSummary,
  RegimeBucketStats,
  SymbolId,
} from "../types.js";
import {
  ageRegimeFromRatio,
  crossRegimeKey,
  rsiRegimeFromValue,
  type AgeRegime,
  type RsiRegime,
} from "./regimes.js";

export interface EntryPolicyInput {
  symbol: SymbolId;
  ageRatio: number | null;
  rsi14: number | null;
  pSpike500: number | null;
  learning: LearningSummary;
}

export interface EntryPolicyDecision {
  /** Allow a spike-hunt signal / paper journal. */
  allow: boolean;
  /** 0–1 edge quality used to scale confidence. */
  edgeScore: number;
  /** Human reasons (allow or deny). */
  reasons: string[];
  ageRegime: AgeRegime;
  rsiRegime: RsiRegime;
  crossKey: string;
  crossExp: number | null;
  ageExp: number | null;
  symbolExp: number | null;
  crossN: number;
  ageN: number;
}

function decidedN(st: { winsAfterCost: number; lossesAfterCost: number } | undefined): number {
  if (!st) return 0;
  return st.winsAfterCost + st.lossesAfterCost;
}

function expOf(st: {
  decayExpectancyNetPct?: number | null;
  expectancyNetPct?: number | null;
} | undefined): number | null {
  if (!st) return null;
  return st.decayExpectancyNetPct ?? st.expectancyNetPct ?? null;
}

function bucketExp(
  buckets: RegimeBucketStats[] | undefined,
  key: string,
): { exp: number | null; n: number; label: string } {
  const b = buckets?.find((x) => x.key === key);
  return {
    exp: expOf(b?.stats),
    n: decidedN(b?.stats),
    label: b?.label ?? key,
  };
}

/**
 * Predictor-mode entry policy: only hunt when live learning shows a pocket with edge
 * (or at least non-negative expectancy with enough samples).
 *
 * Priority: age×RSI cross > age regime > symbol overall.
 */
export function evaluateEntryPolicy(input: EntryPolicyInput): EntryPolicyDecision {
  const ageRegime = ageRegimeFromRatio(input.ageRatio);
  const rsiRegime = rsiRegimeFromValue(input.rsi14);
  const crossKey = crossRegimeKey(ageRegime, rsiRegime);
  const learning = input.learning;

  const cross = bucketExp(learning.crossRegimes?.[input.symbol], crossKey);
  const age = bucketExp(learning.regimes?.[input.symbol], ageRegime);
  const symSt =
    learning.live.bySymbol[input.symbol]?.byKind.spike_watch ??
    learning.live.bySymbol[input.symbol]?.overall;
  const symbolExp = expOf(symSt);
  const symbolN = decidedN(symSt);

  const minCrossN = Number(process.env.POLICY_MIN_CROSS_N || 12);
  const minAgeN = Number(process.env.POLICY_MIN_AGE_N || 40);
  const minSymN = Number(process.env.POLICY_MIN_SYMBOL_N || 80);
  const minCrossExp = Number(process.env.POLICY_MIN_CROSS_EXP || 0);
  const minAgeExp = Number(process.env.POLICY_MIN_AGE_EXP || 0);
  /** Allow near-flat symbol if a positive cross/age pocket is active. */
  const maxSymbolDrag = Number(process.env.POLICY_MAX_SYMBOL_DRAG || -0.05);

  const reasons: string[] = [];
  let allow = false;
  let edgeScore = 0.35;

  // Strong path: positive cross cell.
  if (cross.n >= minCrossN && cross.exp != null && cross.exp >= minCrossExp) {
    allow = true;
    edgeScore = Math.min(0.85, 0.55 + Math.tanh(cross.exp * 10) * 0.3);
    reasons.push(
      `Learned pocket ${cross.label}: exp ${cross.exp.toFixed(3)}% (n=${cross.n})`,
    );
  } else if (age.n >= minAgeN && age.exp != null && age.exp >= minAgeExp) {
    allow = true;
    edgeScore = Math.min(0.75, 0.48 + Math.tanh(age.exp * 10) * 0.25);
    reasons.push(
      `Learned age ${ageRegime}: exp ${age.exp.toFixed(3)}% (n=${age.n})`,
    );
  } else if (
    symbolN >= minSymN &&
    symbolExp != null &&
    symbolExp >= minAgeExp &&
    (input.pSpike500 == null || input.pSpike500 >= 0.2)
  ) {
    // Rare: whole symbol has non-negative live edge.
    allow = true;
    edgeScore = Math.min(0.65, 0.42 + Math.tanh(symbolExp * 8) * 0.2);
    reasons.push(
      `Symbol live edge ${symbolExp.toFixed(3)}% (n=${symbolN}) with timing support`,
    );
  } else {
    // Deny with diagnostics.
    if (cross.n < minCrossN) {
      reasons.push(
        `Cross ${cross.label}: need n≥${minCrossN} (have ${cross.n})`,
      );
    } else if (cross.exp != null && cross.exp < minCrossExp) {
      reasons.push(
        `Cross ${cross.label}: exp ${cross.exp.toFixed(3)}% below floor`,
      );
    }
    if (age.n < minAgeN) {
      reasons.push(`Age ${ageRegime}: need n≥${minAgeN} (have ${age.n})`);
    } else if (age.exp != null && age.exp < minAgeExp) {
      reasons.push(`Age ${ageRegime}: exp ${age.exp.toFixed(3)}% below floor`);
    }
    if (!allow) {
      reasons.push("No learned edge pocket — stand aside");
    }
  }

  // Hard veto: catastrophic symbol drag even if a tiny pocket looks good.
  if (
    allow &&
    symbolN >= minSymN &&
    symbolExp != null &&
    symbolExp < maxSymbolDrag &&
    !(cross.n >= minCrossN && cross.exp != null && cross.exp > 0.02)
  ) {
    allow = false;
    edgeScore = 0.2;
    reasons.push(
      `Symbol drag exp ${symbolExp.toFixed(3)}% — veto unless strong cross pocket`,
    );
  }

  // Timing assist: boost or cut edge score.
  if (input.pSpike500 != null) {
    if (input.pSpike500 >= 0.35) {
      edgeScore = Math.min(0.9, edgeScore + 0.06);
      reasons.push(`Timing support P≤500=${(input.pSpike500 * 100).toFixed(0)}%`);
    } else if (input.pSpike500 < 0.12 && allow) {
      edgeScore = Math.max(0.25, edgeScore - 0.08);
      reasons.push(`Weak timing P≤500=${(input.pSpike500 * 100).toFixed(0)}%`);
    }
  }

  return {
    allow,
    edgeScore: Number(edgeScore.toFixed(3)),
    reasons,
    ageRegime,
    rsiRegime,
    crossKey,
    crossExp: cross.exp,
    ageExp: age.exp,
    symbolExp,
    crossN: cross.n,
    ageN: age.n,
  };
}

export function predictorMode(): boolean {
  const v = process.env.PREDICTOR_MODE;
  if (v == null || v === "") return true;
  return v !== "0" && v !== "false";
}
