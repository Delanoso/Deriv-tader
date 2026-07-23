import assert from "node:assert/strict";
import { test } from "node:test";
import type { JournalSignal, KindStats, LearningSummary } from "../types.js";
import { evaluateEntryPolicy } from "./entryPolicy.js";
import { buildLevelHints } from "./levelTune.js";

function emptyStats(exp: number | null, n: number): KindStats {
  const wins = Math.max(0, Math.round(n * 0.4));
  const losses = Math.max(0, n - wins);
  return {
    kind: "spike_watch",
    total: n,
    wins,
    losses,
    pending: 0,
    winRate: n ? wins / n : null,
    avgReturnPct: exp,
    winsAfterCost: wins,
    lossesAfterCost: losses,
    winRateAfterCost: n ? wins / n : null,
    avgReturnNetPct: exp,
    expectancyNetPct: exp,
    avgMfePct: 0.1,
    avgMaePct: 0.05,
    decayWinRateAfterCost: n ? wins / n : null,
    decayExpectancyNetPct: exp,
    decayEffectiveN: n,
  };
}

function stubLearning(partial: {
  cross?: { key: string; exp: number; n: number };
  age?: { key: string; exp: number; n: number };
  symbolExp?: number;
  symbolN?: number;
}): LearningSummary {
  const symbol = "BOOM300N" as const;
  const cross = partial.cross
    ? [
        {
          key: partial.cross.key,
          label: partial.cross.key.replace("|", " × "),
          stats: emptyStats(partial.cross.exp, partial.cross.n),
        },
      ]
    : [];
  const age = partial.age
    ? [
        {
          key: partial.age.key,
          label: partial.age.key,
          stats: emptyStats(partial.age.exp, partial.age.n),
        },
      ]
    : [];
  const symN = partial.symbolN ?? 100;
  const symExp = partial.symbolExp ?? -0.03;
  return {
    totalSignals: symN,
    pending: 0,
    resolved: symN,
    overallWinRate: 0.3,
    costPctAssumed: 0.02,
    live: {
      overall: emptyStats(symExp, symN),
      bySymbol: {
        BOOM300N: {
          overall: emptyStats(symExp, symN),
          byKind: { spike_watch: emptyStats(symExp, symN) },
          resolved: symN,
          pending: 0,
          overallWinRate: 0.3,
          overallWinRateAfterCost: 0.3,
        },
      } as LearningSummary["live"]["bySymbol"],
      resolved: symN,
      pending: 0,
      overallWinRate: 0.3,
      overallWinRateAfterCost: 0.3,
    },
    seed: {
      overall: emptyStats(null, 0),
      bySymbol: {} as LearningSummary["seed"]["bySymbol"],
      resolved: 0,
      overallWinRate: null,
      overallWinRateAfterCost: null,
    },
    bySymbol: {} as LearningSummary["bySymbol"],
    regimes: { [symbol]: age },
    seedRegimes: {},
    crossRegimes: { [symbol]: cross },
    insights: [],
    recent: [],
    calibrated: {},
    updatedAt: Date.now(),
  };
}

test("entry policy allows positive cross pocket", () => {
  const learning = stubLearning({
    cross: { key: "mid|oversold", exp: 0.08, n: 27 },
    age: { key: "mid", exp: -0.02, n: 50 },
    symbolExp: -0.03,
    symbolN: 200,
  });
  const d = evaluateEntryPolicy({
    symbol: "BOOM300N",
    ageRatio: 0.6,
    rsi14: 28,
    pSpike500: 0.4,
    learning,
  });
  assert.equal(d.allow, true);
  assert.ok(d.edgeScore > 0.5);
});

test("entry policy denies without edge pocket", () => {
  const learning = stubLearning({
    cross: { key: "mid|neutral", exp: -0.05, n: 40 },
    age: { key: "mid", exp: -0.04, n: 80 },
    symbolExp: -0.03,
    symbolN: 200,
  });
  const d = evaluateEntryPolicy({
    symbol: "BOOM300N",
    ageRatio: 0.6,
    rsi14: 50,
    pSpike500: 0.2,
    learning,
  });
  assert.equal(d.allow, false);
});

test("wide-stop level hints respect floor", () => {
  const now = Date.now();
  const rows: JournalSignal[] = [];
  for (let i = 0; i < 20; i++) {
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
      status: i % 3 === 0 ? "win" : "loss",
      mfePct: 0.2,
      maePct: 0.08,
      returnNetPct: i % 3 === 0 ? 0.1 : -0.05,
      source: "live",
    });
  }
  const hints = buildLevelHints(rows, ["BOOM1000"], 8);
  assert.ok(hints.BOOM1000);
  assert.ok(hints.BOOM1000!.stopPct >= 0.15);
  assert.ok(hints.BOOM1000!.targetPct >= 0.12);
});
