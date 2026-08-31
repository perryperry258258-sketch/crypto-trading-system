"use client";

import { useEffect, useRef, useState } from "react";
import { fetchKlines } from "@/lib/binance";
import { ema } from "@/lib/indicators";

const TIMEFRAMES: { label: string; interval: string }[] = [
  { label: "1m", interval: "1m" },
  { label: "5m", interval: "5m" },
  { label: "15m", interval: "15m" },
  { label: "1H", interval: "1h" },
  { label: "4H", interval: "4h" },
  { label: "1D", interval: "1d" },
];

export interface TradePlanLines {
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
}

export default function PriceChart({ symbol, plan }: { symbol: string; plan?: TradePlanLines }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const ema20SeriesRef = useRef<any>(null);
  const ema50SeriesRef = useRef<any>(null);
  const priceLinesRef = useRef<any[]>([]);

  const [interval, setIntervalStr] = useState("1h");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastCandleTime, setLastCandleTime] = useState<number | null>(null);

  // 建立圖表（只做一次）
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    import("lightweight-charts").then(({ createChart, ColorType, CrosshairMode }) => {
      if (disposed || !containerRef.current) return;

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 240,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#8A93A6",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "#1a1f2b" },
          horzLines: { color: "#1a1f2b" },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: "#232937" },
        timeScale: { borderColor: "#232937", timeVisible: true },
        handleScroll: true,
        handleScale: true,
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: "#20C97A",
        downColor: "#F0475B",
        borderVisible: false,
        wickUpColor: "#20C97A",
        wickDownColor: "#F0475B",
      });

      const volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "",
        color: "#4C8DFF55",
      });
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      const ema20Series = chart.addLineSeries({ color: "#E8B341", lineWidth: 1 });
      const ema50Series = chart.addLineSeries({ color: "#4C8DFF", lineWidth: 1 });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;
      ema20SeriesRef.current = ema20Series;
      ema50SeriesRef.current = ema50Series;

      const resizeObserver = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
      });
      resizeObserver.observe(containerRef.current);

      (chart as any).__resizeObserver = resizeObserver;
    });

    return () => {
      disposed = true;
      if (chartRef.current) {
        (chartRef.current as any).__resizeObserver?.disconnect();
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // 抓資料 + 更新圖表（symbol / interval 變更時）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      // 等圖表初始化完成
      let tries = 0;
      while (!candleSeriesRef.current && tries < 40) {
        await new Promise((r) => setTimeout(r, 50));
        tries++;
      }
      if (!candleSeriesRef.current || cancelled) return;

      try {
        const candles = await fetchKlines(symbol, interval, 200);
        if (cancelled) return;

        candleSeriesRef.current.setData(
          candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
        );
        volumeSeriesRef.current?.setData(
          candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "#20C97A55" : "#F0475B55" }))
        );

        const closes = candles.map((c) => c.close);
        const ema20 = ema(closes, 20);
        const ema50 = ema(closes, 50);
        ema20SeriesRef.current?.setData(candles.map((c, i) => ({ time: c.time, value: ema20[i] })));
        ema50SeriesRef.current?.setData(candles.map((c, i) => ({ time: c.time, value: ema50[i] })));

        // 清除舊的進場/停損/止盈線再重畫
        priceLinesRef.current.forEach((l) => candleSeriesRef.current.removePriceLine(l));
        priceLinesRef.current = [];
        if (plan) {
          const lines = [
            { price: plan.entryLow, color: "#4C8DFF", title: "Entry" },
            { price: plan.stopLoss, color: "#F0475B", title: "Stop" },
            { price: plan.tp1, color: "#E8B341", title: "TP1" },
            { price: plan.tp2, color: "#E8B341", title: "TP2" },
            { price: plan.tp3, color: "#E8B341", title: "TP3" },
          ];
          lines.forEach((l) => {
            const line = candleSeriesRef.current.createPriceLine({
              price: l.price,
              color: l.color,
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
              title: l.title,
            });
            priceLinesRef.current.push(line);
          });
        }

        setLastCandleTime(candles.length ? candles[candles.length - 1].time : null);
        chartRef.current?.timeScale().fitContent();
      } catch (e) {
        if (!cancelled) setError("K線資料取得失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [symbol, interval, plan]);

  return (
    <div className="rounded-2xl border border-border bg-panel p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-display font-semibold text-sm">{symbol}</span>
        <div className="flex gap-1 overflow-x-auto">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.interval}
              onClick={() => setIntervalStr(tf.interval)}
              className={`text-xs px-2 py-1 rounded-md shrink-0 ${
                interval === tf.interval ? "bg-accent/20 text-accent" : "text-subtext"
              }`}
              style={{ minHeight: 28 }}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} style={{ width: "100%", height: 240 }} />

      {error && <div className="text-xs text-warn mt-2">⚠️ {error}</div>}

      <div className="flex items-center justify-between mt-2 text-[11px] text-subtext">
        <span>資料來源：Binance</span>
        <span>
          {loading
            ? "載入中…"
            : lastCandleTime
            ? `最後K線: ${new Date(lastCandleTime * 1000).toLocaleString()}`
            : "—"}
        </span>
      </div>
    </div>
  );
}
