import assert from "node:assert/strict";
import { test } from "node:test";
import {
  confluenceEdgeBoost,
  evaluateConfluence,
  evaluatePlaybooksHistorically,
} from "./confluence.js";
import type { Tick } from "../types.js";

function synthBoomTicks(n = 4000): Tick[] {
  const ticks: Tick[] = [];
  let price = 1000;
  const t0 = 1_700_000_000;
  for (let i = 0; i < n; i++) {
    // Slow drift with occasional dips into support and rare up-spikes.
    const cycle = i % 900;
    if (cycle > 820 && cycle < 835) {
      price *= 1.012; // boom spike cluster
    } else if (cycle > 700 && cycle < 780) {
      price *= 0.9997; // drift down into demand
    } else {
      price *= 1 + (Math.sin(i / 40) * 0.00015);
    }
    // Inject a clear EMA cross region mid-sample.
    if (i > 2000 && i < 2100) price *= 1.00035;
    ticks.push({ epoch: t0 + i, quote: Number(price.toFixed(4)) });
  }
  return ticks;
}

test("confluence returns structured snapshot", () => {
  const ticks = synthBoomTicks();
  const conf = evaluateConfluence("BOOM1000", ticks);
  assert.ok(conf.count >= 0);
  assert.ok(conf.score >= 0 && conf.score <= 1);
  assert.equal(conf.labels.length, conf.hits.length);
});

test("confluence boost scales with hits", () => {
  const none = confluenceEdgeBoost({
    hits: [],
    count: 0,
    score: 0,
    labels: [],
  });
  assert.equal(none.boost, 0);

  const prev = process.env.PLAYBOOK_EDGE_BOOST;
  process.env.PLAYBOOK_EDGE_BOOST = "1";
  try {
    const some = confluenceEdgeBoost({
      hits: [
        {
          id: "ema_cross",
          label: "EMA 9/21 cross up",
          score: 0.8,
          detail: "test",
        },
        {
          id: "order_block",
          label: "Demand zone",
          score: 0.7,
          detail: "test",
        },
      ],
      count: 2,
      score: 0.85,
      labels: ["EMA 9/21 cross up", "Demand zone"],
    });
    assert.ok(some.boost > 0.05);
    assert.ok(some.boost <= 0.14);
    assert.equal(some.reasons.length, 2);
  } finally {
    if (prev == null) delete process.env.PLAYBOOK_EDGE_BOOST;
    else process.env.PLAYBOOK_EDGE_BOOST = prev;
  }
});

test("confluence boost disabled by default for non-pattern playbooks", () => {
  const prev = process.env.PLAYBOOK_EDGE_BOOST;
  const prevPat = process.env.PATTERN_EDGE_BOOST;
  delete process.env.PLAYBOOK_EDGE_BOOST;
  delete process.env.PATTERN_EDGE_BOOST;
  try {
    const some = confluenceEdgeBoost({
      hits: [
        {
          id: "ema_cross",
          label: "EMA 9/21 cross up",
          score: 0.8,
          detail: "test",
        },
      ],
      count: 1,
      score: 0.8,
      labels: ["EMA 9/21 cross up"],
    });
    assert.equal(some.boost, 0);
    assert.ok(some.reasons[0]?.includes("info"));
  } finally {
    if (prev == null) delete process.env.PLAYBOOK_EDGE_BOOST;
    else process.env.PLAYBOOK_EDGE_BOOST = prev;
    if (prevPat == null) delete process.env.PATTERN_EDGE_BOOST;
    else process.env.PATTERN_EDGE_BOOST = prevPat;
  }
});

test("pattern edge boost applies to spike-base retests by default", () => {
  const prev = process.env.PLAYBOOK_EDGE_BOOST;
  const prevPat = process.env.PATTERN_EDGE_BOOST;
  delete process.env.PLAYBOOK_EDGE_BOOST;
  delete process.env.PATTERN_EDGE_BOOST;
  try {
    const some = confluenceEdgeBoost({
      hits: [
        {
          id: "spike_base_retest",
          label: "Spike-base retest",
          score: 0.76,
          detail: "test",
          shelfPrice: 100,
        },
      ],
      count: 1,
      score: 0.76,
      labels: ["Spike-base retest"],
      shelfPrice: 100,
    });
    assert.ok(some.boost > 0);
    assert.ok(some.reasons[0]?.includes("Pattern boost"));
  } finally {
    if (prev == null) delete process.env.PLAYBOOK_EDGE_BOOST;
    else process.env.PLAYBOOK_EDGE_BOOST = prev;
    if (prevPat == null) delete process.env.PATTERN_EDGE_BOOST;
    else process.env.PATTERN_EDGE_BOOST = prevPat;
  }
});

test("historical playbook eval returns baseline + three playbooks", () => {
  const ticks = synthBoomTicks(5000);
  const rows = evaluatePlaybooksHistorically("BOOM300N", ticks, 300);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].playbook, "baseline");
  assert.ok(rows[0].signals > 0);
});
