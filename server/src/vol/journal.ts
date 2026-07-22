import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FocusWeightView, OutcomeBreakdown } from "../types.js";
import { DEFAULT_COST_PCT, withCostFields } from "../learning/costs.js";
import { decayWeightedMean, decayWeightedRate } from "../learning/decay.js";
import { buildOutcomeBreakdown } from "../learning/outcomes.js";
import type {
  VolBias,
  VolFocusMap,
  VolJournalSignal,
  VolKindStats,
  VolLearningSummary,
  VolSymbolId,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const JOURNAL_PATH = path.join(DATA_DIR, "vol-journal.json");

interface Store {
  version: 1;
  signals: VolJournalSignal[];
}

function emptyStats(): VolKindStats {
  return {
    total: 0,
    wins: 0,
    losses: 0,
    pending: 0,
    winRate: null,
    avgReturnPct: null,
    winsAfterCost: 0,
    lossesAfterCost: 0,
    winRateAfterCost: null,
    avgReturnNetPct: null,
    expectancyNetPct: null,
    avgMfePct: null,
    avgMaePct: null,
    targetHitRate: null,
    decayWinRateAfterCost: null,
    decayExpectancyNetPct: null,
    decayEffectiveN: 0,
  };
}

function enrichResolved(patch: Partial<VolJournalSignal>): Partial<VolJournalSignal> {
  if (patch.returnPct == null) return patch;
  return { ...patch, ...withCostFields(patch.returnPct) };
}

function ensure(): Store {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(JOURNAL_PATH)) {
    const fresh: Store = { version: 1, signals: [] };
    writeFileSync(JOURNAL_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  try {
    return JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as Store;
  } catch {
    return { version: 1, signals: [] };
  }
}

function persist(store: Store): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${JOURNAL_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, JOURNAL_PATH);
}

export class VolJournal {
  private store: Store;
  private lastKey: string | null = null;
  private lastAt = 0;

  constructor() {
    this.store = ensure();
    this.backfillCosts();
  }

  private backfillCosts(): void {
    let changed = false;
    for (const s of this.store.signals) {
      if (s.returnPct == null) continue;
      if (s.returnNetPct != null && s.costPctAssumed != null) continue;
      Object.assign(s, withCostFields(s.returnPct));
      changed = true;
    }
    if (changed) persist(this.store);
  }

  getSignals(): VolJournalSignal[] {
    return this.store.signals;
  }

  getPending(): VolJournalSignal[] {
    return this.store.signals.filter((s) => s.status === "pending");
  }

  maybeRecordLive(input: Omit<VolJournalSignal, "id" | "createdAt" | "status" | "source">): VolJournalSignal | null {
    if (input.bias === ("neutral" as VolBias)) return null;
    const key = `${input.bias}:${input.target.toFixed(5)}`;
    const now = Date.now();
    if (this.lastKey === key && now - this.lastAt < 180_000) return null;
    if (this.store.signals.some((s) => s.status === "pending" && s.bias === input.bias)) {
      return null;
    }

    const signal: VolJournalSignal = {
      ...input,
      id: `vol-${input.entryEpoch}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now,
      status: "pending",
      source: "live",
    };
    this.store.signals.push(signal);
    this.lastKey = key;
    this.lastAt = now;
    this.trim();
    persist(this.store);
    return signal;
  }

  addBootstrap(rows: VolJournalSignal[]): number {
    if (!rows.length) return 0;
    for (const row of rows) {
      if (row.returnPct != null) {
        Object.assign(row, withCostFields(row.returnPct));
      }
    }
    this.store.signals.push(...rows);
    this.trim();
    persist(this.store);
    return rows.length;
  }

  update(id: string, patch: Partial<VolJournalSignal>): void {
    const i = this.store.signals.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.store.signals[i] = { ...this.store.signals[i], ...enrichResolved(patch) };
    persist(this.store);
  }

  private trim(max = 4000): void {
    if (this.store.signals.length > max) {
      this.store.signals = this.store.signals.slice(-max);
    }
  }

  summarize(): VolLearningSummary {
    const all = this.store.signals;
    const up = statsFor(all.filter((s) => s.bias === "up"));
    const down = statsFor(all.filter((s) => s.bias === "down"));
    const decided = all.filter((s) => s.status === "win" || s.status === "loss");
    const wins = decided.filter((s) => s.status === "win").length;
    const targetHits = decided.filter((s) => s.hitTarget).length;

    const outcomes = buildOutcomeBreakdown(all);
    const outcomesByBias = {
      up: buildOutcomeBreakdown(all.filter((s) => s.bias === "up")),
      down: buildOutcomeBreakdown(all.filter((s) => s.bias === "down")),
    };

    const calibrated: VolLearningSummary["calibrated"] = {};
    for (const [bias, st] of [
      ["up", up],
      ["down", down],
    ] as const) {
      const n = st.wins + st.losses;
      if (st.winRate != null && n >= 8) {
        const shrink = n / (n + 12);
        calibrated[bias] = Number((0.5 * (1 - shrink) + st.winRate * shrink).toFixed(3));
      }
    }

    const focus = buildVolFocus(up, down);
    const insights = buildVolInsights({
      up,
      down,
      outcomes,
      outcomesByBias,
      focus,
    });

    return {
      totalSignals: all.length,
      pending: all.filter((s) => s.status === "pending").length,
      resolved: decided.length,
      overallWinRate: decided.length ? Number((wins / decided.length).toFixed(3)) : null,
      targetHitRate: decided.length ? Number((targetHits / decided.length).toFixed(3)) : null,
      costPctAssumed: DEFAULT_COST_PCT,
      byBias: { up, down },
      outcomes,
      outcomesByBias,
      insights,
      focus,
      recent: [...all].slice(-12).reverse(),
      calibrated,
      updatedAt: Date.now(),
    };
  }
}

function statsFor(rows: VolJournalSignal[]): VolKindStats {
  if (!rows.length) return emptyStats();
  const wins = rows.filter((s) => s.status === "win");
  const losses = rows.filter((s) => s.status === "loss");
  const pending = rows.filter((s) => s.status === "pending").length;
  const decidedRows = [...wins, ...losses];
  const avg = (vals: number[]) =>
    vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const rets = decidedRows.map((s) => s.returnPct).filter((v): v is number => v != null);

  const netRows = decidedRows
    .map((s) => {
      if (s.returnNetPct != null && s.winAfterCost != null) {
        return { net: s.returnNetPct, win: s.winAfterCost };
      }
      if (s.returnPct == null) return null;
      const fields = withCostFields(s.returnPct);
      return { net: fields.returnNetPct, win: fields.winAfterCost };
    })
    .filter((v): v is { net: number; win: boolean } => v != null);

  const winsAfterCost = netRows.filter((r) => r.win).length;
  const lossesAfterCost = netRows.length - winsAfterCost;
  const avgNet =
    netRows.length > 0
      ? netRows.reduce((a, b) => a + b.net, 0) / netRows.length
      : null;

  const mfes = decidedRows.map((s) => s.mfePct).filter((v): v is number => v != null);
  const maes = decidedRows.map((s) => s.maePct).filter((v): v is number => v != null);
  const targetHits = decidedRows.filter((s) => s.hitTarget).length;

  const decayWr = decayWeightedRate(rows, (s) =>
    s.winAfterCost != null
      ? s.winAfterCost
      : s.returnNetPct != null
        ? s.returnNetPct > 0
        : null,
  );
  const decayExp = decayWeightedMean(rows, (s) => s.returnNetPct ?? null);

  return {
    total: rows.length,
    wins: wins.length,
    losses: losses.length,
    pending,
    winRate: decidedRows.length
      ? Number((wins.length / decidedRows.length).toFixed(3))
      : null,
    avgReturnPct: avg(rets) != null ? Number(avg(rets)!.toFixed(4)) : null,
    winsAfterCost,
    lossesAfterCost,
    winRateAfterCost: netRows.length
      ? Number((winsAfterCost / netRows.length).toFixed(3))
      : null,
    avgReturnNetPct: avgNet != null ? Number(avgNet.toFixed(4)) : null,
    expectancyNetPct: avgNet != null ? Number(avgNet.toFixed(4)) : null,
    avgMfePct: avg(mfes) != null ? Number(avg(mfes)!.toFixed(4)) : null,
    avgMaePct: avg(maes) != null ? Number(avg(maes)!.toFixed(4)) : null,
    targetHitRate: decidedRows.length
      ? Number((targetHits / decidedRows.length).toFixed(3))
      : null,
    decayWinRateAfterCost: decayWr.rate,
    decayExpectancyNetPct: decayExp.mean,
    decayEffectiveN: Math.max(decayWr.effectiveN, decayExp.effectiveN),
  };
}

function weightFromExp(exp: number | null, n: number, minN: number): number {
  if (n < minN || exp == null) return 1;
  const w = 1 + Math.tanh(exp * 12) * 0.35;
  return Number(Math.max(0.55, Math.min(1.15, w)).toFixed(3));
}

function buildVolFocus(up: VolKindStats, down: VolKindStats): VolFocusMap {
  const minN = Number(process.env.FOCUS_MIN_N || 8);
  const make = (key: "up" | "down", st: VolKindStats): FocusWeightView => {
    const n = st.winsAfterCost + st.lossesAfterCost;
    const exp = st.decayExpectancyNetPct ?? st.expectancyNetPct;
    const weight = weightFromExp(exp, n, minN);
    const deprioritize = n >= minN && exp != null && exp < 0;
    const label = key === "up" ? "Up calls" : "Down calls";
    return {
      key,
      label,
      n,
      expectancyNetPct: exp,
      weight,
      deprioritize,
      note:
        n < minN
          ? `Need ≥${minN} decisions before focus weighting`
          : deprioritize
            ? `Deprioritize — exp ${exp!.toFixed(3)}% on n=${n}`
            : `Focus weight ×${weight} (exp ${exp!.toFixed(3)}%, n=${n})`,
    };
  };
  const upFw = make("up", up);
  const downFw = make("down", down);
  const rows = [upFw, downFw];
  let preferred: "up" | "down" | null = null;
  const upN = upFw.n;
  const downN = downFw.n;
  const upExp = upFw.expectancyNetPct;
  const downExp = downFw.expectancyNetPct;
  if (upN >= minN && downN >= minN && upExp != null && downExp != null) {
    preferred = upExp > downExp ? "up" : downExp > upExp ? "down" : null;
  } else if (upN >= minN && upExp != null && (downN < minN || downExp == null)) {
    preferred = upExp > 0 ? "up" : null;
  } else if (downN >= minN && downExp != null && (upN < minN || upExp == null)) {
    preferred = downExp > 0 ? "down" : null;
  }
  return {
    byBias: { up: upFw, down: downFw },
    rows,
    preferred,
  };
}

function buildVolInsights(input: {
  up: VolKindStats;
  down: VolKindStats;
  outcomes: OutcomeBreakdown;
  outcomesByBias: { up: OutcomeBreakdown; down: OutcomeBreakdown };
  focus: VolFocusMap;
}): string[] {
  const lines: string[] = [];
  if (input.outcomes.note) lines.push(input.outcomes.note);
  for (const bias of ["up", "down"] as const) {
    const note = input.outcomesByBias[bias].note;
    if (note) lines.push(`${bias}: ${note}`);
  }
  for (const row of input.focus.rows) {
    if (row.deprioritize) lines.push(`${row.label}: ${row.note}`);
  }
  if (input.focus.preferred) {
    const label = input.focus.preferred === "up" ? "Up calls" : "Down calls";
    lines.push(`Preferred bias: ${label} (higher net expectancy)`);
  }
  const upExp = input.up.decayExpectancyNetPct ?? input.up.expectancyNetPct;
  const downExp = input.down.decayExpectancyNetPct ?? input.down.expectancyNetPct;
  if (upExp != null && downExp != null) {
    const gap = Math.abs(upExp - downExp);
    if (gap >= 0.05) {
      const better = upExp > downExp ? "up" : "down";
      lines.push(
        `${better} bias leads by ${gap.toFixed(3)}% net expectancy (decay-weighted)`,
      );
    }
  }
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  }).slice(0, 12);
}

export function blendVolConfidence(base: number, learned?: number): number {
  if (learned == null) return base;
  return Number(Math.max(0.12, Math.min(0.75, base * 0.55 + learned * 0.45)).toFixed(2));
}
