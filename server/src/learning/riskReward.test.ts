import assert from "node:assert/strict";
import { test } from "node:test";
import { stopFromTarget, stopPctFromTargetPct } from "./riskReward.js";

test("stop is 33% of target distance (1:3)", () => {
  const stop = stopFromTarget(100, 103, true);
  assert.equal(stop, 99);
  const crashStop = stopFromTarget(100, 97, false);
  assert.equal(crashStop, 101);
});

test("stopPctFromTargetPct is one third", () => {
  assert.equal(stopPctFromTargetPct(0.9), 0.3);
  assert.equal(stopPctFromTargetPct(0.12), 0.04);
});
