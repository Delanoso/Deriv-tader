import type { LearningSummary, SymbolId } from "../types";

interface Props {
  learning: LearningSummary | null;
  symbol: SymbolId;
}

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

  return (
    <section className="learning-panel">
      <div className="learning-head">
        <h3>Spike-hunt scoreboard</h3>
        <p>
          Tracking Boom/Crash spikes only · cost {cost.toFixed(3)}% rt
        </p>
      </div>

      <div className="learn-grid">
        <Stat label="Live spike win rate" value={pct(spikeLive?.winRate ?? null)} />
        <Stat
          label="After cost"
          value={pct(spikeLive?.winRateAfterCost ?? null)}
        />
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

      <div className="recent-signals">
        <h4>Recent spike hunts</h4>
        <ul>
          {learning.recent
            .filter((s) => s.symbol === symbol && s.kind === "spike_watch")
            .slice(0, 6)
            .map((s) => (
              <li key={s.id} className={`sig-${s.status}`}>
                <strong>Spike hunt</strong>
                <em>{s.status}</em>
                <span>
                  {s.returnNetPct != null
                    ? `net ${s.returnNetPct.toFixed(3)}%`
                    : s.returnPct != null
                      ? `${s.returnPct.toFixed(3)}%`
                      : "…"}
                  {s.source === "bootstrap" ? " · seed" : " · live"}
                  {s.winAfterCost === false && s.status === "win" ? " · cost wipe" : ""}
                </span>
              </li>
            ))}
          {!learning.recent.some(
            (s) => s.symbol === symbol && s.kind === "spike_watch",
          ) && <li className="muted">No spike-hunt rows yet for this market.</li>}
        </ul>
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
