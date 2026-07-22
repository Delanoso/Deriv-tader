import { useEffect, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
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
}

export function PriceChart({
  candles,
  spikes,
  accent,
  levels = [],
  forecastMarkers = [],
  candleStepSec = 60,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const followRef = useRef(true);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

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

    const observer = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, [accent]);

  useEffect(() => {
    if (!candleSeriesRef.current || !chartRef.current) return;

    const preserved = followRef.current
      ? null
      : chartRef.current.timeScale().getVisibleLogicalRange();

    const last = candles[candles.length - 1];
    const lastClose = last?.close ?? 0;
    const step = Math.max(1, candleStepSec);
    const maxFutureEpoch = forecastMarkers.reduce(
      (m, f) => Math.max(m, f.epoch),
      last?.epoch ?? 0,
    );

    const data: CandlestickData[] = candles.map((c) => ({
      time: c.epoch as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    // Pad flat future bars so ETA markers have a time coordinate to sit on.
    if (last && maxFutureEpoch > last.epoch) {
      let t = last.epoch + step;
      // Align to bucket
      t = Math.floor(t / step) * step;
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

    candleSeriesRef.current.setData(data);

    type Marker = {
      time: Time;
      position: "aboveBar" | "belowBar";
      color: string;
      shape: "arrowUp" | "arrowDown" | "circle" | "square";
      text: string;
    };

    const histMarkers: Marker[] = spikes
      .map((s) => {
        const candle = candles.reduce(
          (best, c) =>
            Math.abs(c.epoch - s.epoch) < Math.abs(best.epoch - s.epoch) ? c : best,
          candles[0],
        );
        if (!candle) return null;
        return {
          time: candle.epoch as Time,
          position: "aboveBar" as const,
          color: "#ff6b4a",
          shape: "arrowDown" as const,
          text: "spike",
        };
      })
      .filter(Boolean) as Marker[];

    const forecastMapped: Marker[] = forecastMarkers.map((f) => {
      const bucket = Math.floor(f.epoch / step) * step;
      return {
        time: bucket as Time,
        position: f.position ?? "belowBar",
        color: f.color,
        shape: f.shape ?? "circle",
        text: f.label,
      };
    });

    const unique = new Map<string, Marker>();
    for (const m of [...histMarkers, ...forecastMapped]) {
      unique.set(`${m.time}:${m.text}`, m);
    }

    createSeriesMarkers(
      candleSeriesRef.current,
      [...unique.values()].sort((a, b) => (a.time as number) - (b.time as number)),
    );

    for (const line of priceLinesRef.current) {
      candleSeriesRef.current.removePriceLine(line);
    }
    priceLinesRef.current = levels.map((level) =>
      candleSeriesRef.current!.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: level.title,
      }),
    );

    if (followRef.current) {
      chartRef.current.timeScale().scrollToRealTime();
    } else if (preserved) {
      chartRef.current.timeScale().setVisibleLogicalRange(preserved);
    }
  }, [candles, spikes, levels, forecastMarkers, candleStepSec]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (follow) {
      chartRef.current.timeScale().scrollToRealTime();
    }
  }, [follow]);

  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <button
          type="button"
          className={follow ? "chart-lock active" : "chart-lock"}
          onClick={() => setFollow((v) => !v)}
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
            ? "Release to pan / zoom without snap-back"
            : "Lock to jump back to the newest candles"}
        </span>
      </div>
      <div className="chart-shell" ref={containerRef} />
    </div>
  );
}
