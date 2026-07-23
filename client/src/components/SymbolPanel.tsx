import type { JournalSignal, LearningSummary, SymbolAnalysis } from "../types";
import { PriceChart, type ChartLevel, type ForecastMarker } from "./PriceChart";
import { useEffect, useMemo, useState } from "react";

const MONITOR_EDGE = 0.7;

interface Props {
  analysis: SymbolAnalysis;
  active: boolean;
  learning?: LearningSummary | null;
}

export function SymbolPanel({ analysis, active, learning }: Props) {
  const [recentTrades, setRecentTrades] = useState<JournalSignal[]>([]);
  const [openTrade, setOpenTrade] = useState<JournalSignal | null>(null);
  const isBoom = analysis.symbol.startsWith("BOOM");
  const accent = isBoom ? "#0d9488" : "#2563eb";

  const edge = analysis.opportunity.edgeScore ?? 0;
  const edgePct = Math.round(edge * 100);
  const showTrade =
    edge >= MONITOR_EDGE &&
    analysis.opportunity.kind === "spike_watch" &&
    analysis.opportunity.policyAllow !== false &&
    Boolean(analysis.spikePlan?.active || analysis.lastQuote != null);

  const symbolStats = learning?.bySymbol?.[analysis.symbol]?.overall;
  const winRate = symbolStats?.winRateAfterCost ?? symbolStats?.winRate ?? null;
  const wins = symbolStats?.winsAfterCost ?? symbolStats?.wins ?? 0;
  const losses = symbolStats?.lossesAfterCost ?? symbolStats?.losses ?? 0;
  const decided = wins + losses;

  const levels = useMemo((): ChartLevel[] => {
    // Open paper trades are always drawn so you can monitor them.
    if (openTrade) {
      const out: ChartLevel[] = [
        { price: openTrade.entryPrice, color: "#7c3aed", title: "Entry" },
      ];
      if (openTrade.target != null) {
        out.push({ price: openTrade.target, color: "#0d9488", title: "Target" });
      }
      if (openTrade.stretch != null) {
        out.push({ price: openTrade.stretch, color: "#2563eb", title: "Stretch" });
      }
      if (openTrade.invalidation != null) {
        out.push({
          price: openTrade.invalidation,
          color: "#ff6b4a",
          title: "Stop",
        });
      }
      return out;
    }

    // Proposed setup only when edge ≥ 70%.
    if (!showTrade || !analysis.spikePlan || analysis.lastQuote == null) return [];
    return [
      { price: analysis.lastQuote, color: "#7c3aed", title: "Entry" },
      {
        price: analysis.spikePlan.spikeTarget,
        color: "#0d9488",
        title: "Target",
      },
      { price: analysis.spikePlan.stretch, color: "#2563eb", title: "Stretch" },
      {
        price: analysis.spikePlan.invalidation,
        color: "#ff6b4a",
        title: "Stop",
      },
    ];
  }, [showTrade, openTrade, analysis.spikePlan, analysis.lastQuote]);

  const tradeMarkers = useMemo((): ForecastMarker[] => {
    if (!openTrade?.entryEpoch) return [];
    const up = openTrade.bias === "bullish" || isBoom;
    return [
      {
        epoch: openTrade.entryEpoch,
        label: "open",
        color: "#7c3aed",
        position: up ? "belowBar" : "aboveBar",
        shape: "circle",
      },
    ];
  }, [openTrade, isBoom]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch(`/api/learning/signals?symbol=${analysis.symbol}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const rows = (data.signals ?? []) as JournalSignal[];
        const liveRows = rows.filter((s) => s.source === "live");
        const pool = liveRows.length ? liveRows : rows;
        setRecentTrades(pool.slice(0, 12));
        setOpenTrade(pool.find((s) => s.status === "pending") ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setRecentTrades([]);
          setOpenTrade(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, analysis.symbol, analysis.updatedAt, learning?.updatedAt]);

  const monitorOpen = Boolean(openTrade) || showTrade;

  return (
    <section
      className={`symbol-panel ${active ? "is-active" : ""}`}
      data-symbol={analysis.symbol}
    >
      <header className="panel-head">
        <div>
          <p className="eyebrow">{analysis.displayName}</p>
          <h2 className="price">
            {analysis.lastQuote?.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 3,
            }) ?? "—"}
          </h2>
        </div>
        <div className={`edge-meter ${edge >= MONITOR_EDGE ? "hot" : ""}`}>
          <span>Edge</span>
          <strong>{edgePct}</strong>
          <em>/ 100</em>
        </div>
      </header>

      <PriceChart
        candles={analysis.candles}
        spikes={analysis.recentSpikes}
        accent={accent}
        levels={levels}
        forecastMarkers={tradeMarkers}
        spikeDirection={isBoom ? "up" : "down"}
      />

      <div className="monitor-stats">
        <Stat
          label="Win %"
          value={
            winRate != null ? `${(winRate * 100).toFixed(0)}%` : decided ? "0%" : "—"
          }
        />
        <Stat label="Wins" value={String(wins)} tone="win" />
        <Stat label="Losses" value={String(losses)} tone="loss" />
        <Stat label="Edge" value={`${edgePct}%`} tone={edge >= MONITOR_EDGE ? "hot" : undefined} />
      </div>

      {monitorOpen ? (
        <div className="trade-monitor">
          <div className="trade-monitor-top">
            <span className="monitor-badge">
              {openTrade
                ? "Open trade — monitor"
                : `Monitor trade · ${edgePct}% edge`}
            </span>
            <span className={`bias-chip bias-${analysis.opportunity.bias}`}>
              {isBoom ? "BUY spike" : "SELL spike"}
            </span>
          </div>
          <div className="trade-levels">
            {openTrade ? (
              <>
                <Level label="Entry" value={fmtPrice(openTrade.entryPrice)} />
                <Level label="Target" value={fmtPrice(openTrade.target)} />
                <Level label="Stop" value={fmtPrice(openTrade.invalidation)} />
              </>
            ) : analysis.spikePlan && analysis.lastQuote != null ? (
              <>
                <Level label="Entry" value={fmtPrice(analysis.lastQuote)} />
                <Level
                  label="Target"
                  value={fmtPrice(analysis.spikePlan.spikeTarget)}
                />
                <Level
                  label="Stop"
                  value={fmtPrice(analysis.spikePlan.invalidation)}
                />
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="monitor-idle">
          No trade to monitor — edge needs {Math.round(MONITOR_EDGE * 100)}%+
          (now {edgePct}%).
        </p>
      )}

      <div className="trade-log">
        <h3>Trades</h3>
        {recentTrades.length === 0 ? (
          <p className="monitor-idle">No paper trades yet for this market.</p>
        ) : (
          <ul>
            {recentTrades.map((t) => (
              <li key={t.id} className={`trade-log-row status-${t.status}`}>
                <span className="sig-status">{outcomeLabel(t)}</span>
                <span className="mono">
                  {fmtPrice(t.entryPrice)}
                  {t.exitPrice != null ? ` → ${fmtPrice(t.exitPrice)}` : ""}
                </span>
                <span className="mono">
                  {t.returnNetPct != null
                    ? `${t.returnNetPct >= 0 ? "+" : ""}${t.returnNetPct.toFixed(2)}%`
                    : "—"}
                </span>
                <span className="note">
                  {new Date(t.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "win" | "loss" | "hot";
}) {
  return (
    <div className={`monitor-stat ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Level({ label, value }: { label: string; value: string }) {
  return (
    <div className="trade-level">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function outcomeLabel(t: JournalSignal): string {
  if (t.status === "pending") return "Open";
  if (t.status === "win") return "Won";
  if (t.status === "loss") return "Lost";
  return "Expired";
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}
