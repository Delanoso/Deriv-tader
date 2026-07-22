import { detectSpikes } from "../spikeDetector.js";
import type {
  JournalSignal,
  OpportunityKind,
  SymbolId,
  Tick,
} from "../types.js";
import { SignalJournal } from "./journal.js";
import { analyzeSymbol } from "../analyzer.js";

type TradeKind = Exclude<OpportunityKind, "stand_aside">;

const DEFAULT_HORIZON: Record<TradeKind, number> = {
  drift_follow: 40,
  post_spike: 35,
  spike_watch: 1200,
};

/**
 * Resolve pending journal signals against the latest tick buffer.
 */
export function resolvePendingSignals(
  journal: SignalJournal,
  symbol: SymbolId,
  ticks: Tick[],
): number {
  if (ticks.length < 10) return 0;
  const spikes = detectSpikes(symbol, ticks);
  const spikeEpochs = new Set(spikes.map((s) => s.epoch));
  let resolved = 0;

  for (const signal of journal.getPending(symbol)) {
    const entryIdx = findTickIndex(ticks, signal.entryEpoch, signal.entryTickIndex);
    if (entryIdx < 0) continue;

    const horizonEnd = Math.min(ticks.length - 1, entryIdx + signal.horizonTicks);
    const elapsed = ticks.length - 1 - entryIdx;
    if (elapsed < 5) continue; // need a little path

    if (signal.kind === "spike_watch") {
      const hit = spikes.some(
        (sp) => sp.index > entryIdx && sp.index <= horizonEnd,
      );
      if (hit) {
        const spike = spikes.find((sp) => sp.index > entryIdx && sp.index <= horizonEnd)!;
        journal.updateSignal(signal.id, {
          status: "win",
          resolvedAt: Date.now(),
          exitPrice: spike.quote,
          exitEpoch: spike.epoch,
          returnPct: pctReturn(signal.bias, signal.entryPrice, spike.quote),
          note: "Spike printed inside watch horizon",
        });
        resolved += 1;
      } else if (elapsed >= signal.horizonTicks) {
        const exit = ticks[horizonEnd];
        journal.updateSignal(signal.id, {
          status: "loss",
          resolvedAt: Date.now(),
          exitPrice: exit.quote,
          exitEpoch: exit.epoch,
          returnPct: pctReturn(signal.bias, signal.entryPrice, exit.quote),
          note: "No spike before watch horizon expired",
        });
        resolved += 1;
      }
      continue;
    }

    // drift_follow / post_spike: directional hold, cut early on adverse spike
    const adverseSpike = spikes.find(
      (sp) => sp.index > entryIdx && sp.index <= horizonEnd,
    );
    const exitIdx = adverseSpike
      ? Math.min(adverseSpike.index, horizonEnd)
      : elapsed >= signal.horizonTicks
        ? horizonEnd
        : -1;

    if (exitIdx < 0) continue;
    const exit = ticks[exitIdx];
    const ret = pctReturn(signal.bias, signal.entryPrice, exit.quote);
    const wipedBySpike =
      adverseSpike != null && spikeEpochs.has(adverseSpike.epoch) && ret <= 0;

    journal.updateSignal(signal.id, {
      status: ret > 0 ? "win" : "loss",
      resolvedAt: Date.now(),
      exitPrice: exit.quote,
      exitEpoch: exit.epoch,
      returnPct: ret,
      note: wipedBySpike
        ? "Cut by spike against the drift bias"
        : ret > 0
          ? "Drift moved with bias"
          : "Drift moved against bias",
    });
    resolved += 1;
  }

  return resolved;
}

/**
 * One-time (or sparse) historical walk so the journal is not empty on day one.
 */
