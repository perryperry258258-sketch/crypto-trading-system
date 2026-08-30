"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BinanceLiveFeed, BinanceTicker, ConnectionStatus, DataSourceError as BinanceError, WATCHLIST_PAIRS, fetchKlines, fetchTickersRest } from "./binance";
import { DataSourceError as CoinGeckoError, WATCHLIST_IDS, fetchFearGreed, fetchGlobalMarket, fetchMarketCaps } from "./coingecko";
import { buildIndicatorSet, buildOpportunity, classifyMarketRegime } from "./scoring";
import { computeDailyState } from "./dailyState";
import { computeCapitalState, effectiveMaxRiskPct } from "./phases";
import { CoinSnapshot, FearGreed, GlobalMarketSnapshot, MarketRegime, OpportunityCandidate } from "./types";

const SLOW_REFRESH_MS = 60_000; // 市值/大盤/情緒面：60 秒（配合 CoinGecko 免費版限制）
const SCAN_REFRESH_MS = 5 * 60_000; // 完整技術指標掃描：5 分鐘（規格書 PART16）
const CAPITAL_KEY = "cts_capital_v1";
const PEAK_KEY = "cts_peak_v1";

const PAIR_TO_ID: Record<string, string> = Object.fromEntries(
  WATCHLIST_PAIRS.map((pair) => [pair, WATCHLIST_IDS[pair.replace("USDT", "")]])
);
const PAIR_TO_SYMBOL: Record<string, string> = Object.fromEntries(
  WATCHLIST_PAIRS.map((pair) => [pair, pair.replace("USDT", "")])
);

