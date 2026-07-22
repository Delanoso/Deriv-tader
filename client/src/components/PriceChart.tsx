import { useEffect, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type CandlestickData,
  type LogicalRange,
  type Time,
  CandlestickSeries,
  type IPriceLine,
} from "lightweight-charts";
import type { Candle, SpikeEvent } from "../types";

export interface ChartLevel {
  price: number;
  color: string;
  title: string;
}

export interface ForecastMarker {
  epoch: number;
  label: string;
  color: string;
  /** Prefer belowBar for up-spike targets, aboveBar for down. */
  position?: "aboveBar" | "belowBar";
  shape?: "arrowUp" | "arrowDown" | "circle" | "square";
}

interface Props {
  candles: Candle[];
  spikes: SpikeEvent[];
  accent: string;
  levels?: ChartLevel[];
  forecastMarkers?: ForecastMarker[];
  /** Seconds between candle buckets (used to pad future ETA bars). */
  candleStepSec?: number;
  /** Boom = up spikes, Crash = down spikes. */
  spikeDirection?: "up" | "down";
}

type Marker = {
  time: Time;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text: string;
};

export function PriceChart({
  candles,
  spikes,
  accent,
  levels = [],
  forecastMarkers = [],
  candleStepSec = 60,
  spikeDirection = "up",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  /** Authoritative follow flag — updated synchronously on click. */
  const followRef = useRef(true);
  const savedRangeRef = useRef<LogicalRange | null>(null);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#4a5d6a",
        fontFamily: "Manrope, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(15, 42, 58, 0.06)" },
        horzLines: { color: "rgba(15, 42, 58, 0.06)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        shiftVisibleRangeOnNewBar: followRef.current,
      },
      crosshair: {
        vertLine: { color: "rgba(15,42,58,0.25)", width: 1, style: 2 },
        horzLine: { color: "rgba(15,42,58,0.25)", width: 1, style: 2 },
      },
      height: 360,
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: accent,
      downColor: "#ff6b4a",
      borderUpColor: accent,
      borderDownColor: "#ff6b4a",
      wickUpColor: accent,
      wickDownColor: "#ff6b4a",
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    markersApiRef.current = createSeriesMarkers(candleSeries, []);

    // Remember where the user left the viewport while in free-move mode.
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!followRef.current && range) {
        savedRangeRef.current = range;
      }
    });

    const observer = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      markersApiRef.current?.detach();
      markersApiRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, [accent]);

  useEffect(() => {
    if (!candleSeriesRef.current || !chartRef.current || !markersApiRef.current) {
      return;
    }

    const chart = chartRef.current;
    const series = candleSeriesRef.current;

    // Capture range BEFORE mutating data (setData can clear it).
    if (!followRef.current) {
      const current = chart.timeScale().getVisibleLogicalRange();
      if (current) savedRangeRef.current = current;
    }

    const last = candles[candles.length - 1];
    const lastClose = last?.close ?? 0;
    const step = Math.max(1, candleStepSec);
    const maxFutureEpoch = forecastMarkers.reduce(
      (m, f) => Math.max(m, f.epoch),
      last?.epoch ?? 0,
    );

    const byEpoch = new Map(candles.map((c) => [c.epoch, c]));

    const data: CandlestickData[] = candles.map((c) => ({
      time: c.epoch as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    // Pad flat future bars so ETA markers have a time coordinate to sit on.
    if (last && maxFutureEpoch > last.epoch) {
      let t = Math.floor((last.epoch + step) / step) * step;
      if (t <= last.epoch) t += step;
      while (t <= maxFutureEpoch + step) {
        data.push({
          time: t as Time,
          open: lastClose,
          high: lastClose,
          low: lastClose,
          close: lastClose,
        });
        t += step;
      }
    }

    series.setData(data);

    const histMarkers: Marker[] = [];
    for (const s of spikes) {
      const bucket = Math.floor(s.epoch / step) * step;
      if (!byEpoch.has(bucket)) continue;
      histMarkers.push({
        time: bucket as Time,
        position: spikeDirection === "up" ? "belowBar" : "aboveBar",
        color: "#ff6b4a",
        shape: spikeDirection === "up" ? "arrowUp" : "arrowDown",
        text: "spike",
      });
    }

    const forecastMapped: Marker[] = forecastMarkers
      .map((f) => {
        const bucket = Math.floor(f.epoch / step) * step;
        let time: number | null = null;
        if (byEpoch.has(bucket)) {
          time = bucket;
        } else if (last && bucket > last.epoch && bucket <= maxFutureEpoch + step) {
          time = bucket;
        } else if (candles.length) {
          // Snap trade-entry markers onto the nearest visible candle.
          let best = candles[0].epoch;
          let bestDist = Math.abs(f.epoch - best);
          for (const c of candles) {
            const d = Math.abs(f.epoch - c.epoch);
            if (d < bestDist) {
              best = c.epoch;
              bestDist = d;
            }
          }
          // Only snap when the open is within ~2 candle steps of a bar we have.
          if (bestDist <= step * 2) time = best;
        }
        if (time == null) return null;
        return {
          time: time as Time,
          position: f.position ?? "belowBar",
          color: f.color,
          shape: f.shape ?? "circle",
          text: f.label,
        } satisfies Marker;
      })
      .filter(Boolean) as Marker[];

    const unique = new Map<string, Marker>();
    for (const m of [...histMarkers, ...forecastMapped]) {
      unique.set(`${m.time as number}:${m.text}`, m);
    }

    markersApiRef.current.setMarkers(
      [...unique.values()].sort((a, b) => (a.time as number) - (b.time as number)),
    );

    for (const line of priceLinesRef.current) {
      series.removePriceLine(line);
    }
    priceLinesRef.current = levels.map((level) =>
      series.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: level.title,
      }),
    );

    // Restore viewport after setData. rAF waits until LWC finishes internal layout.
    const applyView = () => {
      if (!chartRef.current) return;
      if (followRef.current) {
        chartRef.current.timeScale().scrollToRealTime();
      } else if (savedRangeRef.current) {
        chartRef.current.timeScale().setVisibleLogicalRange(savedRangeRef.current);
      }
    };
    requestAnimationFrame(applyView);
  }, [candles, spikes, levels, forecastMarkers, candleStepSec, spikeDirection]);

  function toggleFollow() {
    const next = !followRef.current;
    followRef.current = next; // sync before any incoming WS paint
    setFollow(next);

    const chart = chartRef.current;
    if (!chart) return;

    chart.applyOptions({
      timeScale: { shiftVisibleRangeOnNewBar: next },
    });

    if (next) {
      chart.timeScale().scrollToRealTime();
    } else {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (range) savedRangeRef.current = range;
    }
  }

  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <button
          type="button"
          className={follow ? "chart-lock active" : "chart-lock"}
          onClick={toggleFollow}
          title={
            follow
              ? "Chart is locked to the newest candles — click to pan freely"
              : "Chart is free — click to lock back to newest"
          }
        >
          {follow ? "Following live" : "Free move"}
        </button>
        <span className="chart-hint">
          {follow
            ? "Click to release — pan / zoom without snap-back"
            : "Unlocked — pan freely. Click to lock to newest candles"}
        </span>
      </div>
      <div className="chart-shell" ref={containerRef} />
    </div>
  );
}
