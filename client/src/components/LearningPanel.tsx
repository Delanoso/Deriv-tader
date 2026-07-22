import type { LearningSummary, SymbolId } from "../types";

interface Props {
  learning: LearningSummary | null;
  symbol: SymbolId;
}

const LABELS: Record<SymbolId, string> = {
  BOOM300N: "B300",
  BOOM900: "B900",
  BOOM1000: "B1000",
  CRASH300N: "C300",
  CRASH900: "C900",
  CRASH1000: "C1000",
};

export function LearningPanel({ learning, symbol }: Props) {
  if (!learning) {
    return (
      <section className="learning-panel">
        <h3>Spike-hunt scoreboard</h3>
        <p className="muted">Warming journal…</p>
      </section>
    );
  }

  const liveBoard = learning.live.bySymbol[symbol];
  const seedBoard = learning.seed.bySymbol[symbol];
  const spikeLive = liveBoard?.byKind.spike_watch;
  const spikeSeed = seedBoard?.byKind.spike_watch;
  const cost = learning.costPctAssumed;
  const calibrated = learning.calibrated[symbol]?.spike_watch;
  const regimes = learning.regimes?.[symbol] ?? [];
  const seedRegimes = learning.seedRegimes?.[symbol] ?? [];
  const cross = (learning.crossRegimes?.[symbol] ?? []).filter(
    (r) => r.stats.winsAfterCost + r.stats.lossesAfterCost >= 5,
  );
  const outcomes = learning.outcomesBySymbol?.[symbol] ?? learning.outcomes;
  const focus = learning.focus?.bySymbol?.[symbol];
  const levelHint = learning.levelHints?.[symbol];
  const wf = learning.walkForward;
  const insights = (learning.insights ?? []).filter(
    (i) =>
      i.startsWith(symbol) ||
      i.startsWith("Walk-forward") ||
      i.startsWith(`${symbol}:`),
  );
  const gate = learning.gateTelemetry;

  const counts = (Object.keys(LABELS) as SymbolId[]).map((id) => {
    const board = learning.live.bySymbol[id]?.byKind.spike_watch;
    const seed = learning.seed.bySymbol[id]?.byKind.spike_watch;
    const n = (board?.total ?? 0) + (seed?.total ?? 0);
    const fw = learning.focus?.bySymbol?.[id];
    return { id, n, weight: fw?.weight, dep: fw?.deprioritize };
  });

  const exp =
    spikeLive?.decayExpectancyNetPct ?? spikeLive?.expectancyNetPct ?? null;
  const decayWr = spikeLive?.decayWinRateAfterCost ?? spikeLive?.winRateAfterCost;

  const liveRegimeRows = regimes.filter((r) => r.stats.total > 0);
  const seedRegimeRows = seedRegimes.filter((r) => {
    const n = r.stats.winsAfterCost + r.stats.lossesAfterCost;
    return n > 0;
  });

  return (
    <section className="learning-panel">
      <div className="learning-head">
        <h3>Spike-hunt scoreboard</h3>
        <p>
          Live learning · cost {cost.toFixed(3)}% rt · decay-weighted
          {focus != null ? ` · focus ×${focus.weight}` : ""}
          {focus?.deprioritize ? " · deprioritized" : ""}
        </p>
      </div>

      <div className="learn-grid">
        <Stat label="Decay WR (after cost)" value={pct(decayWr ?? null)} />
        <Stat
          label="Expectancy (net)"
          value={exp != null ? `${exp.toFixed(3)}%` : "—"}
        />
        <Stat
          label="Avg MFE / MAE"
          value={
            spikeLive?.avgMfePct != null
              ? `${spikeLive.avgMfePct.toFixed(3)} / ${spikeLive.avgMaePct?.toFixed(3) ?? "—"}`
              : "—"
          }
        />
        <Stat
          label="Wins / losses"
          value={`${spikeLive?.wins ?? 0} / ${spikeLive?.losses ?? 0}`}
        />
      </div>

      <div className="kind-rows">
        <div className="kind-row">
          <span>Spike hunt</span>
          <span>{pct(decayWr ?? spikeLive?.winRate ?? null)}</span>
          <span>
            n={(spikeLive?.wins ?? 0) + (spikeLive?.losses ?? 0)}
            {calibrated != null ? ` · cal ${(calibrated * 100).toFixed(0)}%` : ""}
            {spikeLive?.decayEffectiveN
              ? ` · eff≈${spikeLive.decayEffectiveN.toFixed(0)}`
              : ""}
          </span>
        </div>
      </div>

      {outcomes && outcomes.total > 0 && (
        <div className="seed-box">
          <h4>Outcomes</h4>
          <p>
            Spike {outcomes.spike} · target {outcomes.target} · stop{" "}
            {outcomes.stopout} · expired {outcomes.expired}
          </p>
          {outcomes.note && <p className="muted">{outcomes.note}</p>}
        </div>
      )}

      {levelHint && (
        <div className="seed-box">
          <h4>Learned levels (MFE/MAE)</h4>
          <p>
            Stop ≈{levelHint.stopPct}% · target ≈{levelHint.targetPct}% · n=
            {levelHint.basedOnN}
          </p>
        </div>
      )}

      {wf && wf.holdoutN > 0 && (
        <div className="seed-box">
          <h4>Walk-forward</h4>
          <p>
            Train n={wf.trainN} exp {fmtExp(wf.trainExpectancyNetPct)} · holdout
            n={wf.holdoutN} exp {fmtExp(wf.holdoutExpectancyNetPct)}
            {wf.gapExpectancy != null
              ? ` · Δ ${wf.gapExpectancy.toFixed(3)}%`
              : ""}
          </p>
          {wf.note && <p className="muted">{wf.note}</p>}
        </div>
      )}

      {liveRegimeRows.length > 0 && (
        <div className="regime-box">
          <h4>By age regime (live)</h4>
          <div className="kind-rows">
            {liveRegimeRows.map((r) => {
              const n = r.stats.winsAfterCost + r.stats.lossesAfterCost;
              const e = r.stats.decayExpectancyNetPct ?? r.stats.expectancyNetPct;
              return (
                <div className="kind-row" key={r.key}>
                  <span>{r.label}</span>
                  <span>
                    {e != null ? `${e.toFixed(3)}%` : pct(r.stats.winRateAfterCost)}
                  </span>
                  <span>n={n}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {cross.length > 0 && (
        <div className="regime-box">
          <h4>Age × RSI (live, n≥5)</h4>
          <div className="kind-rows">
            {cross.slice(0, 8).map((r) => {
              const n = r.stats.winsAfterCost + r.stats.lossesAfterCost;
              const e = r.stats.decayExpectancyNetPct ?? r.stats.expectancyNetPct;
              return (
                <div className="kind-row" key={r.key}>
                  <span>{r.label}</span>
                  <span>
                    {e != null ? `${e.toFixed(3)}%` : pct(r.stats.winRateAfterCost)}
                  </span>
                  <span>n={n}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {seedRegimeRows.length > 0 && (
        <div className="regime-box seed-regimes">
          <h4>By age regime (seed — context only)</h4>
          <div className="kind-rows">
            {seedRegimeRows.map((r) => {
              const n = r.stats.winsAfterCost + r.stats.lossesAfterCost;
              const e = r.stats.expectancyNetPct;
              return (
                <div className="kind-row" key={`seed-${r.key}`}>
                  <span>{r.label}</span>
                  <span>
                    {e != null ? `${e.toFixed(3)}%` : pct(r.stats.winRateAfterCost)}
                  </span>
                  <span>n={n}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {insights.length > 0 && (
        <div className="seed-box">
          <h4>Learning insight</h4>
          {insights.map((line) => (
            <p key={line}>
              {line
                .replace(`${symbol}: `, "")
                .replace(/^Walk-forward: /, "")}
            </p>
          ))}
        </div>
      )}

      <div className="seed-box">
        <h4>Seed spike hunts — not used for confidence</h4>
        <p>
          {pct(spikeSeed?.winRate ?? null)} gross ·{" "}
          {pct(spikeSeed?.winRateAfterCost ?? null)} after cost · n=
          {(spikeSeed?.wins ?? 0) + (spikeSeed?.losses ?? 0)}
        </p>
      </div>

      {gate && (gate.allowed > 0 || gate.rejected > 0) && (
        <div className="seed-box">
          <h4>Entry gate (this process)</h4>
          <p>
            allowed {gate.allowed} · rejected {gate.rejected}
            {Object.keys(gate.reasons).length
              ? ` · ${Object.entries(gate.reasons)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(" · ")}`
              : ""}
          </p>
        </div>
      )}

      <div className="index-trade-counts">
        <h4>Trades by index</h4>
        <div className="count-chips">
          {counts.map(({ id, n, weight, dep }) => (
            <span
              key={id}
              className={`${id === symbol ? "active" : ""}${dep ? " dim" : ""}`}
              title={
                weight != null
                  ? `focus ×${weight}${dep ? " (deprioritized)" : ""}`
                  : undefined
              }
            >
              {LABELS[id]} {n}
              {weight != null && weight !== 1 ? ` ×${weight}` : ""}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="learn-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function pct(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtExp(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(3)}%`;
}
