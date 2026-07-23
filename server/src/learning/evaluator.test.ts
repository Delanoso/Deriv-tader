import assert from "node:assert/strict";
import { test } from "node:test";
import type { JournalSignal, Tick } from "../types.js";
import { resolveSpikeHuntPath } from "./evaluator.js";

function ticksAround(entry = 100, n = 40): Tick[] {
  const out: Tick[] = [];
  const t0 = 1_700_000_000;
  for (let i = 0; i < n; i++) {
    out.push({ epoch: t0 + i, quote: entry });
  }
  return out;
}

function draft(partial: Partial<JournalSignal> = {}): JournalSignal {
  return {
    id: "t1",
    symbol: "BOOM1000",
    kind: "spike_watch",
    bias: "bullish",
    confidence: 0.5,
    entryPrice: 100,
    entryEpoch: 1_700_000_000,
    entryTickIndex: 0,
    horizonTicks: 10,
    target: 100.5,
    invalidation: 99.5,
    createdAt: Date.now(),
    status: "pending",
    outcome: "open",
    source: "live",
    ...partial,
  };
}

test("spike hunt stays open when horizon elapses without stop/target", () => {
  const path = ticksAround(100, 30);
  // Drift sideways past the old horizon (10).
  const resolved = resolveSpikeHuntPath(draft(), path, 0, path.length - 1, []);
  assert.equal(resolved, null);
});

test("spike hunt closes on target", () => {
  const path = ticksAround(100, 20);
  path[12] = { ...path[12], quote: 100.6 };
  const resolved = resolveSpikeHuntPath(draft(), path, 0, path.length - 1, []);
  assert.ok(resolved);
  assert.equal(resolved!.status, "win");
  assert.equal(resolved!.outcome, "target");
  assert.equal(resolved!.hitTarget, true);
});

test("spike hunt closes on stop", () => {
  const path = ticksAround(100, 20);
  path[8] = { ...path[8], quote: 99.4 };
  const resolved = resolveSpikeHuntPath(draft(), path, 0, path.length - 1, []);
  assert.ok(resolved);
  assert.equal(resolved!.status, "loss");
  assert.equal(resolved!.outcome, "stopout");
  assert.equal(resolved!.hitInvalidation, true);
});

test("spike hunt can still close on favorable spike print", () => {
  const path = ticksAround(100, 20);
  path[9] = { ...path[9], quote: 100.2 };
  const resolved = resolveSpikeHuntPath(draft(), path, 0, path.length - 1, [
    { index: 9, epoch: path[9].epoch, quote: 100.2 },
  ]);
  assert.ok(resolved);
  assert.equal(resolved!.status, "win");
  assert.equal(resolved!.outcome, "spike");
});
