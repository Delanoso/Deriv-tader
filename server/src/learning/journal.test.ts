import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_COST_PCT, netReturnPct, withCostFields } from "./costs.js";
import { blendConfidence } from "./journal.js";

test("blendConfidence pulls toward learned rate", () => {
  const blended = blendConfidence(0.4, 0.7, true);
  assert.ok(blended > 0.4);
  assert.ok(blended < 0.7);
});

test("blendConfidence ignores learned when samples unmet", () => {
  assert.equal(blendConfidence(0.4, 0.9, false), 0.4);
});

test("netReturnPct subtracts round-trip cost", () => {
  assert.equal(netReturnPct(0.05, 0.02), 0.03);
  assert.equal(withCostFields(0.01, 0.02).winAfterCost, false);
  assert.equal(withCostFields(0.05, 0.02).winAfterCost, true);
  assert.ok(DEFAULT_COST_PCT >= 0);
});
