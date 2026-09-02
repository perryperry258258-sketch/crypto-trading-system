"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BinanceLiveFeed,
  BinanceTicker,
  ConnectionStatus,
  DataSourceError as BinanceError,
  WATCHLIST_PAIRS,
  fetchTickersRest,
} from "./binance";
import { DataSourceError as CoinGeckoError, fetchFearGreed, fetchGlobalMarket } from "./coingecko";
import { computeCapitalState } from "./phases";
import { CoinSnapshot, FearGreed, GlobalMarketSnapshot } from "./types";

// 中性市場資料 + 資金階段追蹤共用 hook。
//
// 【清理紀錄】原本這裡還會做：技術指標完整掃描（buildOpportunity/classifyMarketRegime）、
// 動態幣種清單（fetchTopVolumePairs）、每日燈號（computeDailyState）、自動開立模擬部位
// （paperTrading.ts，S/A級機會自動進場）。這整套Opportunity Score系統已經被回踩策略
// 引擎取代並移除，這裡只留下：即時價格（WebSocket ticker）、大盤/恐慌貪婪指數（CoinGecko，
// 中性資料）、資金階段追蹤（跟交易策略無關，獨立的風控系統）。
//
// 回踩引擎本身的即時訊號檢查（evaluateLiveSignal）不透過這個hook，各頁面自己直接呼叫
// lib/retestEngine.ts，因為每頁需要的觀察窗口/TP設定可能不同，不適合塞進一個共用hook。

const SLOW_REFRESH_MS = 60_000; // 大盤 / 恐慌貪婪：60 秒
const CAPITAL_KEY = "cts_capital_v1";
const PEAK_KEY = "cts_peak_v1";

export function useMarketData() {
  const [capital, setCapitalState] = useState<number>(5000);
  const [peak, setPeak] = useState<number>(5000);
  const [hydrated, setHydrated] = useState(false);

  const [tickers, setTickers] = useState<Record<string, BinanceTicker>>({});
  const [global, setGlobal] = useState<GlobalMarketSnapshot | null>(null);
  const [fearGreed, setFearGreed] = useState<FearGreed | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("CONNECTING");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastTickAt, setLastTickAt] = useState<Date | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const tickersRef = useRef<Record<string, BinanceTicker>>({});
  const feedRef = useRef<BinanceLiveFeed | null>(null);

  useEffect(() => {
    const c = Number(localStorage.getItem(CAPITAL_KEY)) || 5000;
    const p = Number(localStorage.getItem(PEAK_KEY)) || c;
    setCapitalState(c);
    setPeak(Math.max(c, p));
    setHydrated(true);
  }, []);

  const setCapital = useCallback(
    (val: number) => {
      const p = Math.max(val, peak);
      setCapitalState(val);
      setPeak(p);
      localStorage.setItem(CAPITAL_KEY, String(val));
      localStorage.setItem(PEAK_KEY, String(p));
    },
    [peak]
  );

  // 即時價格 WebSocket（打開網站才連線，離開頁面自動斷開）。固定訂閱8個幣種，不再動態換清單。
  useEffect(() => {
    setLoading(true);
    fetchTickersRest(WATCHLIST_PAIRS)
      .then((data) => {
        tickersRef.current = { ...tickersRef.current, ...data };
        setTickers({ ...tickersRef.current });
        setLoading(false);
      })
      .catch((e) => {
        setErrors((prev) => [...new Set([...prev, e instanceof BinanceError ? `Binance資料異常 (${e.source})` : "Binance資料取得失敗"])]);
        setLoading(false);
      });

    const feed = new BinanceLiveFeed(
      WATCHLIST_PAIRS,
      (tick) => {
        tickersRef.current = { ...tickersRef.current, [tick.symbol]: tick };
        setTickers((prev) => ({ ...prev, [tick.symbol]: tick }));
        setLastTickAt(new Date());
      },
      (status) => setConnectionStatus(status)
    );
    feed.connect();
    feedRef.current = feed;

    return () => feed.disconnect();
  }, []);

  // 大盤總覽 / 恐慌貪婪：CoinGecko，60 秒一次，純資訊參考用途。
  const loadSlow = useCallback(async () => {
    const errs: string[] = [];
    try {
      const g = await fetchGlobalMarket();
      setGlobal(g);
    } catch (e) {
      errs.push(e instanceof CoinGeckoError ? `大盤資料來源異常 (${e.source})` : "大盤資料取得失敗");
    }
    try {
      const fg = await fetchFearGreed();
      setFearGreed(fg);
    } catch {
      errs.push("恐慌貪婪指數取得失敗");
    }
    if (errs.length) setErrors((prev) => [...new Set([...prev, ...errs])]);
    setLastUpdated(new Date());
  }, []);

  const reload = useCallback(async () => {
    setErrors([]);
    await loadSlow();
  }, [loadSlow]);

  useEffect(() => {
    loadSlow();
    const id = setInterval(loadSlow, SLOW_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 由目前即時 ticker 組成的幣種快照
  const coins: CoinSnapshot[] = WATCHLIST_PAIRS.filter((p) => tickers[p]).map((pair) => {
    const t = tickers[pair];
    const symbol = pair.replace("USDT", "");
    return {
      id: pair,
      symbol,
      name: symbol,
      price: t.price,
      change24h: t.change24h,
      high24h: t.high24h,
      low24h: t.low24h,
      volume24h: t.quoteVolume24h,
    };
  });

  const btc = coins.find((c) => c.symbol === "BTC");
  const eth = coins.find((c) => c.symbol === "ETH");

  const capitalState = computeCapitalState(capital, peak);

  return {
    hydrated,
    capital,
    peak,
    setCapital,
    coins,
    btc,
    eth,
    global,
    fearGreed,
    capitalState,
    connectionStatus,
    lastUpdated,
    lastTickAt,
    errors,
    loading,
    reload,
  };
}
