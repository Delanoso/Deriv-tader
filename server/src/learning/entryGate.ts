import type { FocusWeightView, RegimeBucketStats, SymbolAnalysis } from "../types.js";
import { ageRegimeFromRatio } from "./regimes.js";
import { scoreAgeRegime } from "./regimePrefs.js";
import { distToShelfPct, isNearShelf } from "./riskReward.js";

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

/** Maximize paper-journal volume for learning. Off when PREDICTOR_MODE is on. */
export function paperLearnMax(): boolean {
  if (process.env.PREDICTOR_MODE === "1" || process.env.PREDICTOR_MODE === "true") {
    // Predictor mode wins unless explicitly forcing learn-max.
    if (process.env.PAPER_LEARN_MAX === "1" || process.env.PAPER_LEARN_MAX === "true") {
      return true;
    }
    return false;
  }
  const v = process.env.PAPER_LEARN_MAX;
  if (v == null || v === "") return true;
  return v !== "0" && v !== "false";
}

/**
 * Journal spike hunts for paper learning.
 * With PAPER_LEARN_MAX, gates stay soft — but wide stops and far-from-shelf
 * pattern hunts are still blocked so the journal stays useful.
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

  const learnMax = paperLearnMax();
  const patternHit = opp.confluence?.hits?.find(
    (h) => h.id === "spike_base_retest",
  );
  const patternMin = Number(process.env.PATTERN_TRADE_MIN || 0.55);
  const shelf =
    patternHit?.shelfPrice ?? opp.confluence?.shelfPrice ?? null;
  const nearShelf = isNearShelf(
    analysis.lastQuote ?? 0,
    shelf,
    analysis.indicators.atr14,
  );
  const patternTrade =
    patternHit != null &&
    patternHit.score >= patternMin &&
    nearShelf &&
    (opp.policyAllow === true ||
      (opp.edgeScore != null && opp.edgeScore >= patternMin));

  // In learn-max mode, kill is warning-only at analyze time; still respect hard kill if forced off.
  if (analysis.kill?.killed && !learnMax && !patternTrade) {
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

  const minConf = Number(
    process.env.ENTRY_MIN_CONF || (learnMax ? 0.12 : 0.22),
  );
  const minP500 = Number(
    process.env.ENTRY_MIN_P500 || (learnMax ? 0.05 : 0.1),
  );
  const minAgeRatio = Number(
    process.env.ENTRY_MIN_AGE_RATIO || (learnMax ? 0.25 : 0.35),
  );
  const maxStopPct = Number(
    process.env.ENTRY_MAX_STOP_PCT || (learnMax ? 1.35 : 2.5),
  );
  const hardRegime =
    ctx.hardRegimeFilter ??
    (process.env.ENTRY_HARD_REGIME === "1" ||
      process.env.ENTRY_HARD_REGIME === "true");
  const hardFocus =
    process.env.ENTRY_HARD_FOCUS === "1" ||
    process.env.ENTRY_HARD_FOCUS === "true";

  // Learn-max: only block obvious junk (no spikes sampled). Confidence/timing soft.
  if (analysis.reliability.sampleSpikes < (learnMax ? 2 : 3)) {
    reasons.push("Need more sampled spikes");
  }

  // Always enforce stop width — shelf-aware stops can get too deep for learning.
  if (stopPct != null && stopPct > maxStopPct) {
    reasons.push(`Stop ${stopPct.toFixed(2)}% > max ${maxStopPct}%`);
  }

  // Pattern hunts must be near the shelf (enter at the base, not mid-decay).
  if (
    patternHit != null &&
    patternHit.score >= patternMin &&
    !nearShelf
  ) {
    const dist = distToShelfPct(analysis.lastQuote ?? 0, shelf);
    reasons.push(
      `Far from shelf${dist != null ? ` (${dist.toFixed(3)}%)` : ""} — wait for retest`,
    );
  }

  if (!learnMax && !patternTrade) {
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
  } else if (patternTrade) {
    // Clear non-stop reasons; pattern + near shelf + plan is enough.
    const keep = reasons.filter(
      (r) => r.startsWith("Stop ") || r.startsWith("Need more"),
    );
    reasons.length = 0;
    reasons.push(...keep);
    if (!analysis.spikePlan) {
      reasons.push("Pattern trade missing spike plan levels");
    }
  } else {
    // Learn-max general hunts: still need a minimal window.
    const timingOk =
      (p500 != null && p500 >= minP500) ||
      (ageRatio != null && ageRatio >= minAgeRatio) ||
      conf >= minConf;
    if (!timingOk) {
      reasons.push("Outside learn-max hunt window");
    }
    // If a shelf is visible but we're far away, prefer waiting — junk mid-decay.
    if (shelf != null && !nearShelf && !learnMax) {
      reasons.push("Shelf present but entry not near base");
    }
  }

  const pref = scoreAgeRegime(age, ctx.liveRegimes, ctx.seedRegimes);
  if (
    !learnMax &&
    hardRegime &&
    pref.currentWeak &&
    pref.prefer != null &&
    pref.prefer !== age
  ) {
    reasons.push(
      `Age regime ${age} underperforms ${pref.prefer} — skip (ENTRY_HARD_REGIME)`,
    );
  }

  if (!learnMax && hardFocus) {
    if (ctx.symbolFocus?.deprioritize) {
      reasons.push(`Symbol deprioritized by focus (${ctx.symbolFocus.note})`);
    }
    if (ctx.ageFocus?.deprioritize) {
      reasons.push(`Age focus deprioritized (${ctx.ageFocus.note})`);
    }
  }

  return {
    allow: reasons.length === 0,
    reasons,
    regimeNote: pref.note,
  };
}
