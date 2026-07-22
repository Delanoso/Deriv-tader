import { useMemo, useState } from "react";
import { useMarketFeed } from "./hooks/useMarketFeed";
import { SymbolPanel } from "./components/SymbolPanel";
import { LearningPanel } from "./components/LearningPanel";
import { ForecastPanel } from "./components/ForecastPanel";
import type { SymbolId } from "./types";
import "./App.css";

const TABS: { id: SymbolId; label: string }[] = [
  { id: "BOOM300N", label: "Boom 300" },
  { id: "BOOM900", label: "Boom 900" },
  { id: "BOOM1000", label: "Boom 1000" },
  { id: "CRASH300N", label: "Crash 300" },
  { id: "CRASH900", label: "Crash 900" },
  { id: "CRASH1000", label: "Crash 1000" },
];

export default function App() {
  const { snapshot, learning, status, live } = useMarketFeed();
  const [tab, setTab] = useState<SymbolId>("BOOM1000");

  const active = snapshot.symbols[tab];
  const loadedCount = useMemo(
    () => TABS.filter((t) => Boolean(snapshot.symbols[t.id])).length,
    [snapshot.symbols],
  );

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden="true" />

      <header className="hero">
        <div className="brand-lockup">
          <p className="brand">SpikeScope</p>
          <div className={`pulse-dot ${live ? "on" : ""}`} />
        </div>
        <h1>Spike hunts for Boom & Crash 300 / 900 / 1000</h1>
        <p className="lede">
          Built to hunt Boom up-spikes and Crash down-spikes — not the quiet
          candles between them — then journal whether the hunt paid.
        </p>
        <div className="cta-row">
          <span className={`status-pill ${live ? "live" : "off"}`}>{status}</span>
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
        </div>
      </header>

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

      <main className="main-grid">
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
      </main>

      <footer className="foot">
        <p>{snapshot.disclaimer || "Educational use only. Not financial advice."}</p>
      </footer>
    </div>
  );
}
