import type { SymbolAnalysis, BacktestResult } from "../types";
import { PriceChart } from "./PriceChart";
import { useEffect, useState } from "react";

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
  const accent = analysis.symbol === "BOOM1000" ? "#0d9488" : "#2563eb";
  const displayConf =
    analysis.opportunity.calibratedConfidence ?? analysis.opportunity.confidence;
  const confPct = Math.round(displayConf * 100);
  const rawPct = Math.round(analysis.opportunity.confidence * 100);

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
      />

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
