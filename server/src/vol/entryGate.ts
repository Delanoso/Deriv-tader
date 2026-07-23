import type { VolAnalysis, VolLearningSummary } from "./types.js";

export interface VolEntryGateResult {
  allow: boolean;
  reasons: string[];
}

function paperLearnMax(): boolean {
  if (process.env.PREDICTOR_MODE === "1" || process.env.PREDICTOR_MODE === "true") {
    if (process.env.PAPER_LEARN_MAX === "1" || process.env.PAPER_LEARN_MAX === "true") {
      return true;
    }
    return false;
  }
  const v = process.env.PAPER_LEARN_MAX;
  if (v == null || v === "") return true;
  return v !== "0" && v !== "false";
}

export function passVolEntryGate(
  analysis: VolAnalysis,
  learning: VolLearningSummary,
): VolEntryGateResult {
  const reasons: string[] = [];
  const pred = analysis.prediction;
  const bias = pred.bias;
  if (bias !== "up" && bias !== "down") {
    return { allow: false, reasons: ["Neutral bias — no entry"] };
  }

  const learnMax = paperLearnMax();
  const conf = pred.calibratedConfidence ?? pred.confidence;
  const minConf = Number(
    process.env.VOL_ENTRY_MIN_CONF || (learnMax ? 0.18 : 0.32),
  );
  if (conf < minConf) {
    reasons.push(`Confidence ${conf.toFixed(2)} < ${minConf}`);
  }

  const st = learning.byBias[bias];
  const n = st.winsAfterCost + st.lossesAfterCost;
  const exp = st.decayExpectancyNetPct ?? st.expectancyNetPct;

  // Predictor / quality mode: block negative-expectancy bias with enough samples.
  if (!learnMax) {
    if (n >= 20 && exp != null && exp < 0) {
      reasons.push(
        `${bias} bias: negative expectancy (${exp.toFixed(3)}%) on n=${n}`,
      );
    }
  }

  return { allow: reasons.length === 0, reasons };
}
