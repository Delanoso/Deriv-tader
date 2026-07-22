# SpikeScope

Live opportunity feedback for Deriv **Boom/Crash** spike hunts, plus a separate research stack for **Volatility 250** (`1HZ250V`).

SpikeScope streams ticks from the Deriv WebSocket API, detects Boom/Crash spikes, and (for Vol 250) scores direction with target / stretch / invalidation levels.

> **Not financial advice.** Boom/Crash spikes are stochastic. Volatility-index direction is research — not a guarantee. Confidence in this app is intentionally capped.

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
| Live ticks | Polls Boom/Crash 300N/900/1000 plus Volatility 250 (`1HZ250V`) on its own feed |
| Spike detect | Robust z-score on tick returns (up for Boom, down for Crash) |
| Signals | Spike hunts only (Boom up / Crash down). Quiet drift candles are stand-aside |
| Vol 250 | Separate engine: EMA/RSI/momentum bias → ATR + swing target / stretch / invalidation |
| Reliability | Mean/median inter-spike gap + rough Weibull shape; flags memoryless regimes |
| Paper check | Spike-hunt backtest: enter after cooldown, score next spike capture |
| Learning loop | Journals spike hunts + Vol direction calls (own `vol-journal.json`) |

## API

- `GET /api/health` — connection status
- `GET /api/snapshot` — full analysis payload (+ learning summary)
- `GET /api/learning` — journal hit-rates and calibrated confidences
- `GET /api/learning/signals` — recent journal rows (`?symbol=` / `?status=`)
- `GET /api/backtest/:symbol` — Boom/Crash symbols
- `GET /api/vol` — Volatility 250 snapshot (analysis + learning)
- `GET /api/vol/learning` — Vol journal scoreboard
- `GET /api/vol/signals` — recent Vol journal rows
- `WS /ws` — live `snapshot`, `learning`, `vol`, `vol_learning`, `status`, `vol_status`

### Position calculator

Open `/calculator` — Deriv **Multipliers** estimate: stake × multiplier × (Δprice ÷ entry). Pick index, stake, multiplier, and points of move. Shows $ per point, $ for N points, $ per 1% move, and max loss (= stake). Not MT5 lot tick-value math.

### Learning loop

1. Seed: on first history load, bootstrap resolved journal rows from past ticks
2. Live: when a gated spike-hunt appears, log it with regime tags (age/RSI/timing/stop)
3. Resolve: win on spike/target, loss on stopout/expiry; track MFE/MAE
4. Cost check: subtract assumed round-trip cost (`COST_PCT_ROUND_TRIP`, default `0.02`)
5. Calibrate: **live decay-weighted expectancy + hit-rate only** (seed never promotes confidence)
6. Hazard: empirical P(spike within 100/500/1000/2000 ticks | current age)
7. Kill rule: stand aside on weak after-cost WR **or** negative expectancy after enough samples
8. Regime insights: compare early/mid/late/overdue expectancy (live when ready, else seed) and soft-bias confidence toward stronger age bands
9. Entry gate: quality filter + optional hard regime/focus filters with allow/reject telemetry
10. Focus weights: per-symbol / per-age expectancy → soft confidence dampening (optional hard block via `ENTRY_HARD_FOCUS`)
11. Level tune: learn stop/target % from live MFE/MAE and blend into spike plans
12. Outcome breakdown: spike / target / stop / expiry mix + actionable notes
13. Age × RSI cross regimes when cells have enough live mass
14. Walk-forward holdout: newest live fold excluded from calibration; train vs holdout reported
15. Vol parity: cost, decay expectancy, bias focus, entry gate (`VOL_ENTRY_MIN_CONF`)

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
server/src/         Boom/Crash Deriv client, analyzer, spike detector, HTTP/WS API
server/src/vol/     Volatility 250 feed, direction/range engine, vol journal
client/src/         SpikeScope dashboard (spike mode + Vol 250 mode)
scripts/            one-off Deriv probes
```
