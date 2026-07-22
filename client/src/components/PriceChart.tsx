import { useEffect, useRef } from "react";
import {
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
  CandlestickSeries,
} from "lightweight-charts";
import type { Candle, SpikeEvent } from "../types";

interface Props {
  candles: Candle[];
  spikes: SpikeEvent[];
  accent: string;
}

export function PriceChart({ candles, spikes, accent }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

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
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: "rgba(15,42,58,0.25)", width: 1, style: 2 },
        horzLine: { color: "rgba(15,42,58,0.25)", width: 1, style: 2 },
      },
      height: 360,
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
    };
  }, [accent]);

  useEffect(() => {
    if (!candleSeriesRef.current) return;

    const data: CandlestickData[] = candles.map((c) => ({
      time: c.epoch as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeriesRef.current.setData(data);

    const markers = spikes
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
      .filter(Boolean) as {
      time: Time;
      position: "aboveBar";
      color: string;
      shape: "arrowDown";
      text: string;
    }[];

    // Deduplicate by candle time (keep last)
    const unique = new Map<number, (typeof markers)[number]>();
    for (const m of markers) unique.set(m.time as number, m);

    createSeriesMarkers(
      candleSeriesRef.current,
      [...unique.values()].sort((a, b) => (a.time as number) - (b.time as number)),
    );

    chartRef.current?.timeScale().fitContent();
  }, [candles, spikes]);

  return <div className="chart-shell" ref={containerRef} />;
}