export function useMarketData() {
  const [capital, setCapitalState] = useState<number>(5000);
  const [peak, setPeak] = useState<number>(5000);
  const [hydrated, setHydrated] = useState(false);

  const [tickers, setTickers] = useState<Record<string, BinanceTicker>>({});
  const [marketCaps, setMarketCaps] = useState<Record<string, number>>({});
  const [global, setGlobal] = useState<GlobalMarketSnapshot | null>(null);
  const [fearGreed, setFearGreed] = useState<FearGreed | null>(null);
  const [candidates, setCandidates] = useState<OpportunityCandidate[]>([]);
  const [regime, setRegime] = useState<MarketRegime>("SIDEWAYS");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("CONNECTING");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastTickAt, setLastTickAt] = useState<Date | null>(null);
  const [scanUpdatedAt, setScanUpdatedAt] = useState<Date | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const closesCache = useRef<Record<string, number[]>>({});
  const tickersRef = useRef<Record<string, BinanceTicker>>({});
  const marketCapsRef = useRef<Record<string, number>>({});
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

  // 建立即時價格 WebSocket（打開網站才連線，離開頁面自動斷開）
  useEffect(() => {
    // 先用 REST 立即取得一份初始快照，避免 WebSocket 建立前畫面空白
    fetchTickersRest()
      .then((data) => {
        tickersRef.current = { ...tickersRef.current, ...data };
        setTickers({ ...tickersRef.current });
      })
      .catch(() => {
        // 忽略，WebSocket 連上後一樣會補上資料
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

  // 市值 / 大盤 / 恐慌貪婪：CoinGecko，60 秒一次
  const loadSlow = useCallback(async () => {
    const errs: string[] = [];
    try {
      const caps = await fetchMarketCaps();
      marketCapsRef.current = caps;
      setMarketCaps(caps);
    } catch (e) {
      errs.push(e instanceof CoinGeckoError ? `市值資料來源異常 (${e.source})` : "市值資料取得失敗");
    }
    try {
      setGlobal(await fetchGlobalMarket());
    } catch (e) {
      errs.push(e instanceof CoinGeckoError ? `大盤資料來源異常 (${e.source})` : "大盤資料取得失敗");
    }
    try {
      setFearGreed(await fetchFearGreed());
    } catch {
      errs.push("恐慌貪婪指數取得失敗");
    }
    if (errs.length) setErrors((prev) => [...new Set([...prev, ...errs])]);
    setLastUpdated(new Date());
  }, []);

  // 技術指標完整掃描：Binance K線，5 分鐘一次
  const loadScan = useCallback(async () => {
    setLoading(true);
    const errs: string[] = [];
    const results: Record<string, number[]> = {};

    for (const pair of WATCHLIST_PAIRS) {
      try {
        const candles = await fetchKlines(pair, "1h", 200);
        results[pair] = candles.map((c) => c.close);
      } catch (e) {
        errs.push(e instanceof BinanceError ? `${PAIR_TO_SYMBOL[pair]} K線資料異常` : `${PAIR_TO_SYMBOL[pair]} K線取得失敗`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    closesCache.current = results;

    const btcCloses = results["BTCUSDT"] ?? [];
    const btcTicker = tickersRef.current["BTCUSDT"];
    const btcIndicators = btcCloses.length > 20 ? buildIndicatorSet(btcCloses) : null;
    const newRegime = classifyMarketRegime(btcTicker?.change24h ?? 0, btcIndicators?.trendScore ?? 50, fearGreed?.value ?? null);

    const built: OpportunityCandidate[] = [];
    WATCHLIST_PAIRS.forEach((pair) => {
      const closes = results[pair];
      const ticker = tickersRef.current[pair];
      const cgId = PAIR_TO_ID[pair];
      if (closes && closes.length > 20 && ticker && global) {
        const coin: CoinSnapshot = {
          id: pair,
          symbol: PAIR_TO_SYMBOL[pair],
          name: PAIR_TO_SYMBOL[pair],
          price: ticker.price,
          change24h: ticker.change24h,
          high24h: ticker.high24h,
          low24h: ticker.low24h,
          volume24h: ticker.quoteVolume24h,
          marketCap: marketCapsRef.current[cgId] ?? 0,
        };
        built.push(buildOpportunity(coin, closes, global, fearGreed, newRegime));
      } else if (!closes || closes.length <= 20) {
        errs.push(`${PAIR_TO_SYMBOL[pair]} 歷史價格資料不足，暫不計分`);
      }
    });
    built.sort((a, b) => b.opportunityScore - a.opportunityScore);
    setCandidates(built);
    setRegime(newRegime);
    setScanUpdatedAt(new Date());
    if (errs.length) setErrors((prev) => [...new Set([...prev, ...errs])]);
    setLoading(false);
  }, [fearGreed, global]);

  const reload = useCallback(async () => {
    setErrors([]);
    await loadSlow();
    await loadScan();
  }, [loadSlow, loadScan]);

  useEffect(() => {
    loadSlow();
    const id = setInterval(loadSlow, SLOW_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 等第一次 slow load（市值/大盤）進來後再跑第一次掃描，Opportunity Score 才有完整資料
    const t = setTimeout(loadScan, 1500);
    const id = setInterval(loadScan, SCAN_REFRESH_MS);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 由目前即時 ticker 組成的幣種快照（給市場頁/首頁顯示用，價格為即時）
  const coins: CoinSnapshot[] = WATCHLIST_PAIRS.filter((p) => tickers[p]).map((pair) => {
    const t = tickers[pair];
    const cgId = PAIR_TO_ID[pair];
    return {
      id: pair,
      symbol: PAIR_TO_SYMBOL[pair],
      name: PAIR_TO_SYMBOL[pair],
      price: t.price,
      change24h: t.change24h,
      high24h: t.high24h,
      low24h: t.low24h,
      volume24h: t.quoteVolume24h,
      marketCap: marketCaps[cgId] ?? 0,
    };
  });

  const btc = coins.find((c) => c.symbol === "BTC");
  const eth = coins.find((c) => c.symbol === "ETH");

  const capitalState = computeCapitalState(capital, peak);
  const maxRisk = effectiveMaxRiskPct(capitalState);
  const daily = computeDailyState(regime, candidates, maxRisk);
  const top3 = candidates.filter((c) => !c.doNotChase).slice(0, 3);
  const dangerous = candidates.filter((c) => c.doNotChase || c.riskFlags.overheated).slice(0, 3);

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
    candidates,
    top3,
    dangerous,
    regime,
    daily,
    capitalState,
    maxRisk,
    connectionStatus,
    lastUpdated,
    lastTickAt,
    scanUpdatedAt,
    errors,
    loading,
    reload,
  };
    }
