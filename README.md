# SpikeScope

Live opportunity feedback for Deriv **Boom 1000** and **Crash 1000**.

SpikeScope streams ticks from the Deriv WebSocket API, detects spikes, scores drift vs spike-watch setups, and shows a quiet-drift paper check on the loaded window.

> **Not financial advice.** Boom/Crash spikes are stochastic. Research on these indices often finds near-memoryless inter-spike gaps — waiting longer does not strongly raise the odds of the next spike. Confidence in this app is intentionally capped.

## Stack

- **Server** — Node/TypeScript, Express, Deriv `ws` client, spike detector + signal engine
- **Client** — Vite + React + lightweight-charts dashboard (`SpikeScope`)

## Quick start

```bash
# install
npm install
npm install --prefix server
npm install --prefix client

# run API + UI together
npm run dev
```

- UI: http://localhost:5173  
- API: http://localhost:8787  

Optional: set `PORT` for the server (default `8787`).

## What it does

| Piece | Behavior |
| --- | --- |
| Live ticks | Subscribes to `BOOM1000` / `CRASH1000` via `wss://ws.derivws.com` (demo `app_id=1089`) |
| Spike detect | Robust z-score on tick returns (up for Boom, down for Crash) |
| Signals | `drift_follow`, `spike_watch`, `post_spike`, or `stand_aside` |
| Indicators | RSI(14), EMA(9/21), ATR(14), momentum — used as confluence, not gospel |
| Reliability | Mean/median inter-spike gap + rough Weibull shape; flags memoryless regimes |
| Paper check | Simple post-spike drift hold backtest on the in-memory tick window |

## API

- `GET /api/health` — connection status
- `GET /api/snapshot` — full analysis payload
- `GET /api/backtest/:symbol` — `BOOM1000` or `CRASH1000`
- `WS /ws` — live `snapshot` + `status` events

## Honest reliability notes

Getting “close” to a reliable predictor means being clear about the ceiling:

1. **Spike timing** is the hardest part. If gaps are memoryless (Weibull shape ≈ 1), overtime alone is a weak edge — SpikeScope caps spike-watch confidence because of this.
2. **Between-spike drift** (Boom soft down / Crash soft up) is the more repeatable structural behavior — and still gets interrupted by the next spike.
3. Use the confidence meter and paper-check win rate as feedback loops, not as guarantees. Tiny average returns can look like high win rates before costs.
4. For production, register your own Deriv `app_id` at [api.deriv.com](https://api.deriv.com) and put it in `DERIV_WS_URL`.

### Live data note

Some environments reject Deriv `ticks` / `ticks_history` **subscriptions** for Boom & Crash (and even volatility indices). SpikeScope therefore:

1. Pulls multi-chunk `ticks_history` (default 20k ticks)
2. Polls the latest window about once per second for near-live updates

If your network allows streaming subscriptions, you can extend `server/src/derivClient.ts` to prefer them.

## Scripts

```bash
npm run dev                 # client + server
npm run test --prefix server
npm run build               # build both
npm run start --prefix server  # serve API + built client
```

## Project layout

```
server/src/     Deriv client, analyzer, spike detector, HTTP/WS API
client/src/     SpikeScope dashboard
scripts/        one-off Deriv probes
```
