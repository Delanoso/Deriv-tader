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
  post_spike: 25,
  spike_watch: 1500,
};

/**
 * Resolve pending journal signals against the latest tick buffer.
 * Wins: spike print or target touch. Losses: invalidation (stopout) or horizon expiry.
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
      const path = resolveSpikeHuntPath(signal, ticks, entryIdx, horizonEnd, spikes);
      if (!path) continue;
      journal.updateSignal(signal.id, path);
      resolved += 1;
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
      outcome: wipedBySpike ? "stopout" : ret > 0 ? "target" : "expired",
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

function resolveSpikeHuntPath(
  signal: JournalSignal,
  ticks: Tick[],
  entryIdx: number,
  horizonEnd: number,
  spikes: { index: number; epoch: number; quote: number }[],
): Partial<JournalSignal> | null {
  const bullish = signal.bias === "bullish";
  let hitTarget = false;
  let hitInvalidation = false;
  let hitSpike = false;
  let exitIdx = -1;

  for (let i = entryIdx + 1; i <= horizonEnd; i++) {
    const px = ticks[i].quote;

    if (signal.invalidation != null) {
      const stopped = bullish
        ? px <= signal.invalidation
        : px >= signal.invalidation;
      if (stopped) {
        hitInvalidation = true;
        exitIdx = i;
        break;
      }
    }

    if (signal.target != null) {
      const reached = bullish ? px >= signal.target : px <= signal.target;
      if (reached) {
        hitTarget = true;
        exitIdx = i;
        break;
      }
    }

    const spike = spikes.find((sp) => sp.index === i);
    if (spike) {
      hitSpike = true;
      exitIdx = i;
      break;
    }
  }

  const elapsed = ticks.length - 1 - entryIdx;
  if (exitIdx < 0) {
    if (elapsed < signal.horizonTicks) return null;
    exitIdx = horizonEnd;
  }

  const exit = ticks[exitIdx];
  const ret = pctReturn(signal.bias, signal.entryPrice, exit.quote);

  if (hitInvalidation) {
    return {
      status: "loss",
      resolvedAt: Date.now(),
      exitPrice: exit.quote,
      exitEpoch: exit.epoch,
      returnPct: ret,
      hitTarget: false,
      hitInvalidation: true,
      outcome: "stopout",
      note: "Stopout — invalidation printed before spike/target",
    };
  }

  if (hitTarget || hitSpike) {
    return {
      status: "win",
      resolvedAt: Date.now(),
      exitPrice: exit.quote,
      exitEpoch: exit.epoch,
      returnPct: ret,
      hitTarget: hitTarget || undefined,
      hitInvalidation: false,
      outcome: hitSpike ? "spike" : "target",
      note: hitSpike
        ? "Spike printed inside watch horizon"
        : "Hit spike target before invalidation",
    };
  }

  return {
    status: "loss",
    resolvedAt: Date.now(),
    exitPrice: exit.quote,
    exitEpoch: exit.epoch,
    returnPct: ret,
    hitTarget: false,
    hitInvalidation: false,
    outcome: "expired",
    note: "No spike/target before watch horizon expired",
  };
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
    // Spike-hunt only — skip legacy drift/post-spike seeds.
    if (opp.kind !== "spike_watch") continue;
    if (opp.kind === lastKind) continue;
    lastKind = opp.kind;

    const horizon = DEFAULT_HORIZON[opp.kind];
    const entryIdx = window.length - 1;
    const exitHorizon = Math.min(ticks.length - 1, entryIdx + horizon);
    const plan = analysis.spikePlan;
    const draft: JournalSignal = {
      id: `boot-${symbol}-${window[entryIdx].epoch}-${created.length}`,
      symbol,
      kind: opp.kind,
      bias: opp.bias,
      confidence: opp.confidence,
      entryPrice: window[entryIdx].quote,
      entryEpoch: window[entryIdx].epoch,
      entryTickIndex: entryIdx,
      horizonTicks: horizon,
      target: plan?.spikeTarget,
      stretch: plan?.stretch,
      invalidation: plan?.invalidation,
      createdAt: Date.now(),
      status: "pending",
      outcome: "open",
      source: "bootstrap",
    };

    const spikes = detectSpikes(symbol, ticks);
    const resolved = resolveSpikeHuntPath(
      draft,
      ticks,
      entryIdx,
      exitHorizon,
      spikes,
    );
    if (!resolved) continue;

    created.push({
      ...draft,
      ...resolved,
      status: resolved.status ?? "loss",
      source: "bootstrap",
      note: resolved.note ? `Bootstrap: ${resolved.note}` : "bootstrap",
    } as JournalSignal);
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
