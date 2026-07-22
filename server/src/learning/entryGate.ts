import type { FocusWeightView, RegimeBucketStats, SymbolAnalysis } from "../types.js";
import { ageRegimeFromRatio } from "./regimes.js";
import { scoreAgeRegime } from "./regimePrefs.js";

export interface EntryGateResult {
  allow: boolean;
  reasons: string[];
  regimeNote?: string | null;
}

export interface EntryGateContext {
  liveRegimes?: RegimeBucketStats[];
  seedRegimes?: RegimeBucketStats[];
  hardRegimeFilter?: boolean;
  symbolFocus?: FocusWeightView;
  ageFocus?: FocusWeightView;
}

/**
 * Only journal higher-quality spike hunts so learning isn't diluted by junk entries.
 */
export function passSpikeEntryGate(
  analysis: SymbolAnalysis,
  ctx: EntryGateContext = {},
): EntryGateResult {
  const reasons: string[] = [];
  const opp = analysis.opportunity;
  if (opp.kind !== "spike_watch") {
    return { allow: false, reasons: ["Not a spike-hunt window"] };
  }
  if (analysis.kill?.killed) {
    return { allow: false, reasons: ["Kill rule active"] };
  }

  const conf = opp.calibratedConfidence ?? opp.confidence;
  const p500 =
    analysis.forecast?.horizons.find((h) => h.horizonTicks === 500)?.probability ??
    null;
  const mean = analysis.reliability.meanInterSpikeTicks;
  const since = analysis.ticksSinceLastSpike;
  const ageRatio =
    mean != null && mean > 0 && since != null ? since / mean : null;
  const age = ageRegimeFromRatio(ageRatio);
  const stopPct =
    analysis.spikePlan != null && analysis.lastQuote
      ? (Math.abs(analysis.spikePlan.invalidation - analysis.lastQuote) /
          analysis.lastQuote) *
        100
      : null;

  const minConf = Number(process.env.ENTRY_MIN_CONF || 0.22);
  const minP500 = Number(process.env.ENTRY_MIN_P500 || 0.1);
  const minAgeRatio = Number(process.env.ENTRY_MIN_AGE_RATIO || 0.35);
  const maxStopPct = Number(process.env.ENTRY_MAX_STOP_PCT || 2.5);
  const hardRegime =
    ctx.hardRegimeFilter ??
    (process.env.ENTRY_HARD_REGIME === "1" ||
      process.env.ENTRY_HARD_REGIME === "true");
  const hardFocus =
    process.env.ENTRY_HARD_FOCUS === "1" ||
    process.env.ENTRY_HARD_FOCUS === "true";

  if (conf < minConf) {
    reasons.push(`Confidence ${conf.toFixed(2)} < ${minConf}`);
  }
  const timingOk =
    (p500 != null && p500 >= minP500) ||
    (ageRatio != null && ageRatio >= minAgeRatio);
  if (!timingOk) {
    reasons.push(
      `Timing weak (P≤500=${p500 == null ? "n/a" : (p500 * 100).toFixed(0)}%, ageRatio=${ageRatio == null ? "n/a" : ageRatio.toFixed(2)})`,
    );
  }
  if (stopPct != null && stopPct > maxStopPct) {
    reasons.push(`Stop ${stopPct.toFixed(2)}% > max ${maxStopPct}%`);
  }
  if (analysis.reliability.sampleSpikes < 3) {
    reasons.push("Need ≥3 sampled spikes");
  }

  const pref = scoreAgeRegime(age, ctx.liveRegimes, ctx.seedRegimes);
  if (
    hardRegime &&
    pref.currentWeak &&
    pref.prefer != null &&
    pref.prefer !== age
  ) {
    reasons.push(
      `Age regime ${age} underperforms ${pref.prefer} — skip (ENTRY_HARD_REGIME)`,
    );
  }

  if (hardFocus) {
    if (ctx.symbolFocus?.deprioritize) {
      reasons.push(`Focus: ${ctx.symbolFocus.note}`);
    }
    if (ctx.ageFocus?.deprioritize) {
      reasons.push(`Focus: ${ctx.ageFocus.note}`);
    }
  }

  return {
    allow: reasons.length === 0,
    reasons,
    regimeNote: pref.note,
  };
}
