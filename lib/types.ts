// 核心資料型別定義。
//
// 【清理紀錄】原本這裡還有 MarketRegime/TradeLight/AlertGrade/IndicatorSet/RiskFlags/
// OpportunityCandidate/DailyState（舊Opportunity Score系統的型別），該系統已整套移除，
// 只留下資金階段系統（Phase/CapitalState）跟中性市場資料型別還在使用中。

export interface Phase {
  index: number;
  from: number;
  to: number | null; // null = 無上限 (Phase 7+)
  maxRiskPct: number; // 單筆最大風險 %（占目前本金）
  label: string;
}

export interface CoinSnapshot {
  id: string; // Binance symbol, e.g. BTCUSDT
  symbol: string; // 顯示用，例如 BTC
  name: string;
  price: number;
  change24h: number; // %
  high24h: number;
  low24h: number;
  volume24h: number; // quote volume (USDT)
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

export interface CapitalState {
  currentCapital: number;
  peakCapital: number;
  drawdownPct: number; // (peak-current)/peak * 100
  phase: Phase;
  nextTarget: number | null;
  progressPct: number; // 目前在該 Phase 內的進度
  profitLockLevel: "NORMAL" | "REDUCE_RISK" | "HIGH_RISK_BAN" | "PROTECT_MODE";
}
