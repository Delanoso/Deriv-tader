import { useEffect, useMemo, useState } from "react";

export type CalcIndexId =
  | "BOOM300N"
  | "BOOM900"
  | "BOOM1000"
  | "CRASH300N"
  | "CRASH900"
  | "CRASH1000"
  | "1HZ250V";

export const CALC_INDICES: {
  id: CalcIndexId;
  label: string;
  group: "boom" | "crash" | "vol";
}[] = [
  { id: "BOOM300N", label: "Boom 300", group: "boom" },
  { id: "BOOM900", label: "Boom 900", group: "boom" },
  { id: "BOOM1000", label: "Boom 1000", group: "boom" },
  { id: "CRASH300N", label: "Crash 300", group: "crash" },
  { id: "CRASH900", label: "Crash 900", group: "crash" },
  { id: "CRASH1000", label: "Crash 1000", group: "crash" },
  { id: "1HZ250V", label: "Volatility 250", group: "vol" },
];

interface LiveQuotes {
  [id: string]: number | undefined;
}

interface RowInput {
  entry: string;
  stop: string;
  target: string;
}

function num(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function fmt(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function sizeFor(opts: {
  account: number;
  riskPct: number;
  riskDollarsFixed: number | null;
  useFixedRisk: boolean;
  entry: number;
  stop: number;
  target: number | null;
}) {
  const riskDollars = opts.useFixedRisk
    ? opts.riskDollarsFixed
    : (opts.account * opts.riskPct) / 100;
  if (riskDollars == null || riskDollars <= 0) return null;

  const stopDist = Math.abs(opts.entry - opts.stop);
  if (stopDist <= 0) return null;
  const stopPct = (stopDist / opts.entry) * 100;

  // Notional such that a full stop loses ~riskDollars
  const positionNotional = (riskDollars / stopDist) * opts.entry;
  const units = positionNotional / opts.entry;
  const riskReward =
    opts.target != null && Math.abs(opts.target - opts.entry) > 0
      ? Math.abs(opts.target - opts.entry) / stopDist
      : null;
  const rewardDollars =
    riskReward != null ? riskDollars * riskReward : null;

  return {
    riskDollars,
    stopDist,
    stopPct,
    positionNotional,
    units,
    riskReward,
    rewardDollars,
  };
}

export function CalculatorPage() {
  const [quotes, setQuotes] = useState<LiveQuotes>({});
  const [account, setAccount] = useState("1000");
  const [riskPct, setRiskPct] = useState("1");
  const [riskFixed, setRiskFixed] = useState("10");
  const [useFixedRisk, setUseFixedRisk] = useState(false);
  const [active, setActive] = useState<CalcIndexId>("BOOM1000");
  const [rows, setRows] = useState<Record<CalcIndexId, RowInput>>(() => {
    const init = {} as Record<CalcIndexId, RowInput>;
    for (const i of CALC_INDICES) {
      init[i.id] = { entry: "", stop: "", target: "" };
    }
    return init;
  });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/snapshot")
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          const next: LiveQuotes = {};
          for (const i of CALC_INDICES) {
            if (i.id === "1HZ250V") {
              next[i.id] = data.vol?.analysis?.lastQuote ?? undefined;
            } else {
              next[i.id] = data.symbols?.[i.id]?.lastQuote ?? undefined;
            }
          }
          setQuotes(next);
          setRows((prev) => {
            const copy = { ...prev };
            for (const i of CALC_INDICES) {
              const q = next[i.id];
              if (q != null && !copy[i.id].entry) {
                copy[i.id] = {
                  ...copy[i.id],
                  entry: String(q),
                  stop: suggestStop(i.id, q),
                  target: suggestTarget(i.id, q),
                };
              }
            }
            return copy;
          });
        })
        .catch(() => undefined);
    };
    load();
    const t = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const accountN = num(account) ?? 0;
  const riskPctN = num(riskPct) ?? 0;
  const riskFixedN = num(riskFixed);

  const table = useMemo(() => {
    return CALC_INDICES.map((idx) => {
      const row = rows[idx.id];
      const entry = num(row.entry);
      const stop = num(row.stop);
      const target = num(row.target);
      const sized =
        entry != null && stop != null
          ? sizeFor({
              account: accountN,
              riskPct: riskPctN,
              riskDollarsFixed: riskFixedN,
              useFixedRisk,
              entry,
              stop,
              target,
            })
          : null;
      return { idx, row, sized, live: quotes[idx.id] };
    });
  }, [rows, accountN, riskPctN, riskFixedN, useFixedRisk, quotes]);

  const focused = table.find((t) => t.idx.id === active) ?? table[0];

  function patch(id: CalcIndexId, patch: Partial<RowInput>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function pullLive(id: CalcIndexId) {
    const q = quotes[id];
    if (q == null) return;
    patch(id, {
      entry: String(q),
      stop: suggestStop(id, q),
      target: suggestTarget(id, q),
    });
  }

  return (
    <div className="app calc-app">
      <div className="atmosphere" aria-hidden="true" />

      <header className="hero">
        <div className="brand-lockup">
          <p className="brand">SpikeScope</p>
        </div>
        <h1>Position size → dollar risk</h1>
        <p className="lede">
          Size each Boom, Crash, and Volatility 250 trade from account risk and
          stop distance. Same dollar risk, index by index.
        </p>
        <div className="cta-row">
          <a className="status-pill soft nav-link" href="/">
            ← Research
          </a>
          <span className="status-pill soft">Calculator</span>
        </div>
      </header>

      <section className="calc-controls symbol-panel">
        <div className="calc-grid">
          <label>
            Account balance ($)
            <input
              type="number"
              min={0}
              step="1"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </label>
          <label className={useFixedRisk ? "dim" : ""}>
            Risk per trade (%)
            <input
              type="number"
              min={0}
              step="0.1"
              value={riskPct}
              disabled={useFixedRisk}
              onChange={(e) => setRiskPct(e.target.value)}
            />
          </label>
          <label className={!useFixedRisk ? "dim" : ""}>
            Fixed risk ($)
            <input
              type="number"
              min={0}
              step="1"
              value={riskFixed}
              disabled={!useFixedRisk}
              onChange={(e) => setRiskFixed(e.target.value)}
            />
          </label>
          <label className="calc-toggle">
            <input
              type="checkbox"
              checked={useFixedRisk}
              onChange={(e) => setUseFixedRisk(e.target.checked)}
            />
            Use fixed dollar risk
          </label>
        </div>
        <p className="calc-formula">
          Position notional = risk $ ÷ (stop distance ÷ entry). Units = notional ÷
          entry. Optional target shows reward $ and R-multiple.
        </p>
      </section>

      <nav className="tabs" aria-label="Calculator markets">
        {CALC_INDICES.map((i) => (
          <button
            key={i.id}
            type="button"
            className={active === i.id ? "active" : ""}
            onClick={() => setActive(i.id)}
          >
            {i.label}
          </button>
        ))}
      </nav>

      {focused && (
        <section className="symbol-panel calc-focus">
          <header className="panel-head">
            <div>
              <p className="eyebrow">{focused.idx.label}</p>
              <h2 className="price">
                {focused.sized
                  ? `$${fmt(focused.sized.positionNotional, 2)}`
                  : "—"}
              </h2>
              <p className="muted">Suggested position notional</p>
            </div>
            <button
              type="button"
              className="chart-lock"
              onClick={() => pullLive(focused.idx.id)}
            >
              Use live quote
            </button>
          </header>

          <div className="calc-grid three">
            <label>
              Entry
              <input
                type="number"
                step="any"
                value={focused.row.entry}
                onChange={(e) => patch(focused.idx.id, { entry: e.target.value })}
              />
            </label>
            <label>
              Stop / invalidation
              <input
                type="number"
                step="any"
                value={focused.row.stop}
                onChange={(e) => patch(focused.idx.id, { stop: e.target.value })}
              />
            </label>
            <label>
              Target (optional)
              <input
                type="number"
                step="any"
                value={focused.row.target}
                onChange={(e) =>
                  patch(focused.idx.id, { target: e.target.value })
                }
              />
            </label>
          </div>

          <div className="learn-grid calc-results">
            <Stat
              label="Dollar risk"
              value={
                focused.sized ? `$${fmt(focused.sized.riskDollars, 2)}` : "—"
              }
            />
            <Stat
              label="Stop distance"
              value={
                focused.sized
                  ? `${fmt(focused.sized.stopDist, 5)} (${fmt(focused.sized.stopPct, 3)}%)`
                  : "—"
              }
            />
            <Stat
              label="Units / stake basis"
              value={focused.sized ? fmt(focused.sized.units, 4) : "—"}
            />
            <Stat
              label="R : R"
              value={
                focused.sized?.riskReward != null
                  ? `1 : ${fmt(focused.sized.riskReward, 2)}`
                  : "—"
              }
            />
            <Stat
              label="Reward if target hits"
              value={
                focused.sized?.rewardDollars != null
                  ? `$${fmt(focused.sized.rewardDollars, 2)}`
                  : "—"
              }
            />
            <Stat
              label="Live quote"
              value={focused.live != null ? fmt(focused.live, 5) : "—"}
            />
          </div>
        </section>
      )}

      <section className="trade-book calc-table-panel">
        <div className="learning-head">
          <h3>All indices — same dollar risk</h3>
          <p>
            Edit any row. Stops default from a typical % buffer; adjust to your
            invalidation.
          </p>
        </div>
        <div className="trade-table-wrap">
          <table className="trade-table">
            <thead>
              <tr>
                <th>Index</th>
                <th>Entry</th>
                <th>Stop</th>
                <th>Target</th>
                <th>Risk $</th>
                <th>Position $</th>
                <th>Units</th>
                <th>R:R</th>
              </tr>
            </thead>
            <tbody>
              {table.map(({ idx, row, sized }) => (
                <tr key={idx.id} className={idx.id === active ? "is-focus" : ""}>
                  <td>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => setActive(idx.id)}
                    >
                      {idx.label}
                    </button>
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      type="number"
                      step="any"
                      value={row.entry}
                      onChange={(e) => patch(idx.id, { entry: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      type="number"
                      step="any"
                      value={row.stop}
                      onChange={(e) => patch(idx.id, { stop: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      type="number"
                      step="any"
                      value={row.target}
                      onChange={(e) => patch(idx.id, { target: e.target.value })}
                    />
                  </td>
                  <td className="mono">
                    {sized ? `$${fmt(sized.riskDollars, 2)}` : "—"}
                  </td>
                  <td className="mono">
                    {sized ? `$${fmt(sized.positionNotional, 2)}` : "—"}
                  </td>
                  <td className="mono">{sized ? fmt(sized.units, 4) : "—"}</td>
                  <td className="mono">
                    {sized?.riskReward != null
                      ? `1:${fmt(sized.riskReward, 2)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="foot">
        <p>
          Educational sizing only — not financial advice. Contract payout rules on
          Deriv can differ from raw notional; treat this as a risk budget guide.
        </p>
      </footer>
    </div>
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

/** Rough default stop: Boom below, Crash above, Vol ±0.8%. */
function suggestStop(id: CalcIndexId, entry: number): string {
  if (id.startsWith("BOOM")) return String(Number((entry * 0.997).toFixed(5)));
  if (id.startsWith("CRASH")) return String(Number((entry * 1.003).toFixed(5)));
  return String(Number((entry * 0.992).toFixed(5)));
}

function suggestTarget(id: CalcIndexId, entry: number): string {
  if (id.startsWith("BOOM")) return String(Number((entry * 1.006).toFixed(5)));
  if (id.startsWith("CRASH")) return String(Number((entry * 0.994).toFixed(5)));
  return String(Number((entry * 1.012).toFixed(5)));
}
