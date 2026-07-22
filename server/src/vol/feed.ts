import WebSocket from "ws";
import type { VolSymbolId, VolTick } from "./types.js";
import { VOL_SYMBOLS } from "./types.js";

const DERIV_URL =
  process.env.DERIV_WS_URL ||
  "wss://ws.derivws.com/websockets/v3?app_id=1089";
const CHUNK = 5000;
const TARGET = Number(process.env.VOL_HISTORY_TICKS || 15000);
const POLL_MS = Number(process.env.VOL_POLL_MS || 3000);

type TickHandler = (symbol: VolSymbolId, ticks: VolTick[]) => void;
type StatusHandler = (connected: boolean, detail?: string) => void;

export class VolFeed {
  private ws: WebSocket | null = null;
  private ticks: Record<VolSymbolId, VolTick[]> = { "1HZ250V": [] };
  private done: Record<VolSymbolId, boolean> = { "1HZ250V": false };
  private chunks: Record<VolSymbolId, VolTick[][]> = { "1HZ250V": [] };
  private reqMeta = new Map<number, { kind: "bootstrap" | "poll"; symbol: VolSymbolId }>();
  private reqId = 1;
  private pingTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private intentionalClose = false;
  private pollInFlight = false;

  constructor(
    private onTicks: TickHandler,
    private onStatus: StatusHandler,
  ) {}

  getTicks(symbol: VolSymbolId): VolTick[] {
    return this.ticks[symbol];
  }

  start(): void {
    this.intentionalClose = false;
    this.connect();
  }

  stop(): void {
    this.intentionalClose = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    this.onStatus(false, "Vol feed connecting…");
    this.done = { "1HZ250V": false };
    this.chunks = { "1HZ250V": [] };
    const ws = new WebSocket(DERIV_URL);
    this.ws = ws;

    ws.on("open", () => {
      this.onStatus(true, "Vol feed loading history");
      for (const symbol of VOL_SYMBOLS) this.request(symbol, "latest", "bootstrap");
      this.pingTimer = setInterval(() => this.send({ ping: 1 }), 30000);
    });

    ws.on("message", (raw) => {
      try {
        this.handle(JSON.parse(raw.toString()));
      } catch {
        // ignore
      }
    });

    ws.on("close", () => {
      this.onStatus(false, "Vol feed disconnected");
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.pollTimer) clearInterval(this.pollTimer);
      if (!this.intentionalClose) {
        this.reconnectTimer = setTimeout(() => this.connect(), 2500);
      }
    });

    ws.on("error", () => this.onStatus(false, "Vol feed socket error"));
  }

  private request(
    symbol: VolSymbolId,
    end: number | "latest",
    kind: "bootstrap" | "poll",
  ): void {
    const req_id = this.reqId++;
    this.reqMeta.set(req_id, { kind, symbol });
    this.send({
      ticks_history: symbol,
      adjust_start_time: 1,
      count: kind === "poll" ? 100 : CHUNK,
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

  private startPoll(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.onStatus(true, "Vol feed live");
    this.pollTimer = setInterval(() => {
      if (this.pollInFlight) return;
      this.pollInFlight = true;
      for (const symbol of VOL_SYMBOLS) this.request(symbol, "latest", "poll");
      setTimeout(() => {
        this.pollInFlight = false;
      }, Math.max(200, POLL_MS - 100));
    }, POLL_MS);
  }

  private finalize(symbol: VolSymbolId): void {
    const merged = new Map<number, number>();
    for (const chunk of this.chunks[symbol]) {
      for (const t of chunk) merged.set(t.epoch, t.quote);
    }
    this.ticks[symbol] = [...merged.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([epoch, quote]) => ({ epoch, quote }))
      .slice(-TARGET);
    this.done[symbol] = true;
    this.onTicks(symbol, this.ticks[symbol]);
    this.onStatus(true, `Vol loaded ${this.ticks[symbol].length} ticks`);
    if (VOL_SYMBOLS.every((s) => this.done[s])) this.startPoll();
  }

  private handle(msg: Record<string, unknown>): void {
    if (msg.error) {
      const err = msg.error as { message?: string };
      console.error("Vol Deriv error:", err.message, msg.echo_req);
      return;
    }
    if (msg.msg_type === "ping" || !msg.history || !msg.echo_req) return;

    const echo = msg.echo_req as { req_id?: number; ticks_history?: string };
    const meta = echo.req_id != null ? this.reqMeta.get(echo.req_id) : undefined;
    const symbol = (meta?.symbol || echo.ticks_history) as VolSymbolId | undefined;
    const history = msg.history as { prices?: number[]; times?: number[] };
    if (!symbol || !VOL_SYMBOLS.includes(symbol) || !history.prices || !history.times) {
      return;
    }
    if (echo.req_id != null) this.reqMeta.delete(echo.req_id);

    const loaded: VolTick[] = history.times.map((epoch, i) => ({
      epoch,
      quote: history.prices![i],
    }));
    const kind = meta?.kind || (this.done[symbol] ? "poll" : "bootstrap");

    if (kind === "bootstrap" && !this.done[symbol]) {
      this.chunks[symbol].push(loaded);
      const total = this.chunks[symbol].reduce((n, c) => n + c.length, 0);
      if (total >= TARGET || loaded.length < CHUNK * 0.5) {
        this.finalize(symbol);
      } else {
        this.request(symbol, loaded[0].epoch - 1, "bootstrap");
      }
      return;
    }

    const existing = this.ticks[symbol];
    const last = existing[existing.length - 1]?.epoch ?? 0;
    const fresh = loaded.filter((t) => t.epoch > last);
    if (!fresh.length) return;
    this.ticks[symbol] = [...existing, ...fresh].slice(-TARGET);
    this.onTicks(symbol, this.ticks[symbol]);
  }
}
