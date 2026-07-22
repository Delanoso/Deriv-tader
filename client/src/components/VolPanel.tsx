import { useEffect, useMemo, useState } from "react";
import type { VolAnalysis, VolJournalSignal } from "../types";
import { PriceChart, type ChartLevel, type ForecastMarker } from "./PriceChart";

interface Props {
  analysis: VolAnalysis;
}

export function VolPanel({ analysis }: Props) {
  const pred = analysis.prediction;
  const conf = pred.calibratedConfidence ?? pred.confidence;
  const confPct = Math.round(conf * 100);
  const rawPct = Math.round(pred.confidence * 100);
  const accent = pred.bias === "down" ? "#2563eb" : "#0d9488";
  const [openTrade, setOpenTrade] = useState<VolJournalSignal | null>(null);

  const levels = useMemo((): ChartLevel[] => {
    if (!openTrade) return [];
    return [
      { price: openTrade.entryPrice, color: "#7c3aed", title: "Entry" },
      { price: openTrade.target, color: "#0d9488", title: "Target" },
      { price: openTrade.stretch, color: "#2563eb", title: "Stretch" },
      {
        price: openTrade.invalidation,
        color: "#ff6b4a",
        title: "Stop",
      },
    ];
  }, [openTrade]);

  const tradeMarkers = useMemo((): ForecastMarker[] => {
    if (!openTrade?.entryEpoch) return [];
    const up = openTrade.bias === "up";
    return [
      {
        epoch: openTrade.entryEpoch,
        label: "open",
        color: "#7c3aed",
        position: up ? "belowBar" : "aboveBar",
        shape: "circle",
      },
    ];
  }, [openTrade]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/vol/signals?status=pending")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const rows = (data.signals ?? []) as VolJournalSignal[];
        const live = rows.find((s) => s.source === "live") ?? rows[0] ?? null;
        setOpenTrade(live);
      })
      .catch(() => {
        if (!cancelled) setOpenTrade(null);
      });
    return () => {
      cancelled = true;
    };
  }, [analysis.updatedAt]);

  return (
    <section className="symbol-panel is-active" data-symbol={analysis.symbol}>
      <header className="panel-head">
        <div>
          <p className="eyebrow">{analysis.displayName}</p>
          <h2 className="price">
            {analysis.lastQuote?.toLocaleString(undefined, {
              minimumFractionDigits: 3,
              maximumFractionDigits: 5,
            }) ?? "—"}
          </h2>
        </div>
        <div className={`bias-chip bias-${pred.bias}`}>
          {pred.bias === "up" ? "up" : pred.bias === "down" ? "down" : "flat"}
        </div>
      </header>

      <PriceChart
        candles={analysis.candles}
        spikes={[]}
        accent={accent}
        levels={levels}
        forecastMarkers={tradeMarkers}
        candleStepSec={analysis.timeframe?.candleSec ?? 60}
      />

      {openTrade && (
        <div className="open-trade-banner">
          Open paper trade · {openTrade.bias.toUpperCase()} · entry{" "}
          {openTrade.entryPrice.toFixed(5)} · target {openTrade.target.toFixed(5)} ·
          stop {openTrade.invalidation.toFixed(5)}
        </div>
      )}

      <div className="signal-block">
        <div className="signal-top">
          <span className="kind">Direction + range</span>
          <span className="confidence" style={{ ["--p" as string]: `${confPct}%` }}>
            {confPct}% calibrated
            {confPct !== rawPct ? ` · raw ${rawPct}%` : ""}
          </span>
        </div>
        <p className="action">{pred.action}</p>
        <ul className="rationale">
          {pred.rationale.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="risk">{pred.riskNote}</p>
      </div>

      <div className="metrics">
        <Metric
          label="Timeframe"
          value={`${(analysis.timeframe?.candleSec ?? 60) / 60}m`}
        />
        <Metric
          label="Min hold"
          value={`${(analysis.timeframe?.minHoldTicks ?? pred.horizonTicks) / 60}m`}
        />
        <Metric
          label="Horizon"
          value={`${Math.round(pred.horizonTicks / 60)}m`}
        />
        <Metric label="Ticks loaded" value={String(analysis.ticksCollected)} />
        <Metric label="RSI 14" value={analysis.indicators.rsi14?.toFixed(1) ?? "—"} />
        <Metric
          label="Momentum 20"
          value={
            analysis.indicators.momentum20 != null
              ? `${analysis.indicators.momentum20.toFixed(2)}%`
              : "—"
          }
        />
      </div>
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
