// 核心資料型別定義

export type MarketRegime = "BULL" | "SIDEWAYS" | "BEAR" | "EUPHORIA" | "PANIC";

export type TradeLight = "GO" | "CAUTION" | "NO_TRADE"; // 🟢 / 🟡 / 🔴

export type AlertGrade = "S" | "A" | "B" | "C";

export interface Phase {
  index: number;
  from: number;
  to: number | null; // null = 無上限 (Phase 7+)
  maxRiskPct: number; // 單筆最大風險 %（占目前本金）
  label: string;
}

export interface CoinSnapshot {
  id: string; // coingecko id
  symbol: string;
  name: string;
  price: number;
  change24h: number; // %
  change7d: number | null; // %
  high24h: number;
  low24h: number;
  volume24h: number;
  marketCap: number;
  sparkline: number[]; // ~7d hourly closes, oldest→newest
}

export interface GlobalMarketSnapshot {
  totalMarketCapUsd: number;
  totalVolume24hUsd: number;
  btcDominance: number;
  marketCapChange24h: number;
  fetchedAt: string; // ISO timestamp
}

export interface FearGreed {
  value: number; // 0-100
  classification: string; // e.g. "Extreme Fear"
  fetchedAt: string;
}

export interface IndicatorSet {
  ema20: number;
  ema50: number;
  ema200: number | null;
  rsi14: number;
  macd: { macd: number; signal: number; histogram: number };
  atr14: number | null;
  bollinger: { upper: number; mid: number; lower: number };
  trendScore: number; // 0-100
  momentumScore: number; // 0-100
  volumeScore: number; // 0-100
}

export interface RiskFlags {
  overheated: boolean; // RSI 極端過熱
  falseBreakoutRisk: boolean;
  lowLiquidity: boolean;
  chaseRisk: boolean; // 已暴漲，追高風險
  reasons: string[]; // 觸發原因說明（人類可讀）
}

export interface OpportunityCandidate {
  coin: CoinSnapshot;
  indicators: IndicatorSet;
  opportunityScore: number; // 0-100
  riskScore: number; // 0-100，越低越安全
  grade: AlertGrade;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskRewardRatio: number; // 以 TP1 計算
  reasonsFor: string[]; // 為什麼現在值得交易
  reasonsAgainst: string[]; // 為什麼可能失敗 / 失效條件
  riskFlags: RiskFlags;
  doNotChase: boolean;
}

export interface DailyState {
  light: TradeLight;
  regime: MarketRegime;
  headline: string;
  fetchedAt: string;
}

export interface CapitalState {
  currentCapital: number;
  peakCapital: number;
  drawdownPct: number; // (peak-current)/peak * 100
  phase: Phase;
  nextTarget: number | null;
  progressPct: number; // 目前在該 Phase 內的進度
  profitLockLevel: "NORMAL" | "REDUCE_RISK" | "HIGH_RISK_BAN" | "PROTECT_MODE";
}
