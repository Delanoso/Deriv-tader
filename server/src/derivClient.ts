import WebSocket from "ws";
import type { SymbolId, Tick } from "./types.js";

const DERIV_URL =
  process.env.DERIV_WS_URL ||
  "wss://ws.derivws.com/websockets/v3?app_id=1089";
const SYMBOLS: SymbolId[] = ["BOOM1000", "CRASH1000"];
const CHUNK = 5000;
const TARGET_TICKS = Number(process.env.DERIV_HISTORY_TICKS || 20000);
const POLL_MS = Number(process.env.DERIV_POLL_MS || 1000);

type TickHandler = (symbol: SymbolId, ticks: Tick[]) => void;
type StatusHandler = (connected: boolean, detail?: string) => void;

export class DerivClient {
  private ws: WebSocket | null = null;
  private ticks: Record<SymbolId, Tick[]> = {
    BOOM1000: [],
    CRASH1000: [],
  };
  private bootstrapDone: Record<SymbolId, boolean> = {
    BOOM1000: false,
    CRASH1000: false,
  };
  private pendingHistory: Record<
    SymbolId,
    { chunks: Tick[][]; nextEnd: number | "latest"; waiting: boolean }
  > = {
    BOOM1000: { chunks: [], nextEnd: "latest", waiting: false },
    CRASH1000: { chunks: [], nextEnd: "latest", waiting: false },
  };
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private reqId = 1;
  private onTicks: TickHandler;
  private onStatus: StatusHandler;
  private intentionalClose = false;
  private pollInFlight = false;
  /** req_id → purpose metadata */
  private reqMeta = new Map<number, { kind: "bootstrap" | "poll"; symbol: SymbolId }>();

  constructor(onTicks: TickHandler, onStatus: StatusHandler) {
    this.onTicks = onTicks;
    this.onStatus = onStatus;
  }

  getTicks(symbol: SymbolId): Tick[] {
    return this.ticks[symbol];
  }

  start(): void {
    this.intentionalClose = false;
    this.connect();
  }

  stop(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    this.onStatus(false, "Connecting to Deriv…");
    this.bootstrapDone = { BOOM1000: false, CRASH1000: false };
    this.pendingHistory = {
      BOOM1000: { chunks: [], nextEnd: "latest", waiting: false },
      CRASH1000: { chunks: [], nextEnd: "latest", waiting: false },
    };
    this.reqMeta.clear();
    const ws = new WebSocket(DERIV_URL);
    this.ws = ws;

    ws.on("open", () => {
      this.onStatus(true, "Connected — loading history");
      for (const symbol of SYMBOLS) this.requestHistoryChunk(symbol, "latest", "bootstrap");
      this.pingTimer = setInterval(() => this.send({ ping: 1 }), 30000);
    });

    ws.on("message", (raw) => {
      try {
        this.handleMessage(JSON.parse(raw.toString()));
      } catch {
        // ignore
      }
    });

    ws.on("close", () => {
      this.onStatus(false, "Disconnected");
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.pollTimer) clearInterval(this.pollTimer);
      if (!this.intentionalClose) {
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      }
    });

