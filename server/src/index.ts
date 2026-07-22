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
import type {
  LearningSummary,
  MarketSnapshot,
  SymbolAnalysis,
  SymbolId,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

const analyses: Record<SymbolId, SymbolAnalysis | null> = {
  BOOM1000: null,
  CRASH1000: null,
};

const bootstrapped: Record<SymbolId, boolean> = {
  BOOM1000: false,
  CRASH1000: false,
};

const journal = new SignalJournal();

let connected = false;
let statusDetail = "Booting";
let learning: LearningSummary = journal.summarize();

const DISCLAIMER =
  "Educational signal feedback only — not financial advice. Boom/Crash spikes are designed as stochastic events; no model can reliably predict the next spike.";

function buildSnapshot(): MarketSnapshot {
  const symbols = {} as MarketSnapshot["symbols"];
  for (const id of SYMBOLS) {
    if (analyses[id]) symbols[id] = analyses[id]!;
  }
  return { connected, symbols, learning, disclaimer: DISCLAIMER };
}

function refreshLearning(): void {
  learning = journal.summarize();
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
  const kill = evaluateKillRule(spikeStats);
  const analysis = analyzeSymbol(symbol, ticks, learning.calibrated, kill);
  analyses[symbol] = analysis;

  const opp = analysis.opportunity;
  // Journal spike hunts only — quiet drift is not the target.
  if (
    opp.kind === "spike_watch" &&
    analysis.lastQuote != null &&
    analysis.lastEpoch != null
  ) {
    journal.maybeRecordLive({
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
    });
    refreshLearning();
  }

  broadcast({ type: "snapshot", data: buildSnapshot() });
  broadcast({ type: "learning", data: learning });
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

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, connected, statusDetail });
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
});

server.listen(PORT, () => {
  console.log(`Boom/Crash predictor listening on http://localhost:${PORT}`);
  client.start();
});

process.on("SIGINT", () => {
  client.stop();
  server.close();
  process.exit(0);
});
