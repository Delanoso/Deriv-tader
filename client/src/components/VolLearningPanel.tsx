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

  return (
    <section className="learning-panel">
      <div className="learning-head">
        <h3>Vol 250 scoreboard</h3>
        <p>Direction calls scored to target / invalidation / horizon</p>
      </div>

      <div className="learn-grid">
        <Stat label="Overall win rate" value={pct(learning.overallWinRate)} />
        <Stat label="Target hit rate" value={pct(learning.targetHitRate)} />
        <Stat label="Resolved" value={String(learning.resolved)} />
        <Stat label="Pending" value={String(learning.pending)} />
      </div>

      <div className="kind-rows">
        <div className="kind-row">
          <span>Up calls</span>
          <span>{pct(up.winRate)}</span>
          <span>
            n={up.wins + up.losses}
            {learning.calibrated.up != null
              ? ` · cal ${(learning.calibrated.up * 100).toFixed(0)}%`
              : ""}
          </span>
        </div>
        <div className="kind-row">
          <span>Down calls</span>
          <span>{pct(down.winRate)}</span>
          <span>
            n={down.wins + down.losses}
            {learning.calibrated.down != null
              ? ` · cal ${(learning.calibrated.down * 100).toFixed(0)}%`
              : ""}
          </span>
        </div>
      </div>

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
    </section>
  );
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
