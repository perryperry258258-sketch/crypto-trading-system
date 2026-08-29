"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DataSourceError,
  fetchCoinSnapshots,
  fetchFearGreed,
  fetchGlobalMarket,
  fetchHourlyClosesForAll,
} from "./coingecko";
import { buildIndicatorSet, buildOpportunity, classifyMarketRegime } from "./scoring";
import { computeDailyState } from "./dailyState";
import { computeCapitalState, effectiveMaxRiskPct } from "./phases";
import { CoinSnapshot, FearGreed, GlobalMarketSnapshot, MarketRegime, OpportunityCandidate } from "./types";

const REFRESH_MS = 60_000; // 遵守 CoinGecko 免費版速率限制，不要低於 60 秒
const CAPITAL_KEY = "cts_capital_v1";
const PEAK_KEY = "cts_peak_v1";

export function useMarketData() {
  const [capital, setCapitalState] = useState<number>(5000);
  const [peak, setPeak] = useState<number>(5000);
  const [hydrated, setHydrated] = useState(false);

  const [coins, setCoins] = useState<CoinSnapshot[] | null>(null);
  const [global, setGlobal] = useState<GlobalMarketSnapshot | null>(null);
  const [fearGreed, setFearGreed] = useState<FearGreed | null>(null);
  const [candidates, setCandidates] = useState<OpportunityCandidate[]>([]);
  const [regime, setRegime] = useState<MarketRegime>("SIDEWAYS");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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

  const load = useCallback(async () => {
    setLoading(true);
    const errs: string[] = [];
    let coinData: CoinSnapshot[] = [];
    let globalData: GlobalMarketSnapshot | null = null;
    let fgData: FearGreed | null = null;

    try {
      coinData = await fetchCoinSnapshots();
      setCoins(coinData);
    } catch (e) {
      errs.push(e instanceof DataSourceError ? `幣價資料來源異常 (${e.source})` : "幣價資料取得失敗");
    }

    try {
      globalData = await fetchGlobalMarket();
      setGlobal(globalData);
    } catch (e) {
      errs.push(e instanceof DataSourceError ? `大盤資料來源異常 (${e.source})` : "大盤資料取得失敗");
    }

    try {
      fgData = await fetchFearGreed();
      setFearGreed(fgData);
    } catch {
      errs.push("恐慌貪婪指數取得失敗");
    }

    if (coinData.length > 0 && globalData) {
      const btcIdx = coinData.findIndex((c) => c.id === "bitcoin");
      const btc = coinData[btcIdx];
      const closesResults = await fetchHourlyClosesForAll(
        coinData.map((c) => c.id),
        14
      );

      const btcCloses =
        btcIdx >= 0 && closesResults[btcIdx]?.status === "fulfilled"
          ? (closesResults[btcIdx] as PromiseFulfilledResult<number[]>).value
          : [];

      const btcIndicators = btcCloses.length > 20 ? buildIndicatorSet(btcCloses) : null;
      const newRegime = classifyMarketRegime(btc?.change24h ?? 0, btcIndicators?.trendScore ?? 50, fgData?.value ?? null);

      const built: OpportunityCandidate[] = [];
      coinData.forEach((coin, idx) => {
        const res = closesResults[idx];
        if (res.status === "fulfilled" && res.value.length > 20 && globalData) {
          built.push(buildOpportunity(coin, res.value, globalData, fgData, newRegime));
        } else {
          errs.push(`${coin.symbol} 歷史價格資料不足，暫不計分`);
        }
      });
      built.sort((a, b) => b.opportunityScore - a.opportunityScore);
      setCandidates(built);
      setRegime(newRegime);
    }

    setErrors(errs);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const capitalState = computeCapitalState(capital, peak);
  const maxRisk = effectiveMaxRiskPct(capitalState);
  const daily = computeDailyState(regime, candidates, maxRisk);
  const btc = coins?.find((c) => c.id === "bitcoin");
  const eth = coins?.find((c) => c.id === "ethereum");
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
    lastUpdated,
    errors,
    loading,
    reload: load,
  };
}
