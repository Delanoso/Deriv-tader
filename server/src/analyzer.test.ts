import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSpikes } from "./spikeDetector.js";
import { analyzeSymbol } from "./analyzer.js";
import type { Tick } from "./types.js";

function makeTicks(n: number, start = 1000): Tick[] {
  const ticks: Tick[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    // Quiet downward drift for Boom-like series
    price *= 0.99995;
    ticks.push({ epoch: 1_700_000_000 + i, quote: Number(price.toFixed(5)) });
  }
  return ticks;
}

test("detectSpikes finds boom up-spikes", () => {
  const ticks = makeTicks(300);
  // Inject a boom spike
  ticks[150].quote = ticks[149].quote * 1.03;
  const spikes = detectSpikes("BOOM1000", ticks, {
    zThreshold: 6,
    minAbsReturn: 0.002,
  });
  assert.ok(spikes.length >= 1);
  assert.ok(spikes.some((s) => s.index === 150));
});

test("detectSpikes finds crash down-spikes", () => {
  const ticks = makeTicks(300, 5000);
  ticks[180].quote = ticks[179].quote * 0.97;
  const spikes = detectSpikes("CRASH1000", ticks, {
    zThreshold: 6,
    minAbsReturn: 0.002,
  });
  assert.ok(spikes.some((s) => s.index === 180 && s.magnitude < 0));
});

test("analyzeSymbol returns capped confidence", () => {
  const ticks = makeTicks(400);
  ticks[100].quote = ticks[99].quote * 1.025;
  ticks[250].quote = ticks[249].quote * 1.025;
  const analysis = analyzeSymbol("BOOM1000", ticks);
  assert.equal(analysis.symbol, "BOOM1000");
  assert.ok(analysis.opportunity.confidence <= 0.7);
  assert.ok(analysis.candles.length > 0);
});
