import { useEffect, useMemo, useState } from "react";

type CalcIndexId =
  | "BOOM300N"
  | "BOOM900"
  | "BOOM1000"
  | "CRASH300N"
  | "CRASH900"
  | "CRASH1000"
  | "1HZ250V";

const INDICES: {
  id: CalcIndexId;
  label: string;
  /** Default price-unit for “1 point” on this index. */
  defaultPoint: number;
}[] = [
  { id: "BOOM300N", label: "Boom 300", defaultPoint: 1 },
  { id: "BOOM900", label: "Boom 900", defaultPoint: 1 },
  { id: "BOOM1000", label: "Boom 1000", defaultPoint: 1 },
  { id: "CRASH300N", label: "Crash 300", defaultPoint: 1 },
  { id: "CRASH900", label: "Crash 900", defaultPoint: 1 },
  { id: "CRASH1000", label: "Crash 1000", defaultPoint: 1 },
  { id: "1HZ250V", label: "Volatility 250", defaultPoint: 0.001 },
];

const MULTIPLIERS = [20, 50, 75, 100, 150, 200, 300, 500, 1000];

const MIN_STAKE = 0.1;
const MAX_STAKE = 50_000;

function medianQuoteStep(ticks: { quote: number }[] | undefined): number | null {
  if (!ticks || ticks.length < 5) return null;
  const diffs: number[] = [];
  const start = Math.max(1, ticks.length - 120);
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

/**
 * Deriv Multipliers (pre-commission):
 *   PnL ≈ stake × multiplier × (Δprice / entryPrice)
 * Max loss is capped at stake.
 */
function multiplierPnl(
  stake: number,
  multiplier: number,
  entryPrice: number,
  move: number,
): number {
  if (entryPrice <= 0) return 0;
  return stake * multiplier * (move / entryPrice);
}

export function CalculatorPage() {
  const [index, setIndex] = useState<CalcIndexId>("BOOM1000");
  const [stake, setStake] = useState("1");
  const [multiplier, setMultiplier] = useState("100");
  const [pointsWanted, setPointsWanted] = useState("10");
  const [pointSize, setPointSize] = useState("1");
  const [price, setPrice] = useState<number | null>(null);
  const [quoteStep, setQuoteStep] = useState<number | null>(null);
  const [learnTip, setLearnTip] = useState<string | null>(null);

  useEffect(() => {
    const meta = INDICES.find((i) => i.id === index);
    setPointSize(String(meta?.defaultPoint ?? 1));
  }, [index]);

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
            setQuoteStep(medianQuoteStep(a?.recentTicks));
            const vl = data.vol?.learning;
            const exp = vl?.overallWinRate;
            const hit = vl?.targetHitRate;
            setLearnTip(
              exp != null
                ? `Vol live WR ~${(exp * 100).toFixed(0)}% · target hit ${hit != null ? `${(hit * 100).toFixed(0)}%` : "—"} (research only)`
                : null,
            );
          } else {
            const a = data.symbols?.[index];
            setPrice(a?.lastQuote ?? null);
            setQuoteStep(medianQuoteStep(a?.recentTicks));
            const st = data.learning?.live?.bySymbol?.[index]?.byKind?.spike_watch;
            const exp = st?.decayExpectancyNetPct ?? st?.expectancyNetPct;
            const wr = st?.decayWinRateAfterCost ?? st?.winRateAfterCost;
            const n = (st?.wins ?? 0) + (st?.losses ?? 0);
            const insight = (data.learning?.insights ?? []).find((i: string) =>
              i.startsWith(index),
            );
            const tipCore = st
              ? `Spike-hunt live: exp ${exp != null ? `${exp.toFixed(3)}%` : "—"} · WR ${wr != null ? `${(wr * 100).toFixed(0)}%` : "—"} · n=${n}`
              : null;
            setLearnTip(
              tipCore && insight
                ? `${tipCore} · ${insight.replace(`${index}: `, "")}`
                : tipCore ??
                    (insight ? insight.replace(`${index}: `, "") : null),
            );
          }
        })
        .catch(() => {
          if (!cancelled) {
            setQuoteStep(null);
            setLearnTip(null);
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
  const multN = Number(multiplier);
  const pointsN = Number(pointsWanted);
  const pointSizeN = Number(pointSize);
  const hasPoints = Number.isFinite(pointsN) && pointsN > 0;
  const hasPointSize = Number.isFinite(pointSizeN) && pointSizeN > 0;
  const hasMult = Number.isFinite(multN) && multN > 0;

  const result = useMemo(() => {
    const px = price;
    if (px == null || px <= 0 || !hasMult || !hasPointSize) return null;

    const perPoint = multiplierPnl(stakeN, multN, px, pointSizeN);
    const forPoints = hasPoints
      ? multiplierPnl(stakeN, multN, px, pointSizeN * pointsN)
      : null;
    const perOnePct = stakeN * multN * 0.01;
    const perQuoteStep =
      quoteStep != null && quoteStep > 0
        ? multiplierPnl(stakeN, multN, px, quoteStep)
        : null;

    return {
      perPoint,
      forPoints,
      perOnePct,
      perQuoteStep,
      pointSize: pointSizeN,
      px,
      cappedLoss: stakeN,
    };
  }, [
    price,
    stakeN,
    multN,
    hasMult,
    hasPointSize,
    pointSizeN,
    hasPoints,
    pointsN,
    quoteStep,
  ]);

  const indexLabel = INDICES.find((i) => i.id === index)?.label ?? index;

  return (
    <div className="app calc-app">
      <div className="atmosphere" aria-hidden="true" />

      <header className="hero">
        <div className="brand-lockup">
          <p className="brand">SpikeScope</p>
        </div>
        <h1>Multiplier P&amp;L calculator</h1>
        <p className="lede">
          Deriv Multipliers math: stake × multiplier × (price move ÷ entry).
          Loss is capped at your stake.
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
            Stake
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
              {MIN_STAKE} – {MAX_STAKE.toLocaleString()} · max loss = stake
            </em>
          </label>

          <label>
            Multiplier
            <select
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
            >
              {MULTIPLIERS.map((m) => (
                <option key={m} value={String(m)}>
                  ×{m}
                </option>
              ))}
            </select>
            <em>Match the multiplier you pick on Deriv</em>
          </label>

          <label>
            Point size (price units)
            <input
              type="number"
              min={0.00001}
              step="any"
              value={pointSize}
              onChange={(e) => setPointSize(e.target.value)}
            />
            <em>
              Boom/Crash default 1.0 · Vol 250 default 0.001 — change if you count
              differently
            </em>
          </label>

          <label>
            Points of move
            <input
              type="number"
              min={0}
              step="any"
              value={pointsWanted}
              onChange={(e) => setPointsWanted(e.target.value)}
            />
            <em>How many points you expect the market to move</em>
          </label>
        </div>

        <div className="calc-simple-answer">
          <div className="calc-answer-block">
            <span>
              Per {result ? money(result.pointSize, result.pointSize < 1 ? 4 : 1) : "—"}{" "}
              point
            </span>
            <strong>${money(result?.perPoint ?? null)}</strong>
          </div>
          <div className="calc-answer-block">
            <span>
              {hasPoints
                ? `For ${pointsN} × ${money(pointSizeN, pointSizeN < 1 ? 4 : 1)} pts`
                : "For N points"}
            </span>
            <strong>
              {hasPoints ? `$${money(result?.forPoints ?? null)}` : "—"}
            </strong>
          </div>
          <div className="calc-answer-block">
            <span>Per 1% price move</span>
            <strong>${money(result?.perOnePct ?? null)}</strong>
          </div>
          <div className="calc-answer-block">
            <span>Max loss (capped)</span>
            <strong>${money(result?.cappedLoss ?? stakeN, 2)}</strong>
          </div>
        </div>

        <p className="calc-simple-meta">
          {indexLabel}
          {result
            ? ` · live entry ~${money(result.px, 5)} · ×${multN}`
            : " · waiting for live quote…"}
          {quoteStep != null
            ? ` · typical quote step ~${money(quoteStep, 6)} (≈ $${money(result?.perQuoteStep ?? null)} each)`
            : ""}
        </p>
        <p className="calc-formula">
          Exact Multipliers estimate (before commission / deal fees): stake ×
          multiplier × (Δprice ÷ entry). Example: ${money(stakeN, 2)} × {multN} ×
          (1% ÷ 100%) = ${money(result?.perOnePct ?? null)}. This is not MT5 lot
          tick-value math.
        </p>
        {learnTip && <p className="calc-simple-meta learn-tip">{learnTip}</p>}
      </section>

      <footer className="foot">
        <p>Educational estimate only — not financial advice.</p>
      </footer>
    </div>
  );
}
