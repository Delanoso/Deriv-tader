import type { SymbolAnalysis } from "../types.js";

export interface EntryGateResult {
  allow: boolean;
  reasons: string[];
}

/**
 * Only journal higher-quality spike hunts so learning isn't diluted by junk entries.
 */
export function passSpikeEntryGate(analysis: SymbolAnalysis): EntryGateResult {
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
  const stopPct =
    analysis.spikePlan != null && analysis.lastQuote
      ? (Math.abs(analysis.spikePlan.invalidation - analysis.lastQuote) /
          analysis.lastQuote) *
        100
      : null;

  const minConf = Number(process.env.ENTRY_MIN_CONF || 0.24);
  const minP500 = Number(process.env.ENTRY_MIN_P500 || 0.12);
  const minAgeRatio = Number(process.env.ENTRY_MIN_AGE_RATIO || 0.4);
  const maxStopPct = Number(process.env.ENTRY_MAX_STOP_PCT || 2.5);

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

  return { allow: reasons.length === 0, reasons };
}
