import assert from "node:assert/strict";
import { test } from "node:test";
import type { KindStats, RegimeBucketStats } from "../types.js";
import { scoreAgeRegime } from "./regimePrefs.js";
import { reasonBucket, recordGateReject, resetGateTelemetry, getGateTelemetry } from "./gateTelemetry.js";

function stats(partial: Partial<KindStats> & { winsAfterCost: number; lossesAfterCost: number; expectancyNetPct: number }): KindStats {
  return {
    kind: "spike_watch",
    total: partial.winsAfterCost + partial.lossesAfterCost,
    wins: partial.winsAfterCost,
    losses: partial.lossesAfterCost,
    pending: 0,
    winRate: null,
    avgReturnPct: null,
    winsAfterCost: partial.winsAfterCost,
    lossesAfterCost: partial.lossesAfterCost,
    winRateAfterCost: null,
    avgReturnNetPct: partial.expectancyNetPct,
    expectancyNetPct: partial.expectancyNetPct,
    avgMfePct: null,
    avgMaePct: null,
    decayWinRateAfterCost: null,
    decayExpectancyNetPct: partial.expectancyNetPct,
    decayEffectiveN: partial.winsAfterCost + partial.lossesAfterCost,
  };
}

function bucket(key: string, n: number, exp: number): RegimeBucketStats {
  const wins = Math.max(0, Math.round(n / 2));
  return {
    key,
    label: key,
    stats: stats({
      winsAfterCost: wins,
      lossesAfterCost: n - wins,
      expectancyNetPct: exp,
    }),
  };
}

test("scoreAgeRegime prefers stronger seed band", () => {
  const seed = [
    bucket("early", 12, -0.04),
    bucket("mid", 20, -0.03),
    bucket("late", 12, 0.03),
    bucket("overdue", 20, -0.05),
  ];
  const late = scoreAgeRegime("late", undefined, seed);
  assert.equal(late.prefer, "late");
  assert.ok(late.confidenceMult > 1);
  assert.ok(late.note);

  const early = scoreAgeRegime("early", undefined, seed);
  assert.equal(early.prefer, "late");
  assert.ok(early.currentWeak);
  assert.ok(early.confidenceMult < 1);
});

test("scoreAgeRegime prefers live over seed when live has mass", () => {
  const seed = [
    bucket("early", 12, 0.05),
    bucket("mid", 12, -0.02),
    bucket("late", 12, -0.03),
    bucket("overdue", 12, -0.04),
  ];
  const live = [
    bucket("early", 8, -0.04),
    bucket("mid", 8, -0.03),
    bucket("late", 8, 0.04),
    bucket("overdue", 8, -0.02),
  ];
  const pref = scoreAgeRegime("early", live, seed);
  assert.equal(pref.prefer, "late");
  assert.ok(pref.note?.startsWith("live:"));
});

test("reasonBucket collapses gate reasons", () => {
  assert.equal(reasonBucket("Confidence 0.10 < 0.22"), "confidence");
  assert.equal(reasonBucket("Timing weak (P≤500=5%)"), "timing");
});

test("recordGateReject throttles duplicates", () => {
  resetGateTelemetry();
  recordGateReject(["Confidence 0.1 < 0.22"], "BOOM1000");
  recordGateReject(["Confidence 0.1 < 0.22"], "BOOM1000");
  assert.equal(getGateTelemetry().rejected, 1);
});
