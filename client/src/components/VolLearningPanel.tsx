import type { VolLearningSummary } from "../types";

interface Props {
  learning: VolLearningSummary | null;
}

export function VolLearningPanel({ learning }: Props) {
  if (!learning) {
    return (
      <section className="learning-panel">
        <h3>Vol 250 scoreboard</h3>
        <p className="muted">Warming journal…</p>
      </section>
    );
  }

  const { up, down } = learning.byBias;
  const cost = learning.costPctAssumed ?? 0.02;
  const upExp = up.decayExpectancyNetPct ?? up.expectancyNetPct;
  const downExp = down.decayExpectancyNetPct ?? down.expectancyNetPct;
  const upWr = up.decayWinRateAfterCost ?? up.winRateAfterCost;
  const downWr = down.decayWinRateAfterCost ?? down.winRateAfterCost;
  const preferred = learning.focus?.preferred;
  const insights = learning.insights ?? [];
  const outcomes = learning.outcomes;

  return (
    <section className="learning-panel">
      <div className="learning-head">
        <h3>Vol 250 scoreboard</h3>
        <p>
          1m direction calls · hold ≥3m · cost {cost.toFixed(3)}% rt · decay-weighted
          {preferred != null
            ? ` · preferred: ${preferred === "up" ? "Up" : "Down"}`
            : ""}
        </p>
      </div>

      <div className="learn-grid">
        <Stat label="Decay WR (after cost)" value={pct(blendWr(upWr, downWr))} />
        <Stat
          label="Expectancy (net)"
          value={fmtExp(blendExp(upExp, downExp))}
        />
        <Stat label="Target hit rate" value={pct(learning.targetHitRate)} />
        <Stat label="Resolved / pending" value={`${learning.resolved} / ${learning.pending}`} />
      </div>

      <div className="kind-rows">
        <div className="kind-row">
          <span>Up calls{preferred === "up" ? " ★" : ""}</span>
          <span>{pct(upWr)}</span>
          <span>
            exp {fmtExp(upExp)} · n={up.winsAfterCost + up.lossesAfterCost}
            {learning.calibrated.up != null
              ? ` · cal ${(learning.calibrated.up * 100).toFixed(0)}%`
              : ""}
          </span>
        </div>
        <div className="kind-row">
          <span>Down calls{preferred === "down" ? " ★" : ""}</span>
          <span>{pct(downWr)}</span>
          <span>
            exp {fmtExp(downExp)} · n={down.winsAfterCost + down.lossesAfterCost}
            {learning.calibrated.down != null
              ? ` · cal ${(learning.calibrated.down * 100).toFixed(0)}%`
              : ""}
          </span>
        </div>
      </div>

      {outcomes && outcomes.total > 0 && (
        <div className="seed-box">
          <h4>Outcomes (resolved)</h4>
          <p>
            Target {outcomes.target} · stop {outcomes.stopout} · expired{" "}
            {outcomes.expired}
            {outcomes.spike > 0 ? ` · spike ${outcomes.spike}` : ""}
          </p>
        </div>
      )}

      <div className="seed-box">
        <h4>Path quality (MFE / MAE)</h4>
        <p>
          Up avg MFE {fmtPct(up.avgMfePct)} · MAE {fmtPct(up.avgMaePct)} · target{" "}
          {pct(up.targetHitRate)}
        </p>
        <p>
          Down avg MFE {fmtPct(down.avgMfePct)} · MAE {fmtPct(down.avgMaePct)} ·
          target {pct(down.targetHitRate)}
        </p>
      </div>

      {insights.length > 0 && (
        <div className="seed-box">
          <h4>Insights</h4>
          <ul className="insight-list">
            {insights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function blendWr(a: number | null, b: number | null): number | null {
  if (a != null && b != null) return (a + b) / 2;
  return a ?? b;
}

function blendExp(a: number | null, b: number | null): number | null {
  if (a != null && b != null) return (a + b) / 2;
  return a ?? b;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function pct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(0)}%`;
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(3)}%`;
}

function fmtExp(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(3)}%`;
}
