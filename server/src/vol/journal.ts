import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  VolBias,
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
    avgMfePct: null,
    avgMaePct: null,
    targetHitRate: null,
  };
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
    if (this.lastKey === key && now - this.lastAt < 120_000) return null;
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
    this.store.signals.push(...rows);
    this.trim();
    persist(this.store);
    return rows.length;
  }

  update(id: string, patch: Partial<VolJournalSignal>): void {
    const i = this.store.signals.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.store.signals[i] = { ...this.store.signals[i], ...patch };
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

    return {
      totalSignals: all.length,
      pending: all.filter((s) => s.status === "pending").length,
      resolved: decided.length,
      overallWinRate: decided.length ? Number((wins / decided.length).toFixed(3)) : null,
      targetHitRate: decided.length ? Number((targetHits / decided.length).toFixed(3)) : null,
      byBias: { up, down },
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
  const decided = [...wins, ...losses];
  const avg = (vals: number[]) =>
    vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const rets = decided.map((s) => s.returnPct).filter((v): v is number => v != null);
  const mfes = decided.map((s) => s.mfePct).filter((v): v is number => v != null);
  const maes = decided.map((s) => s.maePct).filter((v): v is number => v != null);
  const targetHits = decided.filter((s) => s.hitTarget).length;

  return {
    total: rows.length,
    wins: wins.length,
    losses: losses.length,
    pending,
    winRate: decided.length ? Number((wins.length / decided.length).toFixed(3)) : null,
    avgReturnPct: avg(rets) != null ? Number(avg(rets)!.toFixed(4)) : null,
    avgMfePct: avg(mfes) != null ? Number(avg(mfes)!.toFixed(4)) : null,
    avgMaePct: avg(maes) != null ? Number(avg(maes)!.toFixed(4)) : null,
    targetHitRate: decided.length
      ? Number((targetHits / decided.length).toFixed(3))
      : null,
  };
}

export function blendVolConfidence(base: number, learned?: number): number {
  if (learned == null) return base;
  return Number(Math.max(0.12, Math.min(0.75, base * 0.55 + learned * 0.45)).toFixed(2));
}
