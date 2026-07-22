import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Bias,
  JournalSignal,
  KindStats,
  LearningSummary,
  OpportunityKind,
  OutcomeBreakdown,
  RegimeBucketStats,
  Scoreboard,
  SymbolId,
} from "../types.js";
import { SYMBOL_IDS } from "../symbols.js";
import { DEFAULT_COST_PCT, withCostFields } from "./costs.js";
import { decayWeightedMean, decayWeightedRate } from "./decay.js";
import { buildFocusMap } from "./focusWeights.js";
import { buildLevelHints } from "./levelTune.js";
import { buildOutcomeBreakdown } from "./outcomes.js";
import type { AgeRegime, RsiRegime, TradeRegime } from "./regimes.js";
import { crossRegimeKey } from "./regimes.js";
import { walkForwardSplit } from "./walkForward.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const JOURNAL_PATH = path.join(DATA_DIR, "signal-journal.json");

type TradeKind = Exclude<OpportunityKind, "stand_aside">;

interface JournalFile {
  version: 1;
  signals: JournalSignal[];
}

function emptyStats(kind: KindStats["kind"]): KindStats {
  return {
    kind,
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
    decayWinRateAfterCost: null,
    decayExpectancyNetPct: null,
    decayEffectiveN: 0,
  };
}

function ensureStore(): JournalFile {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(JOURNAL_PATH)) {
    const fresh: JournalFile = { version: 1, signals: [] };
    writeFileSync(JOURNAL_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  try {
    const raw = readFileSync(JOURNAL_PATH, "utf8");
    const parsed = JSON.parse(raw) as JournalFile;
    if (!parsed.signals) parsed.signals = [];
    return parsed;
  } catch {
    return { version: 1, signals: [] };
  }
}

function persist(store: JournalFile): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${JOURNAL_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, JOURNAL_PATH);
}

function makeId(symbol: SymbolId, epoch: number): string {
  return `${symbol}-${epoch}-${Math.random().toString(36).slice(2, 8)}`;
}

function enrichResolved(patch: Partial<JournalSignal>): Partial<JournalSignal> {
  if (patch.returnPct == null) return patch;
  return { ...patch, ...withCostFields(patch.returnPct) };
}

export class SignalJournal {
  private store: JournalFile;
  private lastLiveKey: Partial<Record<SymbolId, string>> = {};
  private lastLiveAt: Partial<Record<SymbolId, number>> = {};

