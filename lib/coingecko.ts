import { CoinSnapshot, FearGreed, GlobalMarketSnapshot } from "./types";

// 全部使用免費、無需 API Key 的公開端點。
// CoinGecko 免費版有速率限制，因此前端輪詢間隔不要低於 60 秒。

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// V0.1 預設掃描清單（規格書第三節）。之後可依市值排名動態擴充（V0.3）。
export const DEFAULT_WATCHLIST: { id: string; symbol: string }[] = [
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana", symbol: "SOL" },
  { id: "binancecoin", symbol: "BNB" },
  { id: "ripple", symbol: "XRP" },
  { id: "dogecoin", symbol: "DOGE" },
];

export class DataSourceError extends Error {
  constructor(public source: string, message: string) {
    super(message);
    this.name = "DataSourceError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 免費公開 API 偶爾會因為短時間內請求過多而回傳 429，重試一次即可大幅降低失敗率。
async function fetchJson(url: string, retries: number = 1): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) return res.json();
    if (attempt < retries && (res.status === 429 || res.status >= 500)) {
      await sleep(1200);
      continue;
    }
    throw new DataSourceError(url, `HTTP ${res.status}`);
  }
}

export async function fetchCoinSnapshots(
  ids: string[] = DEFAULT_WATCHLIST.map((c) => c.id),
  vsCurrency: string = "usd"
): Promise<CoinSnapshot[]> {
  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=${vsCurrency}&ids=${ids.join(
    ","
  )}&order=market_cap_desc&sparkline=true&price_change_percentage=24h,7d`;
  try {
    const data = await fetchJson(url);
    return data.map((c: any) => ({
      id: c.id,
      symbol: (c.symbol || "").toUpperCase(),
      name: c.name,
      price: c.current_price,
      change24h: c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h ?? 0,
      change7d: c.price_change_percentage_7d_in_currency ?? null,
      high24h: c.high_24h,
      low24h: c.low_24h,
      volume24h: c.total_volume,
      marketCap: c.market_cap,
      sparkline: c.sparkline_in_7d?.price ?? [],
    }));
  } catch (err) {
    throw new DataSourceError("coingecko:markets", (err as Error).message);
  }
}

export async function fetchGlobalMarket(): Promise<GlobalMarketSnapshot> {
  const url = `${COINGECKO_BASE}/global`;
  try {
    const data = await fetchJson(url);
    const d = data.data;
    return {
      totalMarketCapUsd: d.total_market_cap?.usd ?? 0,
      totalVolume24hUsd: d.total_volume?.usd ?? 0,
      btcDominance: d.market_cap_percentage?.btc ?? 0,
      marketCapChange24h: d.market_cap_change_percentage_24h_usd ?? 0,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    throw new DataSourceError("coingecko:global", (err as Error).message);
  }
}

// Alternative.me Fear & Greed Index — 免費、無需金鑰
export async function fetchFearGreed(): Promise<FearGreed> {
  const url = "https://api.alternative.me/fng/?limit=1&format=json";
  try {
    const data = await fetchJson(url);
    const item = data.data?.[0];
    if (!item) throw new Error("empty response");
    return {
      value: Number(item.value),
      classification: item.value_classification,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    throw new DataSourceError("alternative.me:fng", (err as Error).message);
  }
}

// 取得單一幣種近期小時線收盤價（用於技術指標計算）。
// CoinGecko market_chart 端點（免費）：days<=90 回傳小時線。
export async function fetchHourlyCloses(id: string, days: number = 14): Promise<number[]> {
  const url = `${COINGECKO_BASE}/coins/${id}/market_chart?vs_currency=usd&days=${days}`;
  try {
    const data = await fetchJson(url);
    const prices: [number, number][] = data.prices ?? [];
    return prices.map((p) => p[1]);
  } catch (err) {
    throw new DataSourceError(`coingecko:market_chart:${id}`, (err as Error).message);
  }
}

// 依序（而非同時）取得多個幣種的小時線，並在每次請求間加入小間隔，
// 降低免費 API 因短時間內大量併發請求而被限流（429）的機率。
export async function fetchHourlyClosesForAll(
  ids: string[],
  days: number = 14
): Promise<PromiseSettledResult<number[]>[]> {
  const results: PromiseSettledResult<number[]>[] = [];
  for (let i = 0; i < ids.length; i++) {
    try {
      const closes = await fetchHourlyCloses(ids[i], days);
      results.push({ status: "fulfilled", value: closes });
    } catch (err) {
      results.push({ status: "rejected", reason: err });
    }
    if (i < ids.length - 1) await sleep(350);
  }
  return results;
}
