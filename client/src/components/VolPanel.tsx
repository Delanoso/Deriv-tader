import { useMemo } from "react";
import type { VolAnalysis } from "../types";
import { PriceChart } from "./PriceChart";

interface Props {
  analysis: VolAnalysis;
}

export function VolPanel({ analysis }: Props) {
  const pred = analysis.prediction;
  const conf = pred.calibratedConfidence ?? pred.confidence;
  const confPct = Math.round(conf * 100);
  const rawPct = Math.round(pred.confidence * 100);
  const accent = pred.bias === "down" ? "#2563eb" : "#0d9488";

  const levels = useMemo(() => {
    if (pred.bias === "neutral") return [];
    return [
      { price: pred.targets.target, color: "#0d9488", title: "Target" },
      { price: pred.targets.stretch, color: "#2563eb", title: "Stretch" },
      {
        price: pred.targets.invalidation,
        color: "#ff6b4a",
        title: "Invalidation",
      },
    ];
  }, [
    pred.bias,
    pred.targets.target,
    pred.targets.stretch,
    pred.targets.invalidation,
  ]);

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

      <PriceChart candles={analysis.candles} spikes={[]} accent={accent} levels={levels} />

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

      {pred.bias !== "neutral" && (
        <div className="vol-levels">
          <Level
            label="Target"
            value={pred.targets.target}
            hint={`${pred.targets.expectedMovePct.toFixed(3)}% · ${pred.targets.method}`}
          />
          <Level label="Stretch" value={pred.targets.stretch} hint="Runner" />
          <Level
            label="Invalidation"
            value={pred.targets.invalidation}
            hint="Exit if printed first"
          />
        </div>
      )}

      <div className="metrics">
        <Metric label="Horizon" value={`${pred.horizonTicks} ticks`} />
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
        <Metric
          label="ATR 14"
          value={analysis.indicators.atr14?.toFixed(5) ?? "—"}
        />
        <Metric
          label="Swing H / L"
          value={
            analysis.indicators.swingHigh != null && analysis.indicators.swingLow != null
              ? `${analysis.indicators.swingHigh.toFixed(3)} / ${analysis.indicators.swingLow.toFixed(3)}`
              : "—"
          }
        />
      </div>
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
