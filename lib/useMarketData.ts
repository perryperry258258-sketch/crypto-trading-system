"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BinanceLiveFeed,
  BinanceTicker,
  ConnectionStatus,
  DataSourceError as BinanceError,
  WATCHLIST_PAIRS,
  fetchKlines,
  fetchTickersRest,
  fetchTopVolumePairs,
} from "./binance";
import { DataSourceError as CoinGeckoError, fetchFearGreed, fetchGlobalMarket } from "./coingecko";
import { buildIndicatorSet, buildOpportunity, classifyMarketRegime } from "./scoring";
import { computeDailyState } from "./dailyState";
import { computeCapitalState, effectiveMaxRiskPct } from "./phases";
import { CoinSnapshot, FearGreed, GlobalMarketSnapshot, MarketRegime, OpportunityCandidate } from "./types";
import {
  PaperPosition,
  PaperTrade,
  checkPositions,
  computePaperStats,
  loadClosedTrades,
  loadOpenPositions,
  openPositionFromCandidate,
  saveClosedTrades,
  saveOpenPositions,
} from "./paperTrading";
import {
  NotificationPermissionStatus,
  getNotificationPermission,
  requestNotificationPermission,
  showNotification,
} from "./notifications";

const SLOW_REFRESH_MS = 60_000; // 大盤 / 恐慌貪婪：60 秒（僅供市場頁參考，不影響幣種評分）
const SCAN_REFRESH_MS = 5 * 60_000; // 完整技術指標掃描：5 分鐘（規格書 PART16）
const WATCHLIST_REFRESH_MS = 30 * 60_000; // 動態幣種清單：30 分鐘重新抓一次成交額排名
const CAPITAL_KEY = "cts_capital_v1";
const PEAK_KEY = "cts_peak_v1";

