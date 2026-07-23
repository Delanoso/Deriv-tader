import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { analyzeSymbol, backtestSpikeStrategy } from "./analyzer.js";
import { DerivClient, SYMBOLS } from "./derivClient.js";
import {
  bootstrapFromHistory,
  horizonFor,
  resolvePendingSignals,
} from "./learning/evaluator.js";
import { evaluateKillRule } from "./learning/killRules.js";
import { SignalJournal } from "./learning/journal.js";
import { buildRegime, ageRegimeFromRatio } from "./learning/regimes.js";
import { passSpikeEntryGate, paperLearnMax } from "./learning/entryGate.js";
import {
  evaluateEntryPolicy,
  predictorMode,
} from "./learning/entryPolicy.js";
import {
  confluenceEdgeBoost,
  evaluateConfluence,
  evaluatePlaybooksHistorically,
} from "./playbooks/confluence.js";
import { combineFocusWeight } from "./learning/focusWeights.js";
import {
  getGateTelemetry,
  recordGateAllow,
  recordGateReject,
} from "./learning/gateTelemetry.js";
import { scoreAgeRegime } from "./learning/regimePrefs.js";
import { emptySymbolRecord } from "./symbols.js";
import type {
  LearningSummary,
  MarketSnapshot,
  SymbolAnalysis,
  SymbolId,
} from "./types.js";
import {
  analyzeVol,
  bootstrapVolHistory,
  resolveVolPending,
} from "./vol/analyzer.js";
import { VolFeed } from "./vol/feed.js";
import { passVolEntryGate } from "./vol/entryGate.js";
import { VolJournal } from "./vol/journal.js";
import type {
  VolAnalysis,
  VolLearningSummary,
  VolSnapshot,
  VolSymbolId,
} from "./vol/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

const analyses: Record<SymbolId, SymbolAnalysis | null> = emptySymbolRecord(null);
const bootstrapped: Record<SymbolId, boolean> = emptySymbolRecord(false);

const journal = new SignalJournal();
const volJournal = new VolJournal();

let connected = false;
let statusDetail = "Booting";
let learning: LearningSummary = {
  ...journal.summarize(),
  gateTelemetry: getGateTelemetry(),
};

let volConnected = false;
let volStatusDetail = "Vol feed idle";
let volAnalysis: VolAnalysis | null = null;
let volLearning: VolLearningSummary = volJournal.summarize();
let volBootstrapped = false;

const DISCLAIMER =
  "Educational signal feedback only — not financial advice. Boom/Crash spikes are designed as stochastic events; volatility-index direction is research, not a guarantee.";

function buildVolSnapshot(): VolSnapshot {
  return {
    connected: volConnected,
    analysis: volAnalysis,
    learning: volLearning,
  };
}

function buildSnapshot(): MarketSnapshot {
  const symbols = {} as MarketSnapshot["symbols"];
  for (const id of SYMBOLS) {
    if (analyses[id]) symbols[id] = analyses[id]!;
  }
  return {
    connected,
    symbols,
    learning,
    vol: buildVolSnapshot(),
    disclaimer: DISCLAIMER,
  };
}

function refreshLearning(): void {
  learning = {
    ...journal.summarize(),
    gateTelemetry: getGateTelemetry(),
  };
}

function refreshVolLearning(): void {
  volLearning = volJournal.summarize();
}

