import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSpikeForecast,
  conditionalSpikeProb,
} from "./hazard.js";
import { evaluateKillRule } from "./killRules.js";
import type { SpikeEvent } from "../types.js";

function gapsToSpikes(gaps: number[]): SpikeEvent[] {
  let idx = 0;
  const spikes: SpikeEvent[] = [
    {
      index: 0,
      epoch: 1,
      quote: 1000,
      magnitude: 0.01,
      ticksSincePrevious: null,
    },
  ];
  for (const g of gaps) {
    idx += g;
    spikes.push({
      index: idx,
      epoch: idx,
      quote: 1000,
      magnitude: 0.01,
      ticksSincePrevious: g,
    });
  }
  return spikes;
}

test("conditionalSpikeProb rises when age nears typical gaps", () => {
  const gaps = Array.from({ length: 40 }, () => 1000);
  const early = conditionalSpikeProb(gaps, 100, 200);
  const late = conditionalSpikeProb(gaps, 900, 200);
  assert.ok(early.probability != null);
  assert.ok(late.probability != null);
  assert.ok((late.probability as number) > (early.probability as number));
});

test("buildSpikeForecast returns horizons", () => {
  const spikes = gapsToSpikes(Array.from({ length: 30 }, (_, i) => 800 + (i % 5) * 50));
  const forecast = buildSpikeForecast(spikes, 700);
  assert.equal(forecast.horizons.length, 4);
  assert.ok(forecast.gapSampleSize >= 30);
});

test("kill rule triggers below threshold with enough samples", () => {
  const killed = evaluateKillRule(
    {
      kind: "spike_watch",
      total: 60,
      wins: 20,
      losses: 40,
      pending: 0,
      winRate: 0.33,
      avgReturnPct: -0.01,
      winsAfterCost: 18,
      lossesAfterCost: 42,
      winRateAfterCost: 0.3,
      avgReturnNetPct: -0.02,
    },
    { minSamples: 50, minWinRateAfterCost: 0.45 },
  );
  assert.equal(killed.killed, true);
  assert.ok(killed.reason);
});

test("kill rule waits for sample size", () => {
  const open = evaluateKillRule(
    {
      kind: "spike_watch",
      total: 30,
      wins: 8,
      losses: 22,
      pending: 0,
      winRate: 0.267,
      avgReturnPct: -0.01,
      winsAfterCost: 6,
      lossesAfterCost: 24,
      winRateAfterCost: 0.2,
      avgReturnNetPct: -0.02,
    },
    { minSamples: 50, minWinRateAfterCost: 0.45 },
  );
  assert.equal(open.killed, false);
  assert.equal(open.warning, true);
});
