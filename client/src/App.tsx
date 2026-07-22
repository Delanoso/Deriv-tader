import { useMemo, useState } from "react";
import { useMarketFeed } from "./hooks/useMarketFeed";
import { SymbolPanel } from "./components/SymbolPanel";
import { LearningPanel } from "./components/LearningPanel";
import { ForecastPanel } from "./components/ForecastPanel";
import { VolPanel } from "./components/VolPanel";
import { VolLearningPanel } from "./components/VolLearningPanel";
import { TradeBook } from "./components/TradeBook";
import type { SymbolId } from "./types";
import "./App.css";

type Mode = "spikes" | "vol250";

const TABS: { id: SymbolId; label: string }[] = [
  { id: "BOOM300N", label: "Boom 300" },
  { id: "BOOM900", label: "Boom 900" },
  { id: "BOOM1000", label: "Boom 1000" },
  { id: "CRASH300N", label: "Crash 300" },
  { id: "CRASH900", label: "Crash 900" },
  { id: "CRASH1000", label: "Crash 1000" },
];

export default function App() {
  const { snapshot, learning, vol, volLearning, status, volStatus, live } =
    useMarketFeed();
  const [mode, setMode] = useState<Mode>("spikes");
  const [tab, setTab] = useState<SymbolId>("BOOM1000");

  const active = snapshot.symbols[tab];
  const loadedCount = useMemo(
    () => TABS.filter((t) => Boolean(snapshot.symbols[t.id])).length,
    [snapshot.symbols],
  );
  const volAnalysis = vol.analysis;
  const volConf =
    volAnalysis?.prediction.calibratedConfidence ??
    volAnalysis?.prediction.confidence;

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden="true" />

      <header className="hero">
        <div className="brand-lockup">
          <p className="brand">SpikeScope</p>
          <div className={`pulse-dot ${live ? "on" : ""}`} />
        </div>
        <h1>
          {mode === "spikes"
            ? "Spike hunts for Boom & Crash 300 / 900 / 1000"
            : "Volatility 250 — direction and how far"}
        </h1>
        <p className="lede">
          {mode === "spikes"
            ? "Built to hunt Boom up-spikes and Crash down-spikes — not the quiet candles between them — then journal whether the hunt paid."
            : "Separate research stack for Volatility 250 on 1-minute candles. Paper trades hold at least 3 minutes before target/stop exits."}
        </p>
        <div className="cta-row">
          <span className={`status-pill ${live ? "live" : "off"}`}>{status}</span>
          {mode === "spikes" ? (
            <>
              <span className="status-pill soft">
                {loadedCount}/{TABS.length} markets loaded
              </span>
              {active?.kill?.killed && (
                <span className="status-pill off">Kill rule active</span>
              )}
              {!active?.kill?.killed && active?.kill?.warning && (
                <span className="status-pill off">Kill warning</span>
              )}
              {active?.forecast?.bestHorizon?.probability != null && (
                <span className="status-pill soft">
                  Best P(spike≤{active.forecast.bestHorizon.horizonTicks})=
                  {Math.round(active.forecast.bestHorizon.probability * 100)}%
                </span>
              )}
            </>
          ) : (
            <>
              <span className={`status-pill ${vol.connected ? "live" : "off"}`}>
                {volStatus}
              </span>
              {volAnalysis?.lastQuote != null && (
                <span className="status-pill soft">
                  {volAnalysis.ticksCollected.toLocaleString()} ticks ·{" "}
                  {volAnalysis.prediction.bias}
                  {volConf != null ? ` · ${Math.round(volConf * 100)}%` : ""}
                </span>
              )}
            </>
          )}
        </div>
      </header>

      <nav className="mode-tabs" aria-label="Research mode">
        <button
          type="button"
          className={mode === "spikes" ? "active" : ""}
          onClick={() => setMode("spikes")}
        >
          Boom / Crash spikes
        </button>
        <button
          type="button"
          className={mode === "vol250" ? "active" : ""}
          onClick={() => setMode("vol250")}
        >
          Volatility 250
          {volConf != null && <em>{Math.round(volConf * 100)}%</em>}
        </button>
      </nav>

      {mode === "spikes" && (
        <nav className="tabs" aria-label="Markets">
          {TABS.map((t) => {
            const opp = snapshot.symbols[t.id]?.opportunity;
            const conf = opp?.calibratedConfidence ?? opp?.confidence;
            return (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? "active" : ""}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {conf != null && <em>{Math.round(conf * 100)}%</em>}
              </button>
            );
          })}
        </nav>
      )}

      <main className="main-grid">
        {mode === "spikes" ? (
          <>
            {active ? (
              <SymbolPanel analysis={active} active />
            ) : (
              <div className="loading-panel">
                <div className="spinner" />
                <p>Pulling Deriv history for {tab}…</p>
              </div>
            )}
            <aside className="side-stack">
              <ForecastPanel forecast={active?.forecast} kill={active?.kill} />
              <LearningPanel learning={learning} symbol={tab} />
            </aside>
          </>
        ) : (
          <>
            {volAnalysis ? (
              <VolPanel analysis={volAnalysis} />
            ) : (
              <div className="loading-panel">
                <div className="spinner" />
                <p>Pulling Volatility 250 history…</p>
              </div>
            )}
            <aside className="side-stack">
              <section className="forecast-panel">
                <h3>Until where?</h3>
                {volAnalysis && volAnalysis.prediction.bias !== "neutral" ? (
                  <>
                    <p className="timing-note ok">
                      Primary target{" "}
                      <strong>{volAnalysis.prediction.targets.target.toFixed(5)}</strong>{" "}
                      (~{volAnalysis.prediction.targets.expectedMovePct.toFixed(3)}%),
                      stretch{" "}
                      <strong>{volAnalysis.prediction.targets.stretch.toFixed(5)}</strong>
                      . Stand down if{" "}
                      <strong>
                        {volAnalysis.prediction.targets.invalidation.toFixed(5)}
                      </strong>{" "}
                      prints first.
                    </p>
                    <p className="timing-note">
                      1m chart · hold ≥
                      {(volAnalysis.timeframe?.minHoldTicks ?? 180) / 60}m · horizon{" "}
                      {Math.round(volAnalysis.prediction.horizonTicks / 60)}m ·{" "}
                      {volAnalysis.prediction.targets.method}
                    </p>
                  </>
                ) : (
                  <p className="timing-note weak">
                    Waiting for a clear EMA / momentum / RSI stack before projecting
                    range.
                  </p>
                )}
              </section>
              <VolLearningPanel learning={volLearning ?? vol.learning} />
            </aside>
          </>
        )}
      </main>

      <section className="trade-book-slot">
        {mode === "spikes" ? (
          <TradeBook
            mode="spike"
            symbol={tab}
            refreshKey={learning?.updatedAt}
          />
        ) : (
          <TradeBook
            mode="vol"
            refreshKey={(volLearning ?? vol.learning)?.updatedAt}
          />
        )}
      </section>

      <footer className="foot">
        <p>{snapshot.disclaimer || "Educational use only. Not financial advice."}</p>
      </footer>
    </div>
  );
}
