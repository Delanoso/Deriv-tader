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

  const counts = (Object.keys(LABELS) as SymbolId[]).map((id) => {
    const board = learning.live.bySymbol[id]?.byKind.spike_watch;
    const seed = learning.seed.bySymbol[id]?.byKind.spike_watch;
    const n = (board?.total ?? 0) + (seed?.total ?? 0);
    return { id, n };
  });

  return (
    <section className="learning-panel">
      <div className="learning-head">
        <h3>Spike-hunt scoreboard</h3>
        <p>Tracking Boom/Crash spikes only · cost {cost.toFixed(3)}% rt</p>
      </div>

      <div className="learn-grid">
        <Stat label="Live spike win rate" value={pct(spikeLive?.winRate ?? null)} />
        <Stat label="After cost" value={pct(spikeLive?.winRateAfterCost ?? null)} />
        <Stat
          label="Avg net return"
          value={
            spikeLive?.avgReturnNetPct != null
              ? `${spikeLive.avgReturnNetPct.toFixed(3)}%`
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
          <span>{pct(spikeLive?.winRateAfterCost ?? spikeLive?.winRate ?? null)}</span>
          <span>
            n={(spikeLive?.wins ?? 0) + (spikeLive?.losses ?? 0)}
            {calibrated != null ? ` · cal ${(calibrated * 100).toFixed(0)}%` : ""}
          </span>
        </div>
      </div>

      <div className="seed-box">
        <h4>Seed spike hunts — not used for confidence</h4>
        <p>
          {pct(spikeSeed?.winRate ?? null)} gross ·{" "}
          {pct(spikeSeed?.winRateAfterCost ?? null)} after cost · n=
          {(spikeSeed?.wins ?? 0) + (spikeSeed?.losses ?? 0)}
        </p>
      </div>

      <div className="index-trade-counts">
        <h4>Trades by index</h4>
        <div className="count-chips">
          {counts.map(({ id, n }) => (
            <span key={id} className={id === symbol ? "active" : ""}>
              {LABELS[id]} {n}
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
