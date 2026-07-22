import { useEffect, useMemo, useState } from "react";

type CalcIndexId =
  | "BOOM300N"
  | "BOOM900"
  | "BOOM1000"
  | "CRASH300N"
  | "CRASH900"
  | "CRASH1000"
  | "1HZ250V";

const INDICES: { id: CalcIndexId; label: string }[] = [
  { id: "BOOM300N", label: "Boom 300" },
  { id: "BOOM900", label: "Boom 900" },
  { id: "BOOM1000", label: "Boom 1000" },
  { id: "CRASH300N", label: "Crash 300" },
  { id: "CRASH900", label: "Crash 900" },
  { id: "CRASH1000", label: "Crash 1000" },
  { id: "1HZ250V", label: "Volatility 250" },
];

/** Fallback tick sizes if live quotes are not ready yet. */
const FALLBACK_TICK: Record<CalcIndexId, number> = {
  BOOM300N: 0.007,
  BOOM900: 0.01,
  BOOM1000: 0.013,
  CRASH300N: 0.014,
  CRASH900: 0.02,
  CRASH1000: 0.005,
  "1HZ250V": 0.00015,
};

const MIN_STAKE = 0.1;
const MAX_STAKE = 50_000;
/** Typical Deriv multiplier used for the $ / tick estimate. */
const DEFAULT_MULTIPLIER = 100;

function medianTickSize(ticks: { quote: number }[] | undefined): number | null {
  if (!ticks || ticks.length < 5) return null;
  const diffs: number[] = [];
  const start = Math.max(1, ticks.length - 80);
  for (let i = start; i < ticks.length; i++) {
    const d = Math.abs(ticks[i].quote - ticks[i - 1].quote);
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) return null;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

function clampStake(n: number): number {
  if (!Number.isFinite(n)) return MIN_STAKE;
  return Math.min(MAX_STAKE, Math.max(MIN_STAKE, n));
}

function money(n: number | null, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function CalculatorPage() {
  const [index, setIndex] = useState<CalcIndexId>("BOOM1000");
  const [stake, setStake] = useState("1");
  const [ticksWanted, setTicksWanted] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [tickSize, setTickSize] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/snapshot")
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          if (index === "1HZ250V") {
            const a = data.vol?.analysis;
            setPrice(a?.lastQuote ?? null);
            setTickSize(medianTickSize(a?.recentTicks) ?? FALLBACK_TICK[index]);
          } else {
            const a = data.symbols?.[index];
            setPrice(a?.lastQuote ?? null);
            setTickSize(medianTickSize(a?.recentTicks) ?? FALLBACK_TICK[index]);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setTickSize(FALLBACK_TICK[index]);
          }
        });
    };
    load();
    const t = window.setInterval(load, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [index]);

  const stakeN = clampStake(Number(stake));
  const ticksN = Number(ticksWanted);
  const hasTicks = Number.isFinite(ticksN) && ticksN > 0;

  const result = useMemo(() => {
    const px = price;
    const tick = tickSize ?? FALLBACK_TICK[index];
    if (px == null || px <= 0 || tick <= 0) return null;
    // Deriv Multipliers-style estimate: stake × multiplier × (Δprice / price)
    const perTick = stakeN * DEFAULT_MULTIPLIER * (tick / px);
    return {
      perTick,
      forTicks: hasTicks ? perTick * ticksN : null,
      tick,
      px,
    };
  }, [price, tickSize, stakeN, hasTicks, ticksN, index]);

  return (
    <div className="app calc-app">
      <div className="atmosphere" aria-hidden="true" />

      <header className="hero">
        <div className="brand-lockup">
          <p className="brand">SpikeScope</p>
        </div>
        <h1>Tick value calculator</h1>
        <p className="lede">
          Pick an index, enter your stake, see about how much each tick is worth
          in dollars.
        </p>
        <div className="cta-row">
          <a className="status-pill soft nav-link" href="/">
            ← Research
          </a>
          <span className="status-pill soft">Calculator</span>
        </div>
      </header>

      <section className="symbol-panel calc-simple">
        <div className="calc-simple-fields">
          <label>
            Index
            <select
              value={index}
              onChange={(e) => setIndex(e.target.value as CalcIndexId)}
            >
              {INDICES.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Position size (stake)
            <input
              type="number"
              min={MIN_STAKE}
              max={MAX_STAKE}
              step="0.1"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              onBlur={() => setStake(String(clampStake(Number(stake))))}
            />
            <em>
              {MIN_STAKE} – {MAX_STAKE.toLocaleString()}
            </em>
          </label>

          <label>
            Ticks (optional)
            <input
              type="number"
              min={1}
              step="1"
              placeholder="e.g. 50"
              value={ticksWanted}
              onChange={(e) => setTicksWanted(e.target.value)}
            />
            <em>Leave blank if you only want $ / tick</em>
          </label>
        </div>

        <div className="calc-simple-answer">
          <div className="calc-answer-block">
            <span>About per tick</span>
            <strong>${money(result?.perTick ?? null)}</strong>
          </div>
          <div className="calc-answer-block">
            <span>
              {hasTicks ? `About for ${Math.round(ticksN)} ticks` : "For N ticks"}
            </span>
            <strong>
              {hasTicks ? `$${money(result?.forTicks ?? null)}` : "—"}
            </strong>
          </div>
        </div>

        <p className="calc-simple-meta">
          {INDICES.find((i) => i.id === index)?.label}
          {result
            ? ` · live ~${money(result.px, 5)} · tick ~${money(result.tick, 6)} · ×${DEFAULT_MULTIPLIER} multiplier estimate`
            : " · waiting for live quote…"}
        </p>
        <p className="calc-formula">
          Close enough estimate: stake × {DEFAULT_MULTIPLIER} × (tick size ÷
          price). Not exact Deriv payout math — good for sizing intuition.
        </p>
      </section>

      <footer className="foot">
        <p>Educational estimate only — not financial advice.</p>
      </footer>
    </div>
  );
}