function processSymbol(symbol: SymbolId): void {
  const ticks = client.getTicks(symbol);
  if (!ticks.length) return;

  // Resolve older pending signals first so calibration stays fresh.
  resolvePendingSignals(journal, symbol, ticks);

  if (!bootstrapped[symbol] && ticks.length >= 800) {
    const n = bootstrapFromHistory(journal, symbol, ticks);
    bootstrapped[symbol] = true;
    if (n > 0) {
      console.log(`Bootstrapped ${n} historical journal signals for ${symbol}`);
    }
  }

  refreshLearning();
  const spikeStats = learning.live.bySymbol[symbol]?.byKind.spike_watch;
  const killRaw = evaluateKillRule(spikeStats);
  // Symbol-level kill is too blunt once we have pocket-level policy.
  // Predictor mode: warning only — entryPolicy decides allow/deny.
  // Learn-max: warning only. Strict kill only when both modes off.
  const softKill = predictorMode() || paperLearnMax();
  const kill = softKill
    ? { ...killRaw, killed: false, warning: killRaw.killed || killRaw.warning }
    : killRaw;

  const liveRegs = learning.regimes?.[symbol];
  const seedRegs = learning.seedRegimes?.[symbol];
  const prev = analyses[symbol];
  const since = prev?.ticksSinceLastSpike ?? null;
  const meanGap = prev?.reliability.meanInterSpikeTicks ?? null;
  const ageRatio =
    meanGap != null && meanGap > 0 && since != null ? since / meanGap : null;
  const age = ageRegimeFromRatio(ageRatio);
  const regimePref = scoreAgeRegime(age, liveRegs, seedRegs);
  const symbolFocus = learning.focus?.bySymbol?.[symbol];
  const ageFocus = learning.focus?.byAgeRegime?.[symbol]?.[age];
  const combinedFocus = combineFocusWeight(symbolFocus, ageFocus);

  // Provisional RSI from previous analysis; analyzer will recompute.
  const rsi14 = prev?.indicators.rsi14 ?? null;
  const p500 =
    prev?.forecast?.horizons.find((h) => h.horizonTicks === 500)?.probability ??
    null;
  const confluence = evaluateConfluence(symbol, ticks);
  const confBoost = confluenceEdgeBoost(confluence);
  const entryPolicy = evaluateEntryPolicy({
    symbol,
    ageRatio,
    rsi14,
    pSpike500: p500,
    learning,
    confluenceBoost: confBoost.boost,
    confluenceReasons: confBoost.reasons,
  });

  const confView = {
    count: confluence.count,
    score: confluence.score,
    labels: confluence.labels,
    shelfPrice: confluence.shelfPrice,
    hits: confluence.hits.map((h) => ({
      id: h.id,
      label: h.label,
      score: h.score,
      detail: h.detail,
      shelfPrice: h.shelfPrice,
    })),
  };

  const analysis = analyzeSymbol(
    symbol,
    ticks,
    learning.calibrated,
    kill,
    regimePref,
    {
      levelHint: (learning.levelHints?.[symbol] as import("./learning/levelTune.js").LevelHint | undefined) ?? null,
      focusWeight: combinedFocus.weight,
      focusNote: combinedFocus.note,
      entryPolicy,
      confluence: confView,
    },
  );
  // Re-evaluate policy with fresh RSI / forecast from this analysis.
  const freshAgeRatio =
    analysis.reliability.meanInterSpikeTicks != null &&
    analysis.reliability.meanInterSpikeTicks > 0 &&
    analysis.ticksSinceLastSpike != null
      ? analysis.ticksSinceLastSpike / analysis.reliability.meanInterSpikeTicks
      : null;
  const freshPolicy = evaluateEntryPolicy({
    symbol,
    ageRatio: freshAgeRatio,
    rsi14: analysis.indicators.rsi14,
    pSpike500:
      analysis.forecast?.horizons.find((h) => h.horizonTicks === 500)
        ?.probability ?? null,
    learning,
    confluenceBoost: confBoost.boost,
    confluenceReasons: confBoost.reasons,
  });
  // If policy flipped after fresh indicators, re-score once.
  if (freshPolicy.allow !== entryPolicy.allow || freshPolicy.edgeScore !== entryPolicy.edgeScore) {
    analyses[symbol] = analyzeSymbol(
      symbol,
      ticks,
      learning.calibrated,
      kill,
      regimePref,
      {
        levelHint: (learning.levelHints?.[symbol] as import("./learning/levelTune.js").LevelHint | undefined) ?? null,
        focusWeight: combinedFocus.weight,
        focusNote: combinedFocus.note,
        entryPolicy: freshPolicy,
        confluence: confView,
      },
    );
  } else {
    analyses[symbol] = analysis;
  }

  const final = analyses[symbol]!;
  const opp = final.opportunity;
  // Journal only real predictor hunts (policy-allowed spike_watch).
  if (
    opp.kind === "spike_watch" &&
    final.lastQuote != null &&
    final.lastEpoch != null
  ) {
    const gate = passSpikeEntryGate(final, {
      liveRegimes: liveRegs,
      seedRegimes: seedRegs,
      symbolFocus,
      ageFocus,
    });
    if (gate.allow) {
      const row = journal.maybeRecordLive({
        symbol,
        kind: "spike_watch",
        bias: opp.bias,
        confidence: opp.calibratedConfidence ?? opp.confidence,
        entryPrice: final.lastQuote,
        entryEpoch: final.lastEpoch,
        entryTickIndex: Math.max(0, ticks.length - 1),
        horizonTicks: horizonFor(
          "spike_watch",
          final.reliability.meanInterSpikeTicks,
        ),
        target: final.spikePlan?.spikeTarget,
        stretch: final.spikePlan?.stretch,
        invalidation: final.spikePlan?.invalidation,
        regime: buildRegime(final),
      });
      if (row) recordGateAllow();
      refreshLearning();
    } else {
      recordGateReject(gate.reasons, symbol);
    }
  }

  broadcast({ type: "snapshot", data: buildSnapshot() });
  broadcast({ type: "learning", data: learning });
}

