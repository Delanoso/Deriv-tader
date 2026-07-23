import assert from "node:assert/strict";
import { test } from "node:test";
import { decayWeight, decayWeightedMean } from "./decay.js";
import { ageRegimeFromRatio } from "./regimes.js";
import type { JournalSignal } from "../types.js";

test("ageRegimeFromRatio buckets", () => {
  assert.equal(ageRegimeFromRatio(0.2), "early");
  assert.equal(ageRegimeFromRatio(0.6), "mid");
  assert.equal(ageRegimeFromRatio(1.0), "late");
  assert.equal(ageRegimeFromRatio(1.5), "overdue");
});

test("decayWeight halves over half-life", () => {
  const half = 1000;
  const now = 10_000;
  assert.equal(decayWeight(now, now, half), 1);
  assert.ok(Math.abs(decayWeight(now - half, now, half) - 0.5) < 1e-9);
});

test("decayWeightedMean prefers recent rows", () => {
  const now = Date.now();
  const rows: JournalSignal[] = [
    {
      id: "old",
      symbol: "BOOM1000",
      kind: "spike_watch",
      bias: "bullish",
      confidence: 0.4,
      entryPrice: 1,
      entryEpoch: 1,
      entryTickIndex: 0,
      horizonTicks: 100,
      createdAt: now - 14 * 86400000,
      resolvedAt: now - 14 * 86400000,
      status: "win",
      returnNetPct: 1,
      source: "live",
    },
    {
      id: "new",
      symbol: "BOOM1000",
      kind: "spike_watch",
      bias: "bullish",
      confidence: 0.4,
      entryPrice: 1,
      entryEpoch: 2,
      entryTickIndex: 0,
      horizonTicks: 100,
      createdAt: now,
      resolvedAt: now,
      status: "loss",
      returnNetPct: -1,
      source: "live",
    },
  ];
  const { mean } = decayWeightedMean(rows, (s) => s.returnNetPct ?? null);
  assert.ok(mean != null);
  // Recent -1 should pull mean below the flat average of 0.
  assert.ok(mean! < 0);
});
