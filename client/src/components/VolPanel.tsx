import { useEffect, useMemo, useState } from "react";
import type { VolAnalysis, VolJournalSignal, VolLearningSummary } from "../types";
import { PriceChart, type ChartLevel, type ForecastMarker } from "./PriceChart";

const MONITOR_EDGE = 0.7;

interface Props {
  analysis: VolAnalysis;
  learning?: VolLearningSummary | null;
}

export function VolPanel({ analysis, learning }: Props) {
  const pred = analysis.prediction;
  const edge = pred.calibratedConfidence ?? pred.confidence;
  const edgePct = Math.round(edge * 100);
  const accent = pred.bias === "down" ? "#2563eb" : "#0d9488";
  const [recentTrades, setRecentTrades] = useState<VolJournalSignal[]>([]);
  const [openTrade, setOpenTrade] = useState<VolJournalSignal | null>(null);

  const showTrade =
    edge >= MONITOR_EDGE && pred.bias !== "neutral" && analysis.lastQuote != null;

  const wins =
    (learning?.byBias?.up?.winsAfterCost ?? learning?.byBias?.up?.wins ?? 0) +
    (learning?.byBias?.down?.winsAfterCost ?? learning?.byBias?.down?.wins ?? 0);
  const losses =
    (learning?.byBias?.up?.lossesAfterCost ?? learning?.byBias?.up?.losses ?? 0) +
    (learning?.byBias?.down?.lossesAfterCost ??
      learning?.byBias?.down?.losses ??
      0);
  const winRate = learning?.overallWinRate ?? null;
  const decided = wins + losses;

  const levels = useMemo((): ChartLevel[] => {
    if (openTrade) {
      return [
        { price: openTrade.entryPrice, color: "#7c3aed", title: "Entry" },
        { price: openTrade.target, color: "#0d9488", title: "Target" },
        { price: openTrade.stretch, color: "#2563eb", title: "Stretch" },
        {
          price: openTrade.invalidation,
          color: "#ff6b4a",
          title: "Stop",
        },
      ];
    }

    if (!showTrade || analysis.lastQuote == null) return [];
    return [
      { price: analysis.lastQuote, color: "#7c3aed", title: "Entry" },
      { price: pred.targets.target, color: "#0d9488", title: "Target" },
      { price: pred.targets.stretch, color: "#2563eb", title: "Stretch" },
      {
        price: pred.targets.invalidation,
        color: "#ff6b4a",
        title: "Stop",
      },
    ];
  }, [showTrade, openTrade, analysis.lastQuote, pred.targets]);

  const tradeMarkers = useMemo((): ForecastMarker[] => {
    if (!openTrade?.entryEpoch) return [];
    const up = openTrade.bias === "up";
    return [
      {
        epoch: openTrade.entryEpoch,
        label: "open",
        color: "#7c3aed",
        position: up ? "belowBar" : "aboveBar",
        shape: "circle",
      },
    ];
  }, [openTrade]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/vol/signals")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const rows = (data.signals ?? []) as VolJournalSignal[];
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
  }, [analysis.updatedAt, learning?.updatedAt]);

  const monitorOpen = Boolean(openTrade) || showTrade;

  return (
    <section className="symbol-panel is-active" data-symbol={analysis.symbol}>
      <header className="panel-head">
        <div>
          <p className="eyebrow">{analysis.displayName}</p>
          <h2 className="price">
            {analysis.lastQuote?.toLocaleString(undefined, {
              minimumFractionDigits: 3,
              maximumFractionDigits: 5,
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
        spikes={[]}
        accent={accent}
        levels={levels}
        forecastMarkers={tradeMarkers}
        candleStepSec={analysis.timeframe?.candleSec ?? 60}
      />

      <div className="monitor-stats">
        <Stat
          label="Win %"
          value={
            winRate != null
              ? `${(winRate * 100).toFixed(0)}%`
              : decided
                ? "0%"
                : "—"
          }
        />
        <Stat label="Wins" value={String(wins)} tone="win" />
        <Stat label="Losses" value={String(losses)} tone="loss" />
        <Stat
          label="Edge"
          value={`${edgePct}%`}
          tone={edge >= MONITOR_EDGE ? "hot" : undefined}
        />
      </div>

      {monitorOpen ? (
        <div className="trade-monitor">
          <div className="trade-monitor-top">
            <span className="monitor-badge">
              {openTrade
                ? "Open trade — monitor"
                : `Monitor trade · ${edgePct}% edge`}
            </span>
            <span className={`bias-chip bias-${pred.bias}`}>
              {pred.bias === "up" ? "BUY" : pred.bias === "down" ? "SELL" : "FLAT"}
            </span>
          </div>
          <div className="trade-levels">
            {openTrade ? (
              <>
                <Level label="Entry" value={fmtPrice(openTrade.entryPrice)} />
                <Level label="Target" value={fmtPrice(openTrade.target)} />
                <Level label="Stop" value={fmtPrice(openTrade.invalidation)} />
              </>
            ) : analysis.lastQuote != null ? (
              <>
                <Level label="Entry" value={fmtPrice(analysis.lastQuote)} />
                <Level label="Target" value={fmtPrice(pred.targets.target)} />
                <Level
                  label="Stop"
                  value={fmtPrice(pred.targets.invalidation)}
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
          <p className="monitor-idle">No paper trades yet for Volatility 250.</p>
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

function outcomeLabel(t: VolJournalSignal): string {
  if (t.status === "pending") return "Open";
  if (t.status === "win") return "Won";
  if (t.status === "loss") return "Lost";
  return "Expired";
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 5,
  });
}
