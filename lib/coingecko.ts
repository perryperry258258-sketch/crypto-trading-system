import { FearGreed, GlobalMarketSnapshot } from "./types";

// CoinGecko 只負責 Binance 沒有的「大盤總覽」資料（市值、BTC Dominance）與恐慌貪婪指數，
// 且僅供市場頁參考顯示 —— 幣種評分／機會偵測已完全不依賴 CoinGecko（改用 Binance 成交量），
// 就算 CoinGecko 暫時不可用，價格與交易訊號仍會正常運作。
// 免費、無需 API Key。

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

export class DataSourceError extends Error {
  constructor(public source: string, message: string) {
    super(message);
    this.name = "DataSourceError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string, retries: number = 2): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) return res.json();
    if (attempt < retries && (res.status === 429 || res.status >= 500)) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new DataSourceError(url, `HTTP ${res.status}`);
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