function processVol(symbol: VolSymbolId): void {
  const ticks = volFeed.getTicks(symbol);
  if (!ticks.length) return;

  resolveVolPending(volJournal.getPending(), ticks, (id, patch) =>
    volJournal.update(id, patch),
  );

  if (!volBootstrapped && ticks.length >= 900) {
    const rows = bootstrapVolHistory(symbol, ticks);
    const n = volJournal.addBootstrap(rows);
    volBootstrapped = true;
    if (n > 0) {
      console.log(`Bootstrapped ${n} Vol journal signals for ${symbol}`);
    }
  }

  refreshVolLearning();
  const focusBias = {
    up: volLearning.focus?.byBias?.up
      ? {
          n: volLearning.focus.byBias.up.n,
          expectancyNetPct: volLearning.focus.byBias.up.expectancyNetPct,
          deprioritize: volLearning.focus.byBias.up.deprioritize,
        }
      : undefined,
    down: volLearning.focus?.byBias?.down
      ? {
          n: volLearning.focus.byBias.down.n,
          expectancyNetPct: volLearning.focus.byBias.down.expectancyNetPct,
          deprioritize: volLearning.focus.byBias.down.deprioritize,
        }
      : undefined,
  };
  const analysis = analyzeVol(
    symbol,
    ticks,
    volLearning.calibrated,
    focusBias,
  );
  volAnalysis = analysis;

  const pred = analysis.prediction;
  const gate = passVolEntryGate(analysis, volLearning);
  if (
    gate.allow &&
    (pred.bias === "up" || pred.bias === "down") &&
    analysis.lastQuote != null &&
    analysis.lastEpoch != null
  ) {
    volJournal.maybeRecordLive({
      symbol,
      bias: pred.bias,
      confidence: pred.calibratedConfidence ?? pred.confidence,
      entryPrice: analysis.lastQuote,
      entryEpoch: analysis.lastEpoch,
      entryTickIndex: Math.max(0, ticks.length - 1),
      target: pred.targets.target,
      stretch: pred.targets.stretch,
      invalidation: pred.targets.invalidation,
      horizonTicks: pred.horizonTicks,
    });
    refreshVolLearning();
  }

  broadcast({ type: "snapshot", data: buildSnapshot() });
  broadcast({ type: "vol", data: buildVolSnapshot() });
  broadcast({ type: "vol_learning", data: volLearning });
}

const client = new DerivClient(
  (symbol) => {
    processSymbol(symbol);
  },
  (isConnected, detail) => {
    connected = isConnected;
    statusDetail = detail || (isConnected ? "Connected" : "Disconnected");
    broadcast({
      type: "status",
      data: { connected, detail: statusDetail },
    });
  },
);

const volFeed = new VolFeed(
  (symbol) => {
    processVol(symbol);
  },
  (isConnected, detail) => {
    volConnected = isConnected;
    volStatusDetail = detail || (isConnected ? "Vol live" : "Vol offline");
    broadcast({
      type: "vol_status",
      data: { connected: volConnected, detail: volStatusDetail },
    });
  },
);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    connected,
    statusDetail,
    volConnected,
    volStatusDetail,
  });
});

