import { useMemo, useState } from "react";
import { useMarketFeed } from "./hooks/useMarketFeed";
import { SymbolPanel } from "./components/SymbolPanel";
import type { SymbolId } from "./types";
import "./App.css";

const TABS: { id: SymbolId; label: string }[] = [
  { id: "BOOM1000", label: "Boom 1000" },
  { id: "CRASH1000", label: "Crash 1000" },
];

export default function App() {
  const { snapshot, status, live } = useMarketFeed();
  const [tab, setTab] = useState<SymbolId>("BOOM1000");

  const active = snapshot.symbols[tab];
  const bothReady = useMemo(
    () => Boolean(snapshot.symbols.BOOM1000 && snapshot.symbols.CRASH1000),
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
        <h1>Live feedback for Boom 1000 & Crash 1000</h1>
        <p className="lede">
          Streams Deriv ticks, marks spikes, and scores drift vs spike-watch setups —
          with confidence capped by how memoryless the gaps look.
        </p>
        <div className="cta-row">
          <span className={`status-pill ${live ? "live" : "off"}`}>{status}</span>
          <span className="status-pill soft">
            {bothReady ? "Both markets loaded" : "Warming tick history…"}
          </span>
        </div>
      </header>

      <nav className="tabs" aria-label="Markets">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {snapshot.symbols[t.id]?.opportunity && (
              <em>{Math.round(snapshot.symbols[t.id]!.opportunity.confidence * 100)}%</em>
            )}
          </button>
        ))}
      </nav>

      <main>
        {active ? (
          <SymbolPanel analysis={active} active />
        ) : (
          <div className="loading-panel">
            <div className="spinner" />
            <p>Pulling Deriv history for {tab}…</p>
          </div>
        )}
      </main>

      <footer className="foot">
        <p>{snapshot.disclaimer || "Educational use only. Not financial advice."}</p>
      </footer>
    </div>
  );
}
