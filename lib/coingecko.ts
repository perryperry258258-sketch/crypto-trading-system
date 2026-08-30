import { FearGreed, GlobalMarketSnapshot } from "./types";

// CoinGecko 只負責 Binance 沒有的資料：市值排名、BTC Dominance、恐慌貪婪指數。
// 即時價格/24H漲跌改用 lib/binance.ts（詳見 PART2 資料源分工）。
// 免費、無需 API Key。

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// symbol (BTC/ETH/...) 對應 CoinGecko id，用來查市值
export const WATCHLIST_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
};

export class DataSourceError extends Error {
  constructor(public source: string, message: string) {
    super(message);
    this.name = "DataSourceError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// 只取市值（marketCap），用於 Opportunity Score 的量能比例計算。
export async function fetchMarketCaps(
  ids: string[] = Object.values(WATCHLIST_IDS)
): Promise<Record<string, number>> {
  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids.join(",")}&order=market_cap_desc`;
  try {
    const data = await fetchJson(url);
    const out: Record<string, number> = {};
    (data as any[]).forEach((c) => {
      out[c.id] = c.market_cap ?? 0;
    });
    return out;
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
