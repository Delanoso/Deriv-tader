import type { SymbolAnalysis, BacktestResult } from "../types";
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
  const isBoom = analysis.symbol.startsWith("BOOM");
  const accent = isBoom ? "#0d9488" : "#2563eb";
  const displayConf =
    analysis.opportunity.calibratedConfidence ?? analysis.opportunity.confidence;
  const confPct = Math.round(displayConf * 100);
  const rawPct = Math.round(analysis.opportunity.confidence * 100);
  const plan = analysis.spikePlan;

  const levels = useMemo((): ChartLevel[] => {
    if (!plan) return [];
    return [
      {
        price: plan.spikeTarget,
        color: "#0d9488",
        title: plan.active ? "Spike target" : "Spike lvl",
      },
      { price: plan.stretch, color: "#2563eb", title: "Stretch" },
      { price: plan.invalidation, color: "#ff6b4a", title: "Invalidation" },
    ];
  }, [plan]);

  const forecastMarkers = useMemo((): ForecastMarker[] => {
    if (!plan) return [];
    const markers: ForecastMarker[] = [];
    const nowEpoch = analysis.lastEpoch ?? analysis.candles.at(-1)?.epoch;
    if (nowEpoch != null) {
      markers.push({
        epoch: nowEpoch,
        label: "invalidate",
        color: "#ff6b4a",
        position: isBoom ? "aboveBar" : "belowBar",
        shape: "circle",
      });
    }
    if (plan.expectedEpoch != null) {
      markers.push({
        epoch: plan.expectedEpoch,
        label:
          plan.ticksToEta != null && plan.ticksToEta > 0
            ? `spike ETA ~${plan.ticksToEta}`
            : "spike now",
        color: plan.active ? "#0d9488" : "#4a5d6a",
        position: isBoom ? "belowBar" : "aboveBar",
        shape: isBoom ? "arrowUp" : "arrowDown",
      });
    }
    return markers;
  }, [plan, isBoom, analysis.lastEpoch, analysis.candles]);

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
        levels={levels}
        forecastMarkers={forecastMarkers}
      />

      {plan && (
        <div className="vol-levels">
          <Level
            label="Spike target"
            value={plan.spikeTarget}
            hint={`${plan.expectedMovePct.toFixed(3)}% · ${plan.active ? "hunt active" : "reference"}`}
          />
          <Level label="Stretch" value={plan.stretch} hint="Larger spike print" />
          <Level
            label="Invalidation"
            value={plan.invalidation}
            hint={
              plan.ticksToEta != null
                ? `ETA ~${plan.ticksToEta} ticks · exit if printed first`
                : "Exit if printed first"
            }
          />
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

function Level({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="vol-level">
      <span>{label}</span>
      <strong>{value.toFixed(5)}</strong>
      <em>{hint}</em>
    </div>
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
