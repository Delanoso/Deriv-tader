import type { LearningSummary, SymbolId } from "../types";

interface Props {
  learning: LearningSummary | null;
  symbol: SymbolId;
}

const KIND_LABEL: Record<string, string> = {
  drift_follow: "Drift",
  spike_watch: "Spike watch",
  post_spike: "Post spike",
};

export function LearningPanel({ learning, symbol }: Props) {
  if (!learning) {
    return (
      <section className="learning-panel">
        <h3>Learning loop</h3>
        <p className="muted">Warming journal…</p>
      </section>
    );
  }

  const liveBoard = learning.live.bySymbol[symbol];
  const seedBoard = learning.seed.bySymbol[symbol];
  const liveOverall = liveBoard?.overall;
  const kinds = liveBoard?.byKind ?? {};
  const cost = learning.costPctAssumed;

  return (
    <section className="learning-panel">
      <div className="learning-head">
        <h3>Live scoreboard</h3>
        <p>
          {learning.live.resolved} live resolved · {learning.live.pending} open · cost{" "}
          {cost.toFixed(3)}% rt
        </p>
      </div>

      <div className="learn-grid">
        <Stat label="Live win rate" value={pct(liveOverall?.winRate ?? null)} />
        <Stat
          label="After cost"
          value={pct(liveOverall?.winRateAfterCost ?? null)}
        />
        <Stat
          label="Avg net return"
          value={
            liveOverall?.avgReturnNetPct != null
              ? `${liveOverall.avgReturnNetPct.toFixed(3)}%`
              : "—"
          }
        />
        <Stat
          label="Wins / losses"
          value={`${liveOverall?.wins ?? 0} / ${liveOverall?.losses ?? 0}`}
        />
      </div>

      <div className="kind-rows">
        {(["drift_follow", "spike_watch", "post_spike"] as const).map((kind) => {
          const st = kinds[kind];
          const calibrated = learning.calibrated[symbol]?.[kind];
          const n = (st?.wins ?? 0) + (st?.losses ?? 0);
          return (
            <div className="kind-row" key={kind}>
              <span>{KIND_LABEL[kind]}</span>
              <span>{pct(st?.winRateAfterCost ?? st?.winRate ?? null)}</span>
              <span>
                n={n}
                {calibrated != null ? ` · cal ${(calibrated * 100).toFixed(0)}%` : ""}
              </span>
            </div>
          );
        })}
      </div>

      <div className="seed-box">
        <h4>Seed (bootstrap) — not used for confidence</h4>
        <p>
          {pct(seedBoard?.overallWinRate ?? null)} gross ·{" "}
          {pct(seedBoard?.overallWinRateAfterCost ?? null)} after cost · n=
          {seedBoard?.resolved ?? 0}
        </p>
      </div>

      <div className="recent-signals">
        <h4>Recent journal</h4>
        <ul>
          {learning.recent
            .filter((s) => s.symbol === symbol)
            .slice(0, 6)
            .map((s) => (
              <li key={s.id} className={`sig-${s.status}`}>
                <strong>{KIND_LABEL[s.kind] ?? s.kind}</strong>
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
          {!learning.recent.some((s) => s.symbol === symbol) && (
            <li className="muted">No journal rows for this market yet.</li>
          )}
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