    ws.on("error", () => this.onStatus(false, "Socket error"));
  }

  private requestHistoryChunk(
    symbol: SymbolId,
    end: number | "latest",
    kind: "bootstrap" | "poll",
  ): void {
    const req_id = this.reqId++;
    this.reqMeta.set(req_id, { kind, symbol });
    if (kind === "bootstrap") this.pendingHistory[symbol].waiting = true;
    this.send({
      ticks_history: symbol,
      adjust_start_time: 1,
      count: kind === "poll" ? 80 : CHUNK,
      end,
      style: "ticks",
      req_id,
    });
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const req_id = (payload.req_id as number | undefined) ?? this.reqId++;
    this.ws.send(JSON.stringify({ ...payload, req_id }));
  }

  private startPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.onStatus(true, "Live (history poll)");
    this.pollTimer = setInterval(() => this.pollLatest(), POLL_MS);
  }

  private pollLatest(): void {
    if (this.pollInFlight) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.pollInFlight = true;
    for (const symbol of SYMBOLS) {
      this.requestHistoryChunk(symbol, "latest", "poll");
    }
    setTimeout(() => {
      this.pollInFlight = false;
    }, Math.max(200, POLL_MS - 100));
  }

  private mergeTicks(symbol: SymbolId, incoming: Tick[]): boolean {
    if (!incoming.length) return false;
    const existing = this.ticks[symbol];
    if (!existing.length) {
      this.ticks[symbol] = incoming.slice(-TARGET_TICKS);
      return true;
    }
    const lastEpoch = existing[existing.length - 1].epoch;
    const fresh = incoming.filter((t) => t.epoch > lastEpoch);
    if (!fresh.length) return false;
    this.ticks[symbol] = [...existing, ...fresh].slice(-TARGET_TICKS);
    return true;
  }

  private finalizeBootstrap(symbol: SymbolId): void {
    const chunks = this.pendingHistory[symbol].chunks;
    const merged = new Map<number, number>();
    for (const chunk of chunks) {
      for (const t of chunk) merged.set(t.epoch, t.quote);
    }
    const ordered = [...merged.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([epoch, quote]) => ({ epoch, quote }));
    this.ticks[symbol] = ordered.slice(-TARGET_TICKS);
    this.bootstrapDone[symbol] = true;
    this.pendingHistory[symbol].waiting = false;
    this.onTicks(symbol, this.ticks[symbol]);
    this.onStatus(
      true,
      `Loaded ${this.ticks[symbol].length} ticks for ${symbol}`,
    );
    if (SYMBOLS.every((s) => this.bootstrapDone[s])) {
      this.startPolling();
    }
  }

  private handleBootstrapChunk(symbol: SymbolId, loaded: Tick[]): void {
    const state = this.pendingHistory[symbol];
    state.waiting = false;
    if (!loaded.length) {
      this.finalizeBootstrap(symbol);
      return;
    }
    state.chunks.push(loaded);
    const total = state.chunks.reduce((n, c) => n + c.length, 0);
    const oldest = loaded[0].epoch;

    if (total >= TARGET_TICKS || loaded.length < CHUNK * 0.5) {
      this.finalizeBootstrap(symbol);
      return;
    }

    // Walk further back for another chunk.
    state.nextEnd = oldest - 1;
    this.onStatus(true, `Loading ${symbol} history… ${total}/${TARGET_TICKS}`);
    this.requestHistoryChunk(symbol, oldest - 1, "bootstrap");
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (msg.error) {
      const err = msg.error as { message?: string };
      const echo = msg.echo_req as { req_id?: number } | undefined;
      console.error("Deriv error:", err.message, echo);
      if (!SYMBOLS.every((s) => this.bootstrapDone[s])) {
        this.onStatus(false, err.message || "Deriv API error");
      }
      return;
    }

    if (msg.msg_type === "ping") return;

    if (msg.history && msg.echo_req) {
      const echo = msg.echo_req as { req_id?: number; ticks_history?: string };
      const meta = echo.req_id != null ? this.reqMeta.get(echo.req_id) : undefined;
      const symbol = (meta?.symbol || echo.ticks_history) as SymbolId | undefined;
      const history = msg.history as { prices?: number[]; times?: number[] };
      if (!symbol || !SYMBOLS.includes(symbol) || !history.prices || !history.times) {
        return;
      }

      const loaded: Tick[] = history.times.map((epoch, i) => ({
        epoch,
        quote: history.prices![i],
      }));

      const kind = meta?.kind || (this.bootstrapDone[symbol] ? "poll" : "bootstrap");
      if (echo.req_id != null) this.reqMeta.delete(echo.req_id);

      if (kind === "bootstrap" && !this.bootstrapDone[symbol]) {
        this.handleBootstrapChunk(symbol, loaded);
        return;
      }

      if (this.mergeTicks(symbol, loaded)) {
        this.onTicks(symbol, this.ticks[symbol]);
      }
    }
  }
}

export { SYMBOLS };
