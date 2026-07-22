import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Bias,
  JournalSignal,
  KindStats,
  LearningSummary,
  OpportunityKind,
  Scoreboard,
  SymbolId,
} from "../types.js";
import { SYMBOL_IDS } from "../symbols.js";
import { DEFAULT_COST_PCT, withCostFields } from "./costs.js";

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

  /** Ensure older journal rows have net/cost fields. */
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
  }): JournalSignal | null {
    if (input.kind === "stand_aside") return null;
    if (!input.entryPrice || !input.entryEpoch) return null;

    const key = `${input.kind}:${input.bias}`;
    const now = Date.now();
    const prevKey = this.lastLiveKey[input.symbol];
    const prevAt = this.lastLiveAt[input.symbol] ?? 0;
    const sameSetup = prevKey === key;
    const cooldownMs = 90_000;

    if (sameSetup && now - prevAt < cooldownMs) return null;

    const recentDup = this.store.signals.find(
      (s) =>
        s.symbol === input.symbol &&
        s.status === "pending" &&
        s.kind === input.kind &&
        s.bias === input.bias &&
        Math.abs(s.entryEpoch - input.entryEpoch) < 90,
    );
    if (recentDup) return null;

    const openSame = this.store.signals.find(
      (s) =>
        s.symbol === input.symbol &&
        s.status === "pending" &&
        s.kind === input.kind &&
        s.source === "live",
    );
    if (openSame) return null;

    const signal: JournalSignal = {
      id: makeId(input.symbol, input.entryEpoch),
      symbol: input.symbol,
      kind: input.kind,
      bias: input.bias,
      confidence: input.confidence,
      entryPrice: input.entryPrice,
      entryEpoch: input.entryEpoch,
      entryTickIndex: input.entryTickIndex,
      horizonTicks: input.horizonTicks,
      createdAt: now,
      status: "pending",
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

    const bySymbol = {} as LearningSummary["bySymbol"];
    const calibrated: LearningSummary["calibrated"] = {};
    const liveBySymbol = {} as LearningSummary["live"]["bySymbol"];
    const seedBySymbol = {} as LearningSummary["seed"]["bySymbol"];

    for (const symbol of symbols) {
      const subset = all.filter((s) => s.symbol === symbol);
      const liveSub = liveRows.filter((s) => s.symbol === symbol);
      const seedSub = seedRows.filter((s) => s.symbol === symbol);

      bySymbol[symbol] = scoreboardParts(subset);
      liveBySymbol[symbol] = toScoreboard(liveSub);
      seedBySymbol[symbol] = toScoreboard(seedSub);

      // Calibrate ONLY from live decisions.
      calibrated[symbol] = {};
      const kinds: TradeKind[] = ["drift_follow", "spike_watch", "post_spike"];
      for (const kind of kinds) {
        const st = liveBySymbol[symbol].byKind[kind];
        if (!st) continue;
        // Prefer after-cost win rate when enough samples exist.
        const rate = st.winRateAfterCost ?? st.winRate;
        const n = st.winsAfterCost + st.lossesAfterCost || st.wins + st.losses;
        if (rate != null && n >= 8) {
          const shrink = n / (n + 12);
          calibrated[symbol]![kind] = Number(
            (0.5 * (1 - shrink) + rate * shrink).toFixed(3),
          );
        }
      }
    }

    const liveOverall = statsFor(liveRows, "all");
    const seedOverall = statsFor(seedRows, "all");
    const allResolved = all.filter((s) => s.status === "win" || s.status === "loss");
    const allWins = allResolved.filter((s) => s.status === "win").length;

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
      recent: [...all].slice(-12).reverse(),
      calibrated,
      updatedAt: Date.now(),
    };
  }
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
  const returns = [...wins, ...losses]
    .map((s) => s.returnPct)
    .filter((v): v is number => v != null);
  const avg =
    returns.length > 0
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : null;

  const decidedRows = [...wins, ...losses];
  const netRows = decidedRows.map((s) => {
    if (s.returnNetPct != null && s.winAfterCost != null) {
      return { net: s.returnNetPct, win: s.winAfterCost };
    }
    if (s.returnPct == null) return null;
    const fields = withCostFields(s.returnPct);
    return { net: fields.returnNetPct, win: fields.winAfterCost };
  }).filter((v): v is { net: number; win: boolean } => v != null);

  const winsAfterCost = netRows.filter((r) => r.win).length;
  const lossesAfterCost = netRows.length - winsAfterCost;
  const avgNet =
    netRows.length > 0
      ? netRows.reduce((a, b) => a + b.net, 0) / netRows.length
      : null;

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
