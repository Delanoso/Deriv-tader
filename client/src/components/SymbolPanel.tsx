import type { JournalSignal, LearningSummary, SymbolAnalysis } from "../types";
import { PriceChart, type ChartLevel, type ForecastMarker } from "./PriceChart";
import { useEffect, useMemo, useState } from "react";

const MONITOR_EDGE = 0.7;
/** Highlight pattern strength in the meter when present. */
const MONITOR_PATTERN = 0.55;

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
  const retestHit = analysis.opportunity.confluence?.hits?.find(
    (h) => h.id === "spike_base_retest",
  );
  const patternScore = retestHit?.score ?? 0;
  const patternPct = Math.round(patternScore * 100);
  const patternStrong = patternScore >= MONITOR_PATTERN;
  const shelfPrice =
    retestHit?.shelfPrice ?? analysis.opportunity.confluence?.shelfPrice;

  // Learn-max: show every active hunt / open paper trade — no 70% gate.
  const hunting =
    analysis.opportunity.kind === "spike_watch" && analysis.lastQuote != null;
  const showTrade = hunting || Boolean(openTrade);

  const symbolStats = learning?.bySymbol?.[analysis.symbol]?.overall;
  const winRate = symbolStats?.winRateAfterCost ?? symbolStats?.winRate ?? null;
  const wins = symbolStats?.winsAfterCost ?? symbolStats?.wins ?? 0;
  const losses = symbolStats?.lossesAfterCost ?? symbolStats?.losses ?? 0;
  const decided = wins + losses;

  const levels = useMemo((): ChartLevel[] => {
    const out: ChartLevel[] = [];

    if (openTrade) {
      out.push({ price: openTrade.entryPrice, color: "#7c3aed", title: "Entry" });
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
    } else if (hunting && analysis.spikePlan && analysis.lastQuote != null) {
      out.push({ price: analysis.lastQuote, color: "#7c3aed", title: "Entry" });
      out.push({
        price: analysis.spikePlan.spikeTarget,
        color: "#0d9488",
        title: "Target",
      });
      out.push({
        price: analysis.spikePlan.stretch,
        color: "#2563eb",
        title: "Stretch",
      });
      out.push({
        price: analysis.spikePlan.invalidation,
        color: "#ff6b4a",
        title: "Stop",
      });
    }

    if (shelfPrice != null && (hunting || patternStrong || openTrade)) {
      out.push({
        price: shelfPrice,
        color: "#b45309",
        title: isBoom ? "Spike base" : "Crash ceiling",
      });
    }

    return out;
  }, [
    hunting,
    patternStrong,
    openTrade,
    analysis.spikePlan,
    analysis.lastQuote,
    shelfPrice,
    isBoom,
  ]);

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
        <div
          className={`edge-meter ${
            hunting || edge >= MONITOR_EDGE || patternStrong ? "hot" : ""
          }`}
        >
          <span>{patternStrong ? "Pattern" : "Edge"}</span>
          <strong>{patternStrong ? patternPct : edgePct}</strong>
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
        <Stat
          label={patternStrong ? "Pattern" : "Edge"}
          value={`${patternStrong ? patternPct : edgePct}%`}
          tone={hunting || edge >= MONITOR_EDGE || patternStrong ? "hot" : undefined}
        />
      </div>

      {monitorOpen ? (
        <div className="trade-monitor">
          <div className="trade-monitor-top">
            <span className="monitor-badge">
              {openTrade
                ? "Open paper trade — learning"
                : patternStrong
                  ? `Hunt · pattern ${patternPct}%`
                  : `Hunt · edge ${edgePct}%`}
            </span>
            <span className={`bias-chip bias-${isBoom ? "bullish" : "bearish"}`}>
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
            ) : analysis.lastQuote != null ? (
              <>
                <Level label="Entry" value={fmtPrice(analysis.lastQuote)} />
                <Level
                  label="Target"
                  value={fmtPrice(analysis.spikePlan?.spikeTarget)}
                />
                <Level
                  label="Stop"
                  value={fmtPrice(analysis.spikePlan?.invalidation)}
                />
              </>
            ) : null}
          </div>
          {(analysis.opportunity.confluence?.labels.length ?? 0) > 0 && (
            <p className="confluence-tags">
              Playbooks: {analysis.opportunity.confluence!.labels.join(" · ")}
              {retestHit?.detail ? ` — ${retestHit.detail}` : ""}
            </p>
          )}
        </div>
      ) : (
        <p className="monitor-idle">
          Waiting for the next spike-hunt window
          {patternScore > 0 ? ` · pattern ${patternPct}%` : ""}
          {` · edge ${edgePct}%`}.
          {analysis.opportunity.confluence &&
          analysis.opportunity.confluence.count > 0
            ? ` Playbooks: ${analysis.opportunity.confluence.labels.join(", ")}.`
            : ""}
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
