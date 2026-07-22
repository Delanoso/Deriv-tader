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

  const sym = learning.bySymbol[symbol];
  const overall = sym?.overall;
  const kinds = sym?.byKind ?? {};

  return (
    <section className="learning-panel">
      <div className="learning-head">
        <h3>Learning loop</h3>
        <p>
          {learning.resolved} resolved · {learning.pending} pending · overall{" "}
          {pct(learning.overallWinRate)}
        </p>
      </div>

      <div className="learn-grid">
        <Stat label={`${symbol} win rate`} value={pct(overall?.winRate ?? null)} />
        <Stat
          label="Avg return"
          value={
            overall?.avgReturnPct != null
              ? `${overall.avgReturnPct.toFixed(3)}%`
              : "—"
          }
        />
        <Stat label="Wins / losses" value={`${overall?.wins ?? 0} / ${overall?.losses ?? 0}`} />
      </div>

      <div className="kind-rows">
        {(["drift_follow", "spike_watch", "post_spike"] as const).map((kind) => {
          const st = kinds[kind];
          const calibrated = learning.calibrated[symbol]?.[kind];
          return (
            <div className="kind-row" key={kind}>
              <span>{KIND_LABEL[kind]}</span>
              <span>{pct(st?.winRate ?? null)}</span>
              <span>
                n={(st?.wins ?? 0) + (st?.losses ?? 0)}
                {calibrated != null ? ` · cal ${(calibrated * 100).toFixed(0)}%` : ""}
              </span>
            </div>
          );
        })}
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
                  {s.returnPct != null ? `${s.returnPct.toFixed(3)}%` : "…"}
                  {s.source === "bootstrap" ? " · seed" : ""}
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