app.get("/api/snapshot", (_req, res) => {
  res.json(buildSnapshot());
});

app.get("/api/learning", (_req, res) => {
  refreshLearning();
  res.json(learning);
});

app.get("/api/learning/signals", (req, res) => {
  const symbol = req.query.symbol as SymbolId | undefined;
  const status = req.query.status as string | undefined;
  let rows = journal.getSignals();
  if (symbol) rows = rows.filter((s) => s.symbol === symbol);
  if (status) rows = rows.filter((s) => s.status === status);
  res.json({ signals: rows.slice(-200).reverse() });
});

app.get("/api/vol", (_req, res) => {
  refreshVolLearning();
  res.json(buildVolSnapshot());
});

app.get("/api/vol/learning", (_req, res) => {
  refreshVolLearning();
  res.json(volLearning);
});

app.get("/api/vol/signals", (req, res) => {
  const status = req.query.status as string | undefined;
  let rows = volJournal.getSignals();
  if (status) rows = rows.filter((s) => s.status === status);
  res.json({ signals: rows.slice(-200).reverse() });
});

app.get("/api/backtest/:symbol", (req, res) => {
  const symbol = req.params.symbol as SymbolId;
  if (!SYMBOLS.includes(symbol)) {
    res.status(400).json({ error: "Unknown symbol" });
    return;
  }
  const ticks = client.getTicks(symbol);
  const result = backtestSpikeStrategy(symbol, ticks);
  res.json({ symbol, ...result, ticksUsed: ticks.length });
});

/** Historical lift test for S/R · EMA cross · order-block playbooks. */
app.get("/api/playbooks", (_req, res) => {
  const bySymbol: Record<string, unknown> = {};
  for (const symbol of SYMBOLS) {
    const ticks = client.getTicks(symbol);
    const live = evaluateConfluence(symbol, ticks);
    const historical = evaluatePlaybooksHistorically(symbol, ticks);
    bySymbol[symbol] = {
      live,
      historical,
      ticksUsed: ticks.length,
    };
  }
  res.json({
    note: "Measured on live tick history: these playbooks are display-only by default (they do not change entries). Includes the user-observed spike-base retest / micro-spike cluster pattern. Set PLAYBOOK_EDGE_BOOST=1 to experiment.",
    bySymbol,
  });
});

app.get("/api/playbooks/:symbol", (req, res) => {
  const symbol = req.params.symbol as SymbolId;
  if (!SYMBOLS.includes(symbol)) {
    res.status(400).json({ error: "Unknown symbol" });
    return;
  }
  const ticks = client.getTicks(symbol);
  res.json({
    symbol,
    live: evaluateConfluence(symbol, ticks),
    historical: evaluatePlaybooksHistorically(symbol, ticks),
    ticksUsed: ticks.length,
  });
});

const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(message: unknown): void {
  const raw = JSON.stringify(message);
  for (const socket of wss.clients) {
    if (socket.readyState === 1) socket.send(raw);
  }
}

wss.on("connection", (socket) => {
  refreshLearning();
  refreshVolLearning();
  socket.send(
    JSON.stringify({
      type: "snapshot",
      data: buildSnapshot(),
    }),
  );
  socket.send(
    JSON.stringify({
      type: "status",
      data: { connected, detail: statusDetail },
    }),
  );
  socket.send(
    JSON.stringify({
      type: "learning",
      data: learning,
    }),
  );
  socket.send(
    JSON.stringify({
      type: "vol",
      data: buildVolSnapshot(),
    }),
  );
  socket.send(
    JSON.stringify({
      type: "vol_status",
      data: { connected: volConnected, detail: volStatusDetail },
    }),
  );
  socket.send(
    JSON.stringify({
      type: "vol_learning",
      data: volLearning,
    }),
  );
});

server.listen(PORT, () => {
  console.log(`SpikeScope listening on http://localhost:${PORT}`);
  client.start();
  volFeed.start();
});

process.on("SIGINT", () => {
  client.stop();
  volFeed.stop();
  server.close();
  process.exit(0);
});