export function useMarketData() {
  const [capital, setCapitalState] = useState<number>(5000);
  const [peak, setPeak] = useState<number>(5000);
  const [hydrated, setHydrated] = useState(false);

  const [activePairs, setActivePairs] = useState<string[]>(WATCHLIST_PAIRS);
  const [tickers, setTickers] = useState<Record<string, BinanceTicker>>({});
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
  const [paperOpen, setPaperOpen] = useState<PaperPosition[]>([]);
  const [paperClosed, setPaperClosed] = useState<PaperTrade[]>([]);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionStatus>("default");

  const paperOpenRef = useRef<PaperPosition[]>([]);
  const paperClosedRef = useRef<PaperTrade[]>([]);
  const activePairsRef = useRef<string[]>(WATCHLIST_PAIRS);

  const closesCache = useRef<Record<string, number[]>>({});
  const tickersRef = useRef<Record<string, BinanceTicker>>({});
  const globalRef = useRef<GlobalMarketSnapshot | null>(null);
  const fearGreedRef = useRef<FearGreed | null>(null);
  const feedRef = useRef<BinanceLiveFeed | null>(null);

  useEffect(() => {
    const c = Number(localStorage.getItem(CAPITAL_KEY)) || 5000;
    const p = Number(localStorage.getItem(PEAK_KEY)) || c;
    setCapitalState(c);
    setPeak(Math.max(c, p));
    setHydrated(true);

    paperOpenRef.current = loadOpenPositions();
    setPaperOpen(paperOpenRef.current);
    paperClosedRef.current = loadClosedTrades();
    setPaperClosed(paperClosedRef.current);
    setNotificationPermission(getNotificationPermission());
  }, []);

  const requestNotifications = useCallback(async () => {
    const status = await requestNotificationPermission();
    setNotificationPermission(status);
    return status;
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

  // 動態幣種掃描：抓 Binance 全市場成交額排名，取代固定清單，並固定保留 BTC/ETH
  // 與目前有模擬部位的幣種（避免部位追蹤不到）。失敗就沿用目前清單，不影響運作。
  const refreshWatchlist = useCallback(async () => {
    const pinned = Array.from(new Set(["BTCUSDT", "ETHUSDT", ...paperOpenRef.current.map((p) => `${p.symbol}USDT`)]));
    try {
      const pairs = await fetchTopVolumePairs(20, pinned);
      const changed = pairs.join(",") !== activePairsRef.current.join(",");
      if (changed) {
        activePairsRef.current = pairs;
        setActivePairs(pairs);
      }
    } catch {
      // 動態清單抓不到，繼續用目前的清單（第一次會是固定備用清單）
    }
  }, []);

  useEffect(() => {
    refreshWatchlist();
    const id = setInterval(refreshWatchlist, WATCHLIST_REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshWatchlist]);

  // 建立即時價格 WebSocket（打開網站才連線，離開頁面自動斷開）。
  // activePairs 變動時（動態清單更新）會斷線重連，訂閱新的幣種組合。
  useEffect(() => {
    fetchTickersRest(activePairs)
      .then((data) => {
        tickersRef.current = { ...tickersRef.current, ...data };
        setTickers({ ...tickersRef.current });
      })
      .catch(() => {
        // 忽略，WebSocket 連上後一樣會補上資料
      });

    const feed = new BinanceLiveFeed(
      activePairs,
      (tick) => {
        tickersRef.current = { ...tickersRef.current, [tick.symbol]: tick };
        setTickers((prev) => ({ ...prev, [tick.symbol]: tick }));
        setLastTickAt(new Date());

        // 用最新價格檢查該幣種是否有模擬部位觸價出場
        const symbol = tick.symbol.replace("USDT", "");
        if (paperOpenRef.current.some((p) => p.symbol === symbol)) {
          const { stillOpen, newlyClosed } = checkPositions(paperOpenRef.current, { [symbol]: tick.price });
          if (newlyClosed.length > 0) {
            paperOpenRef.current = stillOpen;
            paperClosedRef.current = [...paperClosedRef.current, ...newlyClosed];
            setPaperOpen(stillOpen);
            setPaperClosed(paperClosedRef.current);
            saveOpenPositions(stillOpen);
            saveClosedTrades(paperClosedRef.current);
            newlyClosed.forEach((t) => {
              showNotification(
                t.result === "WIN" ? `✅ 模擬交易獲利出場：${t.symbol}` : `🛑 模擬交易停損出場：${t.symbol}`,
                `R倍數：${t.rMultiple.toFixed(2)}，進場 ${t.entryPrice.toFixed(4)} → 出場 ${t.exitPrice.toFixed(4)}`,
                `paper-${t.id}`
              );
            });
          }
        }
      },
      (status) => setConnectionStatus(status)
    );
    feed.connect();
    feedRef.current = feed;

    return () => feed.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePairs.join(",")]);

  // 大盤總覽 / 恐慌貪婪：CoinGecko，60 秒一次。僅供市場頁參考，失敗不影響幣種評分。
  const loadSlow = useCallback(async () => {
    const errs: string[] = [];
    try {
      const g = await fetchGlobalMarket();
      globalRef.current = g;
      setGlobal(g);
    } catch (e) {
      errs.push(e instanceof CoinGeckoError ? `大盤資料來源異常 (${e.source})` : "大盤資料取得失敗");
    }
    try {
      const fg = await fetchFearGreed();
      fearGreedRef.current = fg;
      setFearGreed(fg);
    } catch {
      errs.push("恐慌貪婪指數取得失敗");
    }
    if (errs.length) setErrors((prev) => [...new Set([...prev, ...errs])]);
    setLastUpdated(new Date());
  }, []);

  // 技術指標完整掃描：Binance K線，5 分鐘一次。完全不依賴 CoinGecko。
  const loadScan = useCallback(async () => {
    setLoading(true);
    const errs: string[] = [];
    const results: Record<string, number[]> = {};
    const pairs = activePairsRef.current;

    for (const pair of pairs) {
      try {
        const candles = await fetchKlines(pair, "1h", 200);
        results[pair] = candles.map((c) => c.close);
      } catch (e) {
        const sym = pair.replace("USDT", "");
        errs.push(e instanceof BinanceError ? `${sym} K線資料異常` : `${sym} K線取得失敗`);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    closesCache.current = results;

    const btcCloses = results["BTCUSDT"] ?? [];
    const btcTicker = tickersRef.current["BTCUSDT"];
    const btcIndicators = btcCloses.length > 20 ? buildIndicatorSet(btcCloses) : null;
    const newRegime = classifyMarketRegime(
      btcTicker?.change24h ?? 0,
      btcIndicators?.trendScore ?? 50,
      fearGreedRef.current?.value ?? null
    );

    const built: OpportunityCandidate[] = [];
    pairs.forEach((pair) => {
      const closes = results[pair];
      const ticker = tickersRef.current[pair];
      const symbol = pair.replace("USDT", "");
      if (closes && closes.length > 20 && ticker) {
        const coin: CoinSnapshot = {
          id: pair,
          symbol,
          name: symbol,
          price: ticker.price,
          change24h: ticker.change24h,
          high24h: ticker.high24h,
          low24h: ticker.low24h,
          volume24h: ticker.quoteVolume24h,
        };
        built.push(buildOpportunity(coin, closes, globalRef.current, fearGreedRef.current, newRegime));
      } else if (!closes || closes.length <= 20) {
        errs.push(`${symbol} 歷史價格資料不足，暫不計分`);
      }
    });
    built.sort((a, b) => b.opportunityScore - a.opportunityScore);
    setCandidates(built);
    setRegime(newRegime);
    setScanUpdatedAt(new Date());
    if (errs.length) setErrors((prev) => [...new Set([...prev, ...errs])]);
    setLoading(false);

    // 自動模擬交易：S/A 級且非追高警示、目前沒有該幣種未平倉部位，就開一筆模擬部位
    const openSymbols = new Set(paperOpenRef.current.map((p) => p.symbol));
    const newPositions: PaperPosition[] = [];
    built.forEach((c) => {
      if ((c.grade === "S" || c.grade === "A") && !c.doNotChase && !openSymbols.has(c.coin.symbol)) {
        const pos = openPositionFromCandidate(c);
        newPositions.push(pos);
        openSymbols.add(c.coin.symbol);
        showNotification(
          `🚨 ${c.grade}級機會：${c.coin.symbol}`,
          `Score ${c.opportunityScore.toFixed(0)}/100，已自動開立模擬部位（進場 ${pos.entryPrice.toFixed(4)}）`,
          `open-${pos.id}`
        );
      }
    });
    if (newPositions.length > 0) {
      paperOpenRef.current = [...paperOpenRef.current, ...newPositions];
      setPaperOpen(paperOpenRef.current);
      saveOpenPositions(paperOpenRef.current);
    }
  }, []);

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
    const t = setTimeout(loadScan, 1500);
    const id = setInterval(loadScan, SCAN_REFRESH_MS);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 由目前即時 ticker 組成的幣種快照（給市場頁/首頁顯示用，價格為即時）
  const coins: CoinSnapshot[] = activePairs
    .filter((p) => tickers[p])
    .map((pair) => {
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
  const maxRisk = effectiveMaxRiskPct(capitalState);
  const daily = computeDailyState(regime, candidates, maxRisk);
  const top3 = candidates.filter((c) => !c.doNotChase).slice(0, 3);
  const dangerous = candidates.filter((c) => c.doNotChase || c.riskFlags.overheated).slice(0, 3);
  const paperStats = computePaperStats(paperClosed);

  return {
    hydrated,
    capital,
    peak,
    setCapital,
    activePairs,
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
    paperOpen,
    paperClosed,
    paperStats,
    notificationPermission,
    requestNotifications,
  };
}
