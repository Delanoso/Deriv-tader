import type { SpikeForecast, KillStatus } from "../types";

interface Props {
  forecast?: SpikeForecast;
  kill?: KillStatus;
}

export function ForecastPanel({ forecast, kill }: Props) {
  if (!forecast) {
    return (
      <section className="forecast-panel">
        <h3>Spike odds</h3>
        <p className="muted">Building hazard model…</p>
      </section>
    );
  }

  const maxHazard = Math.max(
    0.01,
    ...forecast.hazardCurve.map((b) => b.hazard ?? 0),
  );

  return (
    <section className="forecast-panel">
      <div className="learning-head">
        <h3>Spike odds</h3>
        <p>
          Age {forecast.ticksSinceLastSpike ?? "—"} · gaps n=
          {forecast.gapSampleSize}
          {forecast.meanGap != null ? ` · mean ${Math.round(forecast.meanGap)}` : ""}
        </p>
      </div>

      {kill?.killed && (
        <div className="kill-banner killed">{kill.reason}</div>
      )}
      {!kill?.killed && kill?.warning && (
        <div className="kill-banner warn">
          Kill warning: live after-cost WR{" "}
          {kill.liveWinRateAfterCost != null
            ? `${(kill.liveWinRateAfterCost * 100).toFixed(1)}%`
            : "—"}{" "}
          on {kill.liveSamples}/{kill.thresholdSamples} samples
          (floor {(kill.thresholdWinRateAfterCost * 100).toFixed(0)}%).
        </div>
      )}

      <div className="horizon-grid">
        {forecast.horizons.map((h) => (
          <div className="horizon-card" key={h.horizonTicks}>
            <span>≤{h.horizonTicks} ticks</span>
            <strong>
              {h.probability != null ? `${(h.probability * 100).toFixed(0)}%` : "—"}
            </strong>
            <em>
              {h.fallback ? "fallback" : `n=${h.survivors}`}
            </em>
          </div>
        ))}
      </div>

      <p className={`timing-note ${forecast.timingEdgeWeak ? "weak" : "ok"}`}>
        {forecast.timingNote}
      </p>

      <div className="hazard-chart" aria-label="Hazard curve">
        {forecast.hazardCurve.map((b) => (
          <div className="hazard-col" key={`${b.ageFrom}-${b.ageTo}`}>
            <div
              className="hazard-bar"
              style={{
                height: `${Math.round(((b.hazard ?? 0) / maxHazard) * 100)}%`,
              }}
              title={`${b.ageFrom}–${b.ageTo}: ${b.hazard ?? "n/a"}`}
            />
            <span>{b.ageFrom}</span>
          </div>
        ))}
      </div>
      <p className="muted hazard-caption">Hazard by age bin (ticks since last spike)</p>
    </section>
  );
}