  constructor() {
    this.store = ensureStore();
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

  getSignals(): JournalSignal[] {
    return this.store.signals;
  }

  getPending(symbol?: SymbolId): JournalSignal[] {
    return this.store.signals.filter(
      (s) => s.status === "pending" && (symbol == null || s.symbol === symbol),
    );
  }

  maybeRecordLive(input: {
    symbol: SymbolId;
    kind: OpportunityKind;
    bias: Bias;
    confidence: number;
    entryPrice: number;
    entryEpoch: number;
    entryTickIndex: number;
    horizonTicks: number;
    target?: number;
    stretch?: number;
    invalidation?: number;
    regime?: TradeRegime;
  }): JournalSignal | null {
    if (input.kind === "stand_aside") return null;
    if (!input.entryPrice || !input.entryEpoch) return null;

    const key = `${input.kind}:${input.bias}:${input.regime?.ageRegime ?? "?"}:${input.regime?.rsiRegime ?? "?"}`;
    const now = Date.now();
    const prevKey = this.lastLiveKey[input.symbol];
    const prevAt = this.lastLiveAt[input.symbol] ?? 0;
    const sameSetup = prevKey === key;
    const learnMax =
      process.env.PAPER_LEARN_MAX == null ||
      process.env.PAPER_LEARN_MAX === "" ||
      (process.env.PAPER_LEARN_MAX !== "0" &&
        process.env.PAPER_LEARN_MAX !== "false");
    const cooldownMs = Number(
      process.env.PAPER_COOLDOWN_MS || (learnMax ? 45_000 : 120_000),
    );
    const maxPending = Number(
      process.env.PAPER_MAX_PENDING || (learnMax ? 3 : 1),
    );

    if (sameSetup && now - prevAt < cooldownMs) return null;

    const recentDup = this.store.signals.find(
      (s) =>
        s.symbol === input.symbol &&
        s.status === "pending" &&
        s.kind === input.kind &&
        s.bias === input.bias &&
        Math.abs(s.entryEpoch - input.entryEpoch) < (learnMax ? 45 : 90),
    );
    if (recentDup) return null;

    const openLive = this.store.signals.filter(
      (s) =>
        s.symbol === input.symbol &&
        s.status === "pending" &&
        s.kind === input.kind &&
        s.source === "live",
    );
    if (openLive.length >= maxPending) return null;

    const signal: JournalSignal = {
      id: makeId(input.symbol, input.entryEpoch),
      symbol: input.symbol,
      kind: input.kind as TradeKind,
      bias: input.bias,
      confidence: input.confidence,
      entryPrice: input.entryPrice,
      entryEpoch: input.entryEpoch,
      entryTickIndex: input.entryTickIndex,
      horizonTicks: input.horizonTicks,
      target: input.target,
      stretch: input.stretch,
      invalidation: input.invalidation,
      regime: input.regime,
      createdAt: now,
      status: "pending",
      outcome: "open",
      source: "live",
    };

    this.store.signals.push(signal);
    this.lastLiveKey[input.symbol] = key;
    this.lastLiveAt[input.symbol] = now;
    this.trim();
    persist(this.store);
    return signal;
  }

  addBootstrap(signals: JournalSignal[]): number {
    if (!signals.length) return 0;
    const enriched = signals.map((s) =>
      s.returnPct != null ? { ...s, ...withCostFields(s.returnPct) } : s,
    );
    this.store.signals.push(...enriched);
    this.trim();
    persist(this.store);
    return enriched.length;
  }

  updateSignal(id: string, patch: Partial<JournalSignal>): void {
    const idx = this.store.signals.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.store.signals[idx] = {
      ...this.store.signals[idx],
      ...enrichResolved(patch),
    };
    persist(this.store);
  }

  private trim(max = 5000): void {
    if (this.store.signals.length <= max) return;
    this.store.signals = this.store.signals.slice(-max);
  }

  summarize(): LearningSummary {
    const symbols: SymbolId[] = [...SYMBOL_IDS];
    const all = this.store.signals;
    const liveRows = all.filter((s) => s.source === "live");
    const seedRows = all.filter((s) => s.source === "bootstrap");
    const liveSpikeResolved = liveRows.filter(
      (s) =>
        s.kind === "spike_watch" && (s.status === "win" || s.status === "loss"),
    );

    const walkForward = walkForwardSplit(liveSpikeResolved);
    const holdoutSet = new Set(walkForward.holdoutIds);

    const bySymbol = {} as LearningSummary["bySymbol"];
    const calibrated: LearningSummary["calibrated"] = {};
    const liveBySymbol = {} as LearningSummary["live"]["bySymbol"];
    const seedBySymbol = {} as LearningSummary["seed"]["bySymbol"];
    const regimes: LearningSummary["regimes"] = {};
    const seedRegimes: LearningSummary["seedRegimes"] = {};
    const crossRegimes: LearningSummary["crossRegimes"] = {};
    const outcomesBySymbol: LearningSummary["outcomesBySymbol"] = {};
    const insights: string[] = [];

    for (const symbol of symbols) {
      const subset = all.filter((s) => s.symbol === symbol);
      const liveSub = liveRows.filter((s) => s.symbol === symbol);
      const seedSub = seedRows.filter((s) => s.symbol === symbol);
      const liveSpike = liveSub.filter((s) => s.kind === "spike_watch");

      bySymbol[symbol] = scoreboardParts(subset);
      liveBySymbol[symbol] = toScoreboard(liveSub);
      seedBySymbol[symbol] = toScoreboard(seedSub);
      regimes[symbol] = regimeBuckets(liveSpike);
      seedRegimes[symbol] = regimeBuckets(
        seedSub.filter((s) => s.kind === "spike_watch"),
      );
      crossRegimes[symbol] = crossRegimeBuckets(liveSpike);
      outcomesBySymbol[symbol] = buildOutcomeBreakdown(liveSpike);

      calibrated[symbol] = {};
      const kinds: TradeKind[] = ["drift_follow", "spike_watch", "post_spike"];
      for (const kind of kinds) {
        // Exclude walk-forward holdout from calibration.
        const kindRows = liveSub.filter(
          (s) => s.kind === kind && !holdoutSet.has(s.id),
        );
        const st = statsFor(kindRows, kind);
        if (!st) continue;

        const decayWr = decayWeightedRate(kindRows, (s) =>
          s.winAfterCost != null
            ? s.winAfterCost
            : s.returnNetPct != null
              ? s.returnNetPct > 0
              : null,
        );
        const decayExp = decayWeightedMean(kindRows, (s) => s.returnNetPct ?? null);

        const n = Math.max(st.decayEffectiveN, decayWr.effectiveN, decayExp.effectiveN);
        if (n >= 8) {
          let learned = decayWr.rate ?? st.winRateAfterCost ?? st.winRate;
          if (decayExp.mean != null) {
            const expScore = 0.5 + Math.tanh(decayExp.mean * 8) * 0.25;
            learned =
              learned != null
                ? Number((learned * 0.55 + expScore * 0.45).toFixed(3))
                : Number(expScore.toFixed(3));
          }
          if (learned != null) {
            const shrink = n / (n + 12);
            calibrated[symbol]![kind] = Number(
              (0.5 * (1 - shrink) + learned * shrink).toFixed(3),
            );
          }
        }
      }

      const liveInsight = regimeInsight(symbol, regimes[symbol] ?? [], "live", 5);
      if (liveInsight) insights.push(liveInsight);
      else {
        const seedInsight = regimeInsight(
          symbol,
          seedRegimes[symbol] ?? [],
          "seed",
          6,
        );
        if (seedInsight) insights.push(seedInsight);
      }

      const crossInsight = crossRegimeInsight(symbol, crossRegimes[symbol] ?? []);
      if (crossInsight) insights.push(crossInsight);

      const outcomeNote = outcomesBySymbol[symbol]?.note;
      if (outcomeNote) insights.push(`${symbol}: ${outcomeNote}`);
    }

    const focus = buildFocusMap({
      symbols,
      liveBySymbol,
      liveRegimes: regimes,
    });
    for (const row of focus.rows) {
      if (row.deprioritize && row.n >= 8) {
        insights.push(`${row.label}: ${row.note}`);
      }
    }

    const levelHints = buildLevelHints(liveSpikeResolved, symbols);
    for (const hint of Object.values(levelHints)) {
      if (hint) insights.push(`${hint.symbol}: ${hint.note}`);
    }

    if (walkForward.note) insights.push(`Walk-forward: ${walkForward.note}`);

    const liveOverall = statsFor(liveRows, "all");
    const seedOverall = statsFor(seedRows, "all");
    const allResolved = all.filter((s) => s.status === "win" || s.status === "loss");
    const allWins = allResolved.filter((s) => s.status === "win").length;
    const outcomes = buildOutcomeBreakdown(liveSpikeResolved);

    return {
      totalSignals: all.length,
      pending: all.filter((s) => s.status === "pending").length,
      resolved: allResolved.length,
      overallWinRate: allResolved.length
        ? Number((allWins / allResolved.length).toFixed(3))
        : null,
      costPctAssumed: DEFAULT_COST_PCT,
      live: {
        overall: liveOverall,
        bySymbol: liveBySymbol,
        resolved: liveRows.filter((s) => s.status === "win" || s.status === "loss")
          .length,
        pending: liveRows.filter((s) => s.status === "pending").length,
        overallWinRate: liveOverall.winRate,
        overallWinRateAfterCost: liveOverall.winRateAfterCost,
      },
      seed: {
        overall: seedOverall,
        bySymbol: seedBySymbol,
        resolved: seedRows.filter((s) => s.status === "win" || s.status === "loss")
          .length,
        overallWinRate: seedOverall.winRate,
        overallWinRateAfterCost: seedOverall.winRateAfterCost,
      },
      bySymbol,
      regimes,
      seedRegimes,
      crossRegimes,
      outcomes,
      outcomesBySymbol,
      focus,
      levelHints,
      walkForward: {
        trainN: walkForward.trainN,
        holdoutN: walkForward.holdoutN,
        trainWinRateAfterCost: walkForward.trainWinRateAfterCost,
        holdoutWinRateAfterCost: walkForward.holdoutWinRateAfterCost,
        trainExpectancyNetPct: walkForward.trainExpectancyNetPct,
        holdoutExpectancyNetPct: walkForward.holdoutExpectancyNetPct,
        gapExpectancy: walkForward.gapExpectancy,
        note: walkForward.note,
      },
      insights: uniqueInsights(insights).slice(0, 12),
      recent: [...all].slice(-12).reverse(),
      calibrated,
      updatedAt: Date.now(),
    };
  }
}

function uniqueInsights(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

function regimeBuckets(signals: JournalSignal[]): RegimeBucketStats[] {
  const keys: AgeRegime[] = ["early", "mid", "late", "overdue"];
  return keys.map((key) => ({
    key,
    label: key,
    stats: statsFor(
      signals.filter((s) => (s.regime?.ageRegime ?? "mid") === key),
      "spike_watch",
    ),
  }));
}

function crossRegimeBuckets(signals: JournalSignal[]): RegimeBucketStats[] {
  const ages: AgeRegime[] = ["early", "mid", "late", "overdue"];
  const rsis: RsiRegime[] = ["oversold", "neutral", "overbought"];
  const out: RegimeBucketStats[] = [];
  for (const age of ages) {
    for (const rsi of rsis) {
      const key = crossRegimeKey(age, rsi);
      const rows = signals.filter((s) => {
        const a = s.regime?.ageRegime ?? "mid";
        const r =
          (s.regime as TradeRegime | undefined)?.rsiRegime ??
          rsiFromLegacy(s.regime?.rsi14 ?? null);
        return a === age && r === rsi;
      });
      if (!rows.length) continue;
      out.push({
        key,
        label: `${age} × ${rsi}`,
        stats: statsFor(rows, "spike_watch"),
      });
    }
  }
  return out;
}

function rsiFromLegacy(rsi: number | null): RsiRegime {
  if (rsi == null) return "neutral";
  if (rsi < 35) return "oversold";
  if (rsi > 65) return "overbought";
  return "neutral";
}

function regimeInsight(
  symbol: SymbolId,
  buckets: RegimeBucketStats[],
  source: "live" | "seed",
  minN: number,
): string | null {
  const ranked = buckets
    .map((b) => ({
      key: b.key,
      n: b.stats.winsAfterCost + b.stats.lossesAfterCost,
      exp: b.stats.decayExpectancyNetPct ?? b.stats.expectancyNetPct,
      wr: b.stats.decayWinRateAfterCost ?? b.stats.winRateAfterCost,
    }))
    .filter((b) => b.n >= minN && b.exp != null);
  if (ranked.length < 2) return null;
  ranked.sort((a, b) => (b.exp ?? -99) - (a.exp ?? -99));
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  if (best.exp == null || worst.exp == null) return null;
  if (best.exp - worst.exp < 0.01) return null;
  const tag = source === "seed" ? "seed" : "live";
  return `${symbol}: [${tag}] ${best.key} hunts beat ${worst.key} (exp ${best.exp.toFixed(3)}% vs ${worst.exp.toFixed(3)}%) — prefer ${best.key} age regime.`;
}

function crossRegimeInsight(
  symbol: SymbolId,
  buckets: RegimeBucketStats[],
): string | null {
  const ranked = buckets
    .map((b) => ({
      key: b.key,
      label: b.label,
      n: b.stats.winsAfterCost + b.stats.lossesAfterCost,
      exp: b.stats.decayExpectancyNetPct ?? b.stats.expectancyNetPct,
    }))
    .filter((b) => b.n >= 8 && b.exp != null);
  if (ranked.length < 2) return null;
  ranked.sort((a, b) => (b.exp ?? -99) - (a.exp ?? -99));
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  if (best.exp == null || worst.exp == null) return null;
  if (best.exp - worst.exp < 0.015) return null;
  return `${symbol}: [cross] ${best.label} beats ${worst.label} (exp ${best.exp.toFixed(3)}% vs ${worst.exp.toFixed(3)}%).`;
}

function scoreboardParts(signals: JournalSignal[]): {
  overall: KindStats;
  byKind: Partial<Record<TradeKind, KindStats>>;
} {
  const kinds: TradeKind[] = ["drift_follow", "spike_watch", "post_spike"];
  const byKind: Partial<Record<TradeKind, KindStats>> = {};
  for (const kind of kinds) {
    byKind[kind] = statsFor(
      signals.filter((s) => s.kind === kind),
      kind,
    );
  }
  return { overall: statsFor(signals, "all"), byKind };
}

function toScoreboard(signals: JournalSignal[]): Scoreboard {
  const parts = scoreboardParts(signals);
  return {
    ...parts,
    resolved: signals.filter((s) => s.status === "win" || s.status === "loss").length,
    pending: signals.filter((s) => s.status === "pending").length,
    overallWinRate: parts.overall.winRate,
    overallWinRateAfterCost: parts.overall.winRateAfterCost,
  };
}

function statsFor(signals: JournalSignal[], kind: KindStats["kind"]): KindStats {
  if (!signals.length) return emptyStats(kind);

  const wins = signals.filter((s) => s.status === "win");
  const losses = signals.filter((s) => s.status === "loss");
  const pending = signals.filter((s) => s.status === "pending").length;
  const decided = wins.length + losses.length;
  const decidedRows = [...wins, ...losses];
  const returns = decidedRows
    .map((s) => s.returnPct)
    .filter((v): v is number => v != null);
  const avg =
    returns.length > 0
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : null;

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

  const mfes = decidedRows
    .map((s) => s.mfePct)
    .filter((v): v is number => v != null);
  const maes = decidedRows
    .map((s) => s.maePct)
    .filter((v): v is number => v != null);
  const avgMfe =
    mfes.length > 0 ? mfes.reduce((a, b) => a + b, 0) / mfes.length : null;
  const avgMae =
    maes.length > 0 ? maes.reduce((a, b) => a + b, 0) / maes.length : null;

  const decayWr = decayWeightedRate(signals, (s) =>
    s.winAfterCost != null
      ? s.winAfterCost
      : s.returnNetPct != null
        ? s.returnNetPct > 0
        : null,
  );
  const decayExp = decayWeightedMean(signals, (s) => s.returnNetPct ?? null);

  return {
    kind,
    total: signals.length,
    wins: wins.length,
    losses: losses.length,
    pending,
    winRate: decided ? Number((wins.length / decided).toFixed(3)) : null,
    avgReturnPct: avg != null ? Number(avg.toFixed(4)) : null,
    winsAfterCost,
    lossesAfterCost,
    winRateAfterCost: netRows.length
      ? Number((winsAfterCost / netRows.length).toFixed(3))
      : null,
    avgReturnNetPct: avgNet != null ? Number(avgNet.toFixed(4)) : null,
    expectancyNetPct: avgNet != null ? Number(avgNet.toFixed(4)) : null,
    avgMfePct: avgMfe != null ? Number(avgMfe.toFixed(4)) : null,
    avgMaePct: avgMae != null ? Number(avgMae.toFixed(4)) : null,
    decayWinRateAfterCost: decayWr.rate,
    decayExpectancyNetPct: decayExp.mean,
    decayEffectiveN: Math.max(decayWr.effectiveN, decayExp.effectiveN),
  };
}

export function blendConfidence(
  base: number,
  learned: number | undefined,
  minSamplesMet: boolean,
): number {
  if (!minSamplesMet || learned == null) return base;
  const blended = base * 0.55 + learned * 0.45;
  return Number(Math.max(0.12, Math.min(0.72, blended)).toFixed(2));
}
