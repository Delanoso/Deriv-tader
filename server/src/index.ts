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
  // Learn-max: keep kill as a soft warning so paper hunts still journal.
  const kill = paperLearnMax()
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

  const analysis = analyzeSymbol(
    symbol,
    ticks,
    learning.calibrated,
    kill,
    regimePref,
    {
      levelHint: learning.levelHints?.[symbol] ?? null,
      focusWeight: combinedFocus.weight,
      focusNote: combinedFocus.note,
    },
  );
  analyses[symbol] = analysis;

  const opp = analysis.opportunity;
  // Journal spike hunts only when entry gate passes — quality over quantity.
  if (
    opp.kind === "spike_watch" &&
    analysis.lastQuote != null &&
    analysis.lastEpoch != null
  ) {
    const gate = passSpikeEntryGate(analysis, {
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
        entryPrice: analysis.lastQuote,
        entryEpoch: analysis.lastEpoch,
        entryTickIndex: Math.max(0, ticks.length - 1),
        horizonTicks: horizonFor(
          "spike_watch",
          analysis.reliability.meanInterSpikeTicks,
        ),
        target: analysis.spikePlan?.spikeTarget,
        stretch: analysis.spikePlan?.stretch,
        invalidation: analysis.spikePlan?.invalidation,
        regime: buildRegime(analysis),
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
  const analysis = analyzeVol(symbol, ticks, volLearning.calibrated);
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