export function bootstrapFromHistory(
  journal: SignalJournal,
  symbol: SymbolId,
  ticks: Tick[],
  maxSignals = 80,
): number {
  const existing = journal
    .getSignals()
    .filter((s) => s.symbol === symbol && s.source === "bootstrap").length;
  if (existing >= 20) return 0;
  if (ticks.length < 800) return 0;

  const step = 60;
  const created: JournalSignal[] = [];
  let lastKind: string | null = null;

  for (let i = 400; i < ticks.length - 80 && created.length < maxSignals; i += step) {
    const window = ticks.slice(0, i + 1);
    const analysis = analyzeSymbol(symbol, window);
    const opp = analysis.opportunity;
    if (opp.kind === "stand_aside") continue;
    if (opp.kind === lastKind) continue;
    lastKind = opp.kind;

    const horizon = DEFAULT_HORIZON[opp.kind];
    const entryIdx = window.length - 1;
    const exitIdx = Math.min(ticks.length - 1, entryIdx + horizon);

    // Resolve immediately against future ticks in the full buffer
    const future = ticks;
    const spikes = detectSpikes(symbol, future);
    let status: JournalSignal["status"] = "loss";
    let exitPrice = future[exitIdx].quote;
    let exitEpoch = future[exitIdx].epoch;
    let note = "";

    if (opp.kind === "spike_watch") {
      const spike = spikes.find((sp) => sp.index > entryIdx && sp.index <= exitIdx);
      if (spike) {
        status = "win";
        exitPrice = spike.quote;
        exitEpoch = spike.epoch;
        note = "Bootstrap: spike inside horizon";
      } else {
        status = "loss";
        note = "Bootstrap: no spike in horizon";
      }
    } else {
      const spike = spikes.find((sp) => sp.index > entryIdx && sp.index <= exitIdx);
      const end = spike ? spike.index : exitIdx;
      exitPrice = future[end].quote;
      exitEpoch = future[end].epoch;
      const ret = pctReturn(opp.bias, window[entryIdx].quote, exitPrice);
      status = ret > 0 ? "win" : "loss";
      note = spike
        ? "Bootstrap: exited at/near spike"
        : "Bootstrap: held to horizon";
    }

    created.push({
      id: `boot-${symbol}-${window[entryIdx].epoch}-${created.length}`,
      symbol,
      kind: opp.kind,
      bias: opp.bias,
      confidence: opp.confidence,
      entryPrice: window[entryIdx].quote,
      entryEpoch: window[entryIdx].epoch,
      entryTickIndex: entryIdx,
      horizonTicks: horizon,
      createdAt: Date.now(),
      status,
      resolvedAt: Date.now(),
      exitPrice,
      exitEpoch,
      returnPct: pctReturn(opp.bias, window[entryIdx].quote, exitPrice),
      note,
      source: "bootstrap",
    });
  }

  return journal.addBootstrap(created);
}

export function horizonFor(
  kind: TradeKind,
  meanInterSpike: number | null,
): number {
  if (kind === "spike_watch") {
    return Math.max(600, Math.round((meanInterSpike ?? 2000) * 0.75));
  }
  return DEFAULT_HORIZON[kind];
}

function findTickIndex(ticks: Tick[], epoch: number, hint: number): number {
  if (hint >= 0 && hint < ticks.length && ticks[hint].epoch === epoch) return hint;
  // search near end first
  for (let i = ticks.length - 1; i >= Math.max(0, ticks.length - 5000); i--) {
    if (ticks[i].epoch === epoch) return i;
  }
  // nearest epoch
  let best = -1;
  let bestDist = Infinity;
  for (let i = ticks.length - 1; i >= Math.max(0, ticks.length - 5000); i--) {
    const d = Math.abs(ticks[i].epoch - epoch);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return bestDist <= 2 ? best : -1;
}

function pctReturn(
  bias: JournalSignal["bias"],
  entry: number,
  exit: number,
): number {
  if (!entry) return 0;
  const raw = (exit - entry) / entry;
  const signed = bias === "bearish" ? -raw : bias === "bullish" ? raw : 0;
  return Number((signed * 100).toFixed(5));
}
