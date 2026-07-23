import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyShelfAwareLevels,
  isNearShelf,
  stopBeyondShelf,
  stopFromTarget,
  stopPctFromTargetPct,
  targetFromStop,
} from "./riskReward.js";

test("stop is 33% of target distance (1:3)", () => {
  const stop = stopFromTarget(100, 103, true);
  assert.equal(stop, 99);
  const crashStop = stopFromTarget(100, 97, false);
  assert.equal(crashStop, 101);
});

test("targetFromStop restores 1:3", () => {
  assert.equal(targetFromStop(100, 99, true), 103);
  assert.equal(targetFromStop(100, 101, false), 97);
});

test("stopPctFromTargetPct is one third", () => {
  assert.equal(stopPctFromTargetPct(0.9), 0.3);
  assert.equal(stopPctFromTargetPct(0.12), 0.04);
});

test("Boom stop is pushed below the spike base", () => {
  const rr = stopFromTarget(9036, 9047, true);
  assert.ok(rr > 9028);
  const stop = stopBeyondShelf(rr, 9028.32, true, 0.5);
  assert.ok(stop < 9028.32);
  assert.equal(stop, 9027.82);
});

test("Crash stop is pushed above the crash ceiling", () => {
  const rr = stopFromTarget(9000, 8980, false);
  assert.ok(rr < 9010);
  const stop = stopBeyondShelf(rr, 9010, false, 0.4);
  assert.ok(stop > 9010);
  assert.equal(stop, 9010.4);
});

test("applyShelfAwareLevels restores target after shelf stop", () => {
  const levels = applyShelfAwareLevels({
    entry: 9036,
    target: 9047,
    stretch: 9055,
    shelf: 9028.32,
    favorUp: true,
    buffer: 0.5,
  });
  assert.ok(levels.shelfAdjusted);
  assert.ok(levels.stop < 9028.32);
  const stopDist = 9036 - levels.stop;
  const targetDist = levels.target - 9036;
  assert.ok(Math.abs(targetDist / stopDist - 3) < 0.001);
});

test("isNearShelf uses ATR band", () => {
  assert.equal(isNearShelf(9034, 9028, 4, 1.5), true); // band=6
  assert.equal(isNearShelf(9045, 9028, 4, 1.5), false);
  assert.equal(isNearShelf(9034, null, 4), false);
});

test("stopBeyondShelf leaves stop alone when already beyond shelf", () => {
  assert.equal(stopBeyondShelf(9020, 9028, true, 0.5), 9020);
  assert.equal(stopBeyondShelf(9020, 9010, false, 0.5), 9020);
});

test("stopBeyondShelf ignores missing shelf", () => {
  assert.equal(stopBeyondShelf(99, null, true, 1), 99);
  assert.equal(stopBeyondShelf(99, undefined, false, 1), 99);
});
