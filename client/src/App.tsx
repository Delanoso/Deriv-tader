import { useMemo, useState } from "react";
import { useMarketFeed } from "./hooks/useMarketFeed";
import { SymbolPanel } from "./components/SymbolPanel";
import { VolPanel } from "./components/VolPanel";
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

const MONITOR_EDGE = 0.7;

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
  const volEdge =
    volAnalysis?.prediction.calibratedConfidence ??
    volAnalysis?.prediction.confidence;
  const activeEdge = active?.opportunity.edgeScore ?? 0;

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden="true" />

      <header className="hero hero-compact">
        <div className="brand-lockup">
          <p className="brand">SpikeScope</p>
          <div className={`pulse-dot ${live ? "on" : ""}`} />
        </div>
        <h1>Trade monitor</h1>
        <p className="lede">
          Win rate, trades won or lost, and edge out of 100. A setup only appears
          when edge is 70% or higher.
        </p>
        <div className="cta-row">
          <span className={`status-pill ${live ? "live" : "off"}`}>{status}</span>
          <a className="status-pill soft nav-link" href="/calculator">
            Position calculator
          </a>
          {mode === "spikes" ? (
            <>
              <span className="status-pill soft">
                {loadedCount}/{TABS.length} markets
              </span>
              {activeEdge >= MONITOR_EDGE && (
                <span className="status-pill live">
                  Monitor · {Math.round(activeEdge * 100)}% edge
                </span>
              )}
            </>
          ) : (
            <>
              <span className={`status-pill ${vol.connected ? "live" : "off"}`}>
                {volStatus}
              </span>
              {volEdge != null && volEdge >= MONITOR_EDGE && (
                <span className="status-pill live">
                  Monitor · {Math.round(volEdge * 100)}% edge
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
          {volEdge != null && <em>{Math.round(volEdge * 100)}</em>}
        </button>
      </nav>

      {mode === "spikes" && (
        <nav className="tabs" aria-label="Markets">
          {TABS.map((t) => {
            const edge = snapshot.symbols[t.id]?.opportunity.edgeScore;
            const hot = edge != null && edge >= MONITOR_EDGE;
            return (
              <button
                key={t.id}
                type="button"
                className={`${tab === t.id ? "active" : ""} ${hot ? "hot-tab" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {edge != null && <em>{Math.round(edge * 100)}</em>}
              </button>
            );
          })}
        </nav>
      )}

      <main className="main-grid main-grid-solo">
        {mode === "spikes" ? (
          active ? (
            <SymbolPanel analysis={active} active learning={learning} />
          ) : (
            <div className="loading-panel">
              <div className="spinner" />
              <p>Pulling Deriv history for {tab}…</p>
            </div>
          )
        ) : volAnalysis ? (
          <VolPanel
            analysis={volAnalysis}
            learning={volLearning ?? vol.learning}
          />
        ) : (
          <div className="loading-panel">
            <div className="spinner" />
            <p>Pulling Volatility 250 history…</p>
          </div>
        )}
      </main>

      <footer className="foot">
        <p>{snapshot.disclaimer || "Educational use only. Not financial advice."}</p>
      </footer>
    </div>
  );
}
