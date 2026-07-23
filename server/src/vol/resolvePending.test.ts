import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVolPending } from "./analyzer.js";
import type { VolJournalSignal, VolTick } from "./types.js";

function ticks(n: number, start = 100): VolTick[] {
  const out: VolTick[] = [];
  const t0 = 1_700_000_000;
  for (let i = 0; i < n; i++) {
    out.push({ epoch: t0 + i, quote: start });
  }
  return out;
}

test("vol pending stays open past horizon without stop/target", () => {
  const path = ticks(500, 100);
  const pending: VolJournalSignal[] = [
    {
      id: "v1",
      symbol: "1HZ250V",
      bias: "up",
      confidence: 0.5,
      entryPrice: 100,
      entryEpoch: path[0].epoch,
      entryTickIndex: 0,
      target: 101,
      stretch: 101.5,
      invalidation: 99,
      horizonTicks: 200,
      createdAt: Date.now(),
      status: "pending",
      source: "live",
    },
  ];
  let updated = 0;
  const n = resolveVolPending(pending, path, () => {
    updated += 1;
  });
  assert.equal(n, 0);
  assert.equal(updated, 0);
});

test("vol pending closes on target after min hold", () => {
  const path = ticks(250, 100);
  path[200] = { ...path[200], quote: 101.2 };
  const pending: VolJournalSignal[] = [
    {
      id: "v2",
      symbol: "1HZ250V",
      bias: "up",
      confidence: 0.5,
      entryPrice: 100,
      entryEpoch: path[0].epoch,
      entryTickIndex: 0,
      target: 101,
      stretch: 101.5,
      invalidation: 99,
      horizonTicks: 180,
      createdAt: Date.now(),
      status: "pending",
      source: "live",
    },
  ];
  const patches: Partial<VolJournalSignal>[] = [];
  const n = resolveVolPending(pending, path, (_id, patch) => {
    patches.push(patch);
  });
  assert.equal(n, 1);
  assert.equal(patches[0].status, "win");
  assert.equal(patches[0].outcome, "target");
});
