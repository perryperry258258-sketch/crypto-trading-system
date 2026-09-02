// Binance USDT-M 永續合約（Futures）公開資料來源，免費、無需 API Key。
// WebSocket 連線是在使用者的瀏覽器裡建立的（打開網站才連線，關閉就斷開），
// 不需要任何常駐後端伺服器，完全免費。
//
// 【資料源紀錄】原本用現貨（Spot）API，使用者實際看盤/交易的是永續合約，
// 兩者價格會因資金費率、多空力道出現價差，已經改成合約API，讓回測/即時訊號
// 跟使用者實際看到的價格一致。合約K線/ticker的欄位格式跟現貨完全相同，
// 只有網址(REST_BASE/WS_BASE)不同，程式邏輯不用改。

export interface BinanceTicker {
  symbol: string; // e.g. BTCUSDT
  price: number;
  change24h: number; // %
  high24h: number;
  low24h: number;
  volume24h: number; // base asset volume
  quoteVolume24h: number; // USDT volume
  timestamp: number; // ms，資料實際產生的時間
}

export interface Candle {
  time: number; // seconds (for lightweight-charts)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 固定監控清單：回踩引擎鎖定的8個幣種，跟 journal/opportunities/market 頁一致。
// 不再動態抓取成交額排名（那是舊Opportunity Score系統的做法，已移除）。
export const WATCHLIST_PAIRS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "LINKUSDT",
];

const REST_BASE = "https://fapi.binance.com/fapi/v1";
const WS_BASE = "wss://fstream.binance.com/stream";

export class DataSourceError extends Error {
  constructor(public source: string, message: string) {
    super(message);
    this.name = "DataSourceError";
  }
}

// 初始化用：REST 一次抓全部監控幣種的 24hr ticker
export async function fetchTickersRest(symbols: string[] = WATCHLIST_PAIRS): Promise<Record<string, BinanceTicker>> {
  // 合約(Futures) API 的 /ticker/24hr 不支援現貨那種 symbols= 批次查詢參數，
  // 只能整批抓全部合約的ticker再自己過濾，跟原本 fetchTopVolumePairs 的做法一致。
  const url = `${REST_BASE}/ticker/24hr`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const wanted = new Set(symbols);
    const out: Record<string, BinanceTicker> = {};
    (data as any[]).forEach((t) => {
      if (!wanted.has(t.symbol)) return;
      out[t.symbol] = {
        symbol: t.symbol,
        price: Number(t.lastPrice),
        change24h: Number(t.priceChangePercent),
        high24h: Number(t.highPrice),
        low24h: Number(t.lowPrice),
        volume24h: Number(t.volume),
        quoteVolume24h: Number(t.quoteVolume),
        timestamp: Date.now(),
      };
    });
    return out;
  } catch (err) {
    throw new DataSourceError("binance:ticker24hr", (err as Error).message);
  }
}

// K線資料（技術指標與圖表共用）。interval: 1m/5m/15m/1h/4h/1d
export async function fetchKlines(symbol: string, interval: string, limit: number = 200): Promise<Candle[]> {
  const url = `${REST_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data as any[]).map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));
  } catch (err) {
    throw new DataSourceError(`binance:klines:${symbol}`, (err as Error).message);
  }
}

// 分頁抓取較長歷史（給回測用）。Binance 單次最多 1000 根，用 endTime 往回翻頁。
export async function fetchKlinesHistory(symbol: string, interval: string, totalBars: number = 2000): Promise<Candle[]> {
  const maxPerCall = 1000;
  let all: Candle[] = [];
  let endTime: number | undefined = undefined;

  while (all.length < totalBars) {
    const remaining = totalBars - all.length;
    const limit = Math.min(maxPerCall, remaining);
    const url =
      `${REST_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}` +
      (endTime ? `&endTime=${endTime}` : "");
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch (err) {
      throw new DataSourceError(`binance:klines_history:${symbol}`, (err as Error).message);
    }
    if (!res.ok) throw new DataSourceError(`binance:klines_history:${symbol}`, `HTTP ${res.status}`);
    const data = await res.json();
    const batch: Candle[] = (data as any[]).map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));
    if (batch.length === 0) break;
    all = [...batch, ...all];
    endTime = batch[0].time * 1000 - 1;
    if (batch.length < limit) break; // 已經沒有更早的資料了
    await new Promise((r) => setTimeout(r, 200)); // 避免連續分頁請求過快
  }

  return all;
}

export type ConnectionStatus = "CONNECTING" | "LIVE" | "DELAYED" | "ERROR";

// 瀏覽器端 WebSocket，訂閱多個幣種的即時 ticker。
// 打開網站才連線，離開頁面就斷線；斷線會自動重連（指數退避）。
export class BinanceLiveFeed {
  private ws: WebSocket | null = null;
  private symbols: string[];
  private onTick: (ticker: BinanceTicker) => void;
  private onStatusChange: (status: ConnectionStatus) => void;
  private lastMessageAt: number = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    symbols: string[],
    onTick: (ticker: BinanceTicker) => void,
    onStatusChange: (status: ConnectionStatus) => void
  ) {
    this.symbols = symbols;
    this.onTick = onTick;
    this.onStatusChange = onStatusChange;
  }

  connect() {
    this.closed = false;
    this.onStatusChange("CONNECTING");
    const streams = this.symbols.map((s) => `${s.toLowerCase()}@ticker`).join("/");
    const url = `${WS_BASE}?streams=${streams}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
      this.onStatusChange("LIVE");
    };

    this.ws.onmessage = (event) => {
      this.lastMessageAt = Date.now();
      try {
        const parsed = JSON.parse(event.data);
        const d = parsed.data;
        if (!d || !d.s) return;
        this.onTick({
          symbol: d.s,
          price: Number(d.c),
          change24h: Number(d.P),
          high24h: Number(d.h),
          low24h: Number(d.l),
          volume24h: Number(d.v),
          quoteVolume24h: Number(d.q),
          timestamp: Date.now(),
        });
      } catch {
        // 忽略單一筆解析失敗，不影響連線
      }
    };

    this.ws.onerror = () => {
      this.onStatusChange("ERROR");
    };

    this.ws.onclose = () => {
      if (!this.closed) this.scheduleReconnect();
    };

    // 每 2 秒檢查一次資料新鮮度：>5秒沒訊息 = DELAYED，>30秒 = ERROR
    this.healthTimer = setInterval(() => {
      if (this.closed) return;
      const age = Date.now() - this.lastMessageAt;
      if (age > 30_000) this.onStatusChange("ERROR");
      else if (age > 5_000) this.onStatusChange("DELAYED");
      else this.onStatusChange("LIVE");
    }, 2000);
  }

  private scheduleReconnect() {
    if (this.closed) return;
    this.onStatusChange("ERROR");
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  disconnect() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
  }
}
