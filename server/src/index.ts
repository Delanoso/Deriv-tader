import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { analyzeSymbol, backtestDriftStrategy } from "./analyzer.js";
import { DerivClient, SYMBOLS } from "./derivClient.js";
import type { MarketSnapshot, SymbolAnalysis, SymbolId } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

const analyses: Record<SymbolId, SymbolAnalysis | null> = {
  BOOM1000: null,
  CRASH1000: null,
};

let connected = false;
let statusDetail = "Booting";

const DISCLAIMER =
  "Educational signal feedback only — not financial advice. Boom/Crash spikes are designed as stochastic events; no model can reliably predict the next spike.";

function buildSnapshot(): MarketSnapshot {
  const symbols = {} as MarketSnapshot["symbols"];
  for (const id of SYMBOLS) {
    if (analyses[id]) symbols[id] = analyses[id]!;
  }
  return { connected, symbols, disclaimer: DISCLAIMER };
}

const client = new DerivClient(
  (symbol, ticks) => {
    analyses[symbol] = analyzeSymbol(symbol, ticks);
    broadcast({ type: "snapshot", data: buildSnapshot() });
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

app.get("/api/backtest/:symbol", (req, res) => {
  const symbol = req.params.symbol as SymbolId;
  if (!SYMBOLS.includes(symbol)) {
    res.status(400).json({ error: "Unknown symbol" });
    return;
  }
  const ticks = client.getTicks(symbol);
  const result = backtestDriftStrategy(symbol, ticks);
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
