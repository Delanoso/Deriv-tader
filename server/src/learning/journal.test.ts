import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { blendConfidence } from "./journal.js";

test("blendConfidence pulls toward learned rate", () => {
  const blended = blendConfidence(0.4, 0.7, true);
  assert.ok(blended > 0.4);
  assert.ok(blended < 0.7);
});

test("blendConfidence ignores learned when samples unmet", () => {
  assert.equal(blendConfidence(0.4, 0.9, false), 0.4);
});

// Keep a tiny filesystem-free sanity check that tmp dirs work for future expansion
test("temp data dir available", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "spikescope-"));
  assert.ok(dir.includes("spikescope-"));
  rmSync(dir, { recursive: true, force: true });
});
