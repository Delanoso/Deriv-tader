import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeVol } from "./analyzer.js";
import type { VolTick } from "./types.js";

function synthTicks(n: number, start = 100, drift = 0.002): VolTick[] {
  const out: VolTick[] = [];
  let px = start;
  const t0 = 1_700_000_000;
  for (let i = 0; i < n; i++) {
    px = px * (1 + drift + (i % 7 === 0 ? -0.001 : 0.0004));
    out.push({ epoch: t0 + i, quote: Number(px.toFixed(5)) });
  }
  return out;
}

describe("analyzeVol", () => {
  it("projects upside targets on a rising series", () => {
    const ticks = synthTicks(2500, 100, 0.0012);
    const analysis = analyzeVol("1HZ250V", ticks);
    assert.equal(analysis.symbol, "1HZ250V");
    assert.ok(analysis.lastQuote != null);
    assert.ok(["up", "down", "neutral"].includes(analysis.prediction.bias));
    if (analysis.prediction.bias === "up") {
      assert.ok(analysis.prediction.targets.target > analysis.lastQuote!);
      assert.ok(analysis.prediction.targets.stretch >= analysis.prediction.targets.target);
      assert.ok(analysis.prediction.targets.invalidation < analysis.lastQuote!);
    }
  });

  it("projects downside targets on a falling series", () => {
    const ticks = synthTicks(2500, 100, -0.0012);
    const analysis = analyzeVol("1HZ250V", ticks);
    if (analysis.prediction.bias === "down") {
      assert.ok(analysis.prediction.targets.target < analysis.lastQuote!);
      assert.ok(analysis.prediction.targets.stretch <= analysis.prediction.targets.target);
      assert.ok(analysis.prediction.targets.invalidation > analysis.lastQuote!);
    }
  });
});
