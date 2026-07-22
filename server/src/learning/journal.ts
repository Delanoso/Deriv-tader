import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Bias,
  JournalSignal,
  KindStats,
  LearningSummary,
  OpportunityKind,
  SymbolId,
} from "../types.js";

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

export class SignalJournal {
  private store: JournalFile;
  /** Cooldown: last live signal fingerprint per symbol */
  private lastLiveKey: Partial<Record<SymbolId, string>> = {};
  private lastLiveAt: Partial<Record<SymbolId, number>> = {};

  constructor() {
    this.store = ensureStore();
  }

  getSignals(): JournalSignal[] {
    return this.store.signals;
  }

  getPending(symbol?: SymbolId): JournalSignal[] {
    return this.store.signals.filter(
      (s) => s.status === "pending" && (symbol == null || s.symbol === symbol),
    );
  }

  /**
   * Record a live signal when kind/bias changes, or confidence moves enough,
   * with a cooldown so polling does not spam the journal.
   */
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
    // Also skip if an identical pending signal already exists recently
    const recentDup = this.store.signals.find(
      (s) =>
        s.symbol === input.symbol &&
        s.status === "pending" &&
        s.kind === input.kind &&
        s.bias === input.bias &&
        Math.abs(s.entryEpoch - input.entryEpoch) < 90,
    );
    if (recentDup) return null;

    // One open live signal per symbol/kind at a time
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
    this.store.signals.push(...signals);
    this.trim();
    persist(this.store);
    return signals.length;
  }

  updateSignal(id: string, patch: Partial<JournalSignal>): void {
    const idx = this.store.signals.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.store.signals[idx] = { ...this.store.signals[idx], ...patch };
    persist(this.store);
  }

  /** Keep journal bounded. */
  private trim(max = 5000): void {
    if (this.store.signals.length <= max) return;
    this.store.signals = this.store.signals.slice(-max);
  }

  summarize(): LearningSummary {
    const symbols: SymbolId[] = ["BOOM1000", "CRASH1000"];
    const bySymbol = {} as LearningSummary["bySymbol"];
    const calibrated: LearningSummary["calibrated"] = {};

    for (const symbol of symbols) {
      const subset = this.store.signals.filter((s) => s.symbol === symbol);
      const kinds: TradeKind[] = ["drift_follow", "spike_watch", "post_spike"];
      const byKind: LearningSummary["bySymbol"][SymbolId]["byKind"] = {};
      for (const kind of kinds) {
        byKind[kind] = statsFor(subset.filter((s) => s.kind === kind), kind);
      }
      const overall = statsFor(subset, "all");
      bySymbol[symbol] = { overall, byKind };

      calibrated[symbol] = {};
      for (const kind of kinds) {
        const st = byKind[kind]!;
        if (st.winRate != null && st.wins + st.losses >= 8) {
          // Mild shrinkage toward 0.5 so small samples do not dominate.
          const n = st.wins + st.losses;
          const shrink = n / (n + 12);
          calibrated[symbol]![kind] = Number(
            (0.5 * (1 - shrink) + st.winRate * shrink).toFixed(3),
          );
        }
      }
    }

    const resolved = this.store.signals.filter((s) => s.status === "win" || s.status === "loss");
    const wins = resolved.filter((s) => s.status === "win").length;

    return {
      totalSignals: this.store.signals.length,
      pending: this.store.signals.filter((s) => s.status === "pending").length,
      resolved: resolved.length,
      overallWinRate: resolved.length
        ? Number((wins / resolved.length).toFixed(3))
        : null,
      bySymbol,
      recent: [...this.store.signals].slice(-12).reverse(),
      calibrated,
      updatedAt: Date.now(),
    };
  }
}

function statsFor(signals: JournalSignal[], kind: KindStats["kind"]): KindStats {
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

  return {
    kind,
    total: signals.length,
    wins: wins.length,
    losses: losses.length,
    pending,
    winRate: decided ? Number((wins.length / decided).toFixed(3)) : null,
    avgReturnPct: avg != null ? Number(avg.toFixed(4)) : null,
  };
}

export function blendConfidence(
  base: number,
  learned: number | undefined,
  minSamplesMet: boolean,
): number {
  if (!minSamplesMet || learned == null) return base;
  // Pull toward empirical rate without erasing the model prior.
  const blended = base * 0.55 + learned * 0.45;
  return Number(Math.max(0.12, Math.min(0.72, blended)).toFixed(2));
}
