import type { SymbolAnalysis, BacktestResult, JournalSignal } from "../types";
import { PriceChart, type ChartLevel, type ForecastMarker } from "./PriceChart";
import { useEffect, useMemo, useState } from "react";

interface Props {
  analysis: SymbolAnalysis;
  active: boolean;
}

const KIND_LABEL: Record<string, string> = {
  drift_follow: "Drift (ignored)",
  spike_watch: "Spike hunt",
  post_spike: "Post spike",
  stand_aside: "Stand aside",
};

export function SymbolPanel({ analysis, active }: Props) {
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [openTrade, setOpenTrade] = useState<JournalSignal | null>(null);
  const isBoom = analysis.symbol.startsWith("BOOM");
  const accent = isBoom ? "#0d9488" : "#2563eb";
  const displayConf =
    analysis.opportunity.calibratedConfidence ?? analysis.opportunity.confidence;
  const confPct = Math.round(displayConf * 100);
  const rawPct = Math.round(analysis.opportunity.confidence * 100);

  // Only draw levels / entry marker while a paper trade is open for this market.
  const levels = useMemo((): ChartLevel[] => {
    if (!openTrade) return [];
    const out: ChartLevel[] = [];
    out.push({
      price: openTrade.entryPrice,
      color: "#7c3aed",
      title: "Entry",
    });
    if (openTrade.target != null) {
      out.push({ price: openTrade.target, color: "#0d9488", title: "Target" });
    }
    if (openTrade.stretch != null) {
      out.push({ price: openTrade.stretch, color: "#2563eb", title: "Stretch" });
    }
    if (openTrade.invalidation != null) {
      out.push({
        price: openTrade.invalidation,
        color: "#ff6b4a",
        title: "Stop",
      });
    }
    return out;
  }, [openTrade]);

  const tradeMarkers = useMemo((): ForecastMarker[] => {
    if (!openTrade?.entryEpoch) return [];
    const up = openTrade.bias === "bullish" || isBoom;
    return [
      {
        epoch: openTrade.entryEpoch,
        label: "open",
        color: "#7c3aed",
        position: up ? "belowBar" : "aboveBar",
        shape: "circle",
      },
    ];
  }, [openTrade, isBoom]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch(`/api/backtest/${analysis.symbol}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setBacktest(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, analysis.symbol, analysis.updatedAt]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch(`/api/learning/signals?symbol=${analysis.symbol}&status=pending`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const rows = (data.signals ?? []) as JournalSignal[];
        const live = rows.find((s) => s.source === "live") ?? rows[0] ?? null;
        setOpenTrade(live);
      })
      .catch(() => {
        if (!cancelled) setOpenTrade(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active, analysis.symbol, analysis.updatedAt]);

  return (
    <section
      className={`symbol-panel ${active ? "is-active" : ""}`}
      data-symbol={analysis.symbol}
    >
      <header className="panel-head">
        <div>
          <p className="eyebrow">{analysis.displayName}</p>
          <h2 className="price">
            {analysis.lastQuote?.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 3,
            }) ?? "—"}
          </h2>
        </div>
        <div className={`bias-chip bias-${analysis.opportunity.bias}`}>
          {analysis.opportunity.bias}
        </div>
      </header>

      <PriceChart
        candles={analysis.candles}
        spikes={analysis.recentSpikes}
        accent={accent}
        levels={levels}
        forecastMarkers={tradeMarkers}
        spikeDirection={isBoom ? "up" : "down"}
      />

      {openTrade && (
        <div className="open-trade-banner">
          Open paper trade · entry {openTrade.entryPrice.toFixed(3)}
          {openTrade.target != null ? ` · target ${openTrade.target.toFixed(3)}` : ""}
          {openTrade.invalidation != null
            ? ` · stop ${openTrade.invalidation.toFixed(3)}`
            : ""}
        </div>
      )}

      <div className="signal-block">
        <div className="signal-top">
          <span className="kind">{KIND_LABEL[analysis.opportunity.kind]}</span>
          <span className="confidence" style={{ ["--p" as string]: `${confPct}%` }}>
            {confPct}% calibrated
            {confPct !== rawPct ? ` · raw ${rawPct}%` : ""}
          </span>
        </div>
        <p className="action">{analysis.opportunity.action}</p>
        <ul className="rationale">
          {analysis.opportunity.rationale.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="risk">{analysis.opportunity.riskNote}</p>
      </div>

      <div className="metrics">
        <Metric label="Ticks since spike" value={fmt(analysis.ticksSinceLastSpike)} />
        <Metric
          label="Mean gap"
          value={fmt(analysis.reliability.meanInterSpikeTicks, 0)}
        />
        <Metric label="Spikes sampled" value={String(analysis.reliability.sampleSpikes)} />
        <Metric label="RSI 14" value={analysis.indicators.rsi14?.toFixed(1) ?? "—"} />
        <Metric
          label="Momentum 20"
          value={
            analysis.indicators.momentum20 != null
              ? `${analysis.indicators.momentum20.toFixed(2)}%`
              : "—"
          }
        />
        <Metric
          label="Weibull≈"
          value={analysis.reliability.weibullShapeApprox?.toFixed(2) ?? "—"}
        />
      </div>

      <p className="memory-note">{analysis.reliability.memorylessNote}</p>

      {backtest && (
        <div className="backtest">
          <h3>Spike-hunt paper check</h3>
          <p>
            {backtest.trades} hunts · win rate{" "}
            {backtest.winRate != null ? `${(backtest.winRate * 100).toFixed(1)}%` : "n/a"} · avg{" "}
            {backtest.avgReturnPct != null ? `${backtest.avgReturnPct.toFixed(3)}%` : "n/a"}
          </p>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}
