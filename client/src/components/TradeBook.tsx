import { useEffect, useMemo, useState } from "react";
import type { JournalSignal, SymbolId, VolJournalSignal } from "../types";

type AnyTrade = JournalSignal | VolJournalSignal;

interface SpikeProps {
  mode: "spike";
  symbol: SymbolId;
  refreshKey?: number;
}

interface VolProps {
  mode: "vol";
  refreshKey?: number;
}

type Props = SpikeProps | VolProps;

const SYMBOL_LABEL: Record<SymbolId, string> = {
  BOOM300N: "Boom 300",
  BOOM900: "Boom 900",
  BOOM1000: "Boom 1000",
  CRASH300N: "Crash 300",
  CRASH900: "Crash 900",
  CRASH1000: "Crash 1000",
};

export function TradeBook(props: Props) {
  const [trades, setTrades] = useState<AnyTrade[]>([]);
  const [filter, setFilter] = useState<"all" | "live" | "seed" | "pending">("all");
  const [loading, setLoading] = useState(true);

  const refreshKey = props.refreshKey ?? 0;
  const mode = props.mode;
  const symbol = props.mode === "spike" ? props.symbol : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url =
      mode === "spike"
        ? `/api/learning/signals?symbol=${symbol}`
        : `/api/vol/signals`;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setTrades(Array.isArray(data.signals) ? data.signals : []);
      })
      .catch(() => {
        if (!cancelled) setTrades([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, symbol, refreshKey]);

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (filter === "live") return t.source === "live";
      if (filter === "seed") return t.source === "bootstrap";
      if (filter === "pending") return t.status === "pending";
      return true;
    });
  }, [trades, filter]);

  const counts = useMemo(() => {
    const wins = trades.filter((t) => t.status === "win").length;
    const losses = trades.filter((t) => t.status === "loss").length;
    const pending = trades.filter((t) => t.status === "pending").length;
    const stopouts = trades.filter(
      (t) =>
        ("outcome" in t && t.outcome === "stopout") ||
        ("hitInvalidation" in t && t.hitInvalidation),
    ).length;
    return { wins, losses, pending, stopouts, total: trades.length };
  }, [trades]);

  const title =
    mode === "spike" && symbol
      ? `Paper trades · ${SYMBOL_LABEL[symbol]}`
      : "Paper trades · Volatility 250";

  return (
    <section className="trade-book">
      <div className="learning-head">
        <h3>{title}</h3>
        <p>
          Dummy entries the app would take — target hits, stopouts, and expiries.
          Live rows feed learning; seed is history warmup.
        </p>
      </div>

      <div className="learn-grid">
        <Stat label="Trades" value={String(counts.total)} />
        <Stat label="Wins" value={String(counts.wins)} />
        <Stat label="Losses" value={String(counts.losses)} />
        <Stat label="Stopouts" value={String(counts.stopouts)} />
      </div>

      <div className="trade-filters">
        {(["all", "live", "seed", "pending"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={filter === f ? "active" : ""}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="trade-table-wrap">
        {loading ? (
          <p className="muted">Loading trades…</p>
        ) : (
          <table className="trade-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Side</th>
                <th>Entry</th>
                <th>Target</th>
                <th>Stop</th>
                <th>Exit</th>
                <th>Result</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <TradeRow key={t.id} trade={t} />
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={8} className="muted">
                    No paper trades yet for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function TradeRow({ trade }: { trade: AnyTrade }) {
  const side =
    "kind" in trade
      ? trade.bias === "bullish"
        ? "UP spike"
        : trade.bias === "bearish"
          ? "DOWN spike"
          : trade.bias
      : trade.bias === "up"
        ? "UP"
        : trade.bias === "down"
          ? "DOWN"
          : trade.bias;

  const target = "target" in trade ? trade.target : undefined;
  const stop = "invalidation" in trade ? trade.invalidation : undefined;
  const outcome =
    "outcome" in trade && trade.outcome
      ? trade.outcome
      : trade.hitTarget
        ? "target"
        : trade.hitInvalidation
          ? "stopout"
          : trade.status === "pending"
            ? "open"
            : trade.status;

  const result =
    "returnNetPct" in trade && trade.returnNetPct != null
      ? `net ${trade.returnNetPct.toFixed(3)}%`
      : trade.returnPct != null
        ? `${trade.returnPct.toFixed(3)}%`
        : "…";

  return (
    <tr className={`trade-row status-${trade.status} outcome-${outcome}`}>
      <td>
        <span className={`sig-status ${trade.status}`}>{trade.status}</span>
        <em className="outcome-tag">{outcome}</em>
        {trade.source === "bootstrap" ? <em className="seed-tag">seed</em> : null}
      </td>
      <td>{side}</td>
      <td className="mono">{fmtPx(trade.entryPrice)}</td>
      <td className="mono">{target != null ? fmtPx(target) : "—"}</td>
      <td className="mono">{stop != null ? fmtPx(stop) : "—"}</td>
      <td className="mono">
        {trade.exitPrice != null ? fmtPx(trade.exitPrice) : "—"}
      </td>
      <td className="mono">{result}</td>
      <td className="note">{trade.note ?? "—"}</td>
    </tr>
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

function fmtPx(n: number): string {
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(5);
}
