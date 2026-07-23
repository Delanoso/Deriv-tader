import assert from "node:assert/strict";
import { test } from "node:test";
import type { JournalSignal, KindStats } from "../types.js";
import { buildFocusMap } from "./focusWeights.js";
import { buildLevelHints, applyLevelHint } from "./levelTune.js";
import { buildOutcomeBreakdown } from "./outcomes.js";
import { walkForwardSplit } from "./walkForward.js";
import { rsiRegimeFromValue } from "./regimes.js";

function st(
  wins: number,
  losses: number,
  exp: number,
): KindStats {
  return {
    kind: "spike_watch",
    total: wins + losses,
    wins,
    losses,
    pending: 0,
    winRate: wins / (wins + losses),
    avgReturnPct: exp,
    winsAfterCost: wins,
    lossesAfterCost: losses,
    winRateAfterCost: wins / (wins + losses),
    avgReturnNetPct: exp,
    expectancyNetPct: exp,
    avgMfePct: 0.1,
    avgMaePct: 0.05,
    decayWinRateAfterCost: wins / (wins + losses),
    decayExpectancyNetPct: exp,
    decayEffectiveN: wins + losses,
  };
}

test("rsiRegimeFromValue buckets", () => {
  assert.equal(rsiRegimeFromValue(20), "oversold");
  assert.equal(rsiRegimeFromValue(50), "neutral");
  assert.equal(rsiRegimeFromValue(80), "overbought");
});

test("buildFocusMap deprioritizes negative expectancy symbols", () => {
  const focus = buildFocusMap({
    symbols: ["BOOM300N", "CRASH300N"],
    liveBySymbol: {
      BOOM300N: { byKind: { spike_watch: st(2, 10, -0.04) } },
      CRASH300N: { byKind: { spike_watch: st(8, 4, 0.05) } },
    },
    liveRegimes: {},
    minN: 8,
  });
  assert.equal(focus.bySymbol.BOOM300N?.deprioritize, true);
  assert.ok((focus.bySymbol.BOOM300N?.weight ?? 1) < 1);
  assert.equal(focus.bySymbol.CRASH300N?.deprioritize, false);
  assert.ok((focus.bySymbol.CRASH300N?.weight ?? 1) > 1);
});

test("buildLevelHints suggests stop and target from paths", () => {
  const now = Date.now();
  const rows: JournalSignal[] = [];
  for (let i = 0; i < 10; i++) {
    rows.push({
      id: `w${i}`,
      symbol: "BOOM1000",
      kind: "spike_watch",
      bias: "bullish",
      confidence: 0.4,
      entryPrice: 100,
      entryEpoch: i,
      entryTickIndex: i,
      horizonTicks: 100,
      createdAt: now,
      resolvedAt: now,
      status: i % 2 === 0 ? "win" : "loss",
      mfePct: 0.2,
      maePct: 0.08,
      returnNetPct: i % 2 === 0 ? 0.1 : -0.05,
      source: "live",
    });
  }
  const hints = buildLevelHints(rows, ["BOOM1000"], 8);
  assert.ok(hints.BOOM1000);
  assert.ok(hints.BOOM1000!.stopPct > 0);
  assert.ok(hints.BOOM1000!.targetPct > 0);
  assert.ok(hints.BOOM1000!.stopPct >= 0.15);

  const applied = applyLevelHint(
    100,
    true,
    { spikeTarget: 101, stretch: 102, invalidation: 99 },
    hints.BOOM1000,
  );
  assert.ok(applied.methodSuffix.includes("wide-stop"));
});

test("buildOutcomeBreakdown flags stopout-heavy losses", () => {
  const rows: JournalSignal[] = Array.from({ length: 6 }, (_, i) => ({
    id: `o${i}`,
    symbol: "CRASH300N" as const,
    kind: "spike_watch" as const,
    bias: "bearish" as const,
    confidence: 0.4,
    entryPrice: 1,
    entryEpoch: i,
    entryTickIndex: i,
    horizonTicks: 100,
    createdAt: Date.now(),
    status: "loss" as const,
    outcome: "stopout" as const,
    source: "live" as const,
  }));
  const out = buildOutcomeBreakdown(rows);
  assert.equal(out.stopout, 6);
  assert.equal(out.dominantLoss, "stopout");
  assert.ok(out.note);
});

test("walkForwardSplit holds out newest fold", () => {
  const now = Date.now();
  const rows: JournalSignal[] = Array.from({ length: 20 }, (_, i) => ({
    id: `wf${i}`,
    symbol: "BOOM1000" as const,
    kind: "spike_watch" as const,
    bias: "bullish" as const,
    confidence: 0.4,
    entryPrice: 1,
    entryEpoch: i,
    entryTickIndex: i,
    horizonTicks: 100,
    createdAt: now + i,
    resolvedAt: now + i,
    status: (i < 10 ? "win" : "loss") as "win" | "loss",
    returnNetPct: i < 10 ? 0.1 : -0.05,
    winAfterCost: i < 10,
    source: "live" as const,
  }));
  const report = walkForwardSplit(rows, 0.2, 4);
  assert.ok(report.holdoutN >= 4);
  assert.equal(report.holdoutIds.length, report.holdoutN);
  assert.ok(report.trainN + report.holdoutN === 20);
});
