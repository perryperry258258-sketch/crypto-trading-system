import { OpportunityCandidate } from "./types";

// 模擬交易（Paper Trading）。不動用真錢，純粹記錄「如果照系統訊號交易，結果會如何」。
// 客觀出場規則：只認「碰到 TP1」或「碰到停損」兩種結果，不含 TP2/TP3 加碼情境 —— 這樣才有一個
// 可自動判定、可驗證的輸贏規則，也才能跟 lib/backtest.ts 的歷史回測用同一套規則比較。

export interface PaperPosition {
  id: string;
  symbol: string;
  grade: string;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  opportunityScore: number;
  openedAt: number; // ms
}

export interface PaperTrade extends PaperPosition {
  closedAt: number;
  exitPrice: number;
  result: "WIN" | "LOSS";
  rMultiple: number;
}

const OPEN_KEY = "cts_paper_open_v1";
const CLOSED_KEY = "cts_paper_closed_v1";
const MAX_CLOSED_HISTORY = 300; // 避免 localStorage 無限增長

export function loadOpenPositions(): PaperPosition[] {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveOpenPositions(positions: PaperPosition[]) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(positions));
  } catch {
    // 忽略儲存失敗（例如 localStorage 已滿），不影響當前 session 的運作
  }
}

export function loadClosedTrades(): PaperTrade[] {
  try {
    const raw = localStorage.getItem(CLOSED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveClosedTrades(trades: PaperTrade[]) {
  try {
    const trimmed = trades.slice(-MAX_CLOSED_HISTORY);
    localStorage.setItem(CLOSED_KEY, JSON.stringify(trimmed));
  } catch {
    // 忽略
  }
}

export function openPositionFromCandidate(c: OpportunityCandidate): PaperPosition {
  return {
    id: `${c.coin.symbol}-${Date.now()}`,
    symbol: c.coin.symbol,
    grade: c.grade,
    entryPrice: c.coin.price,
    stopLoss: c.stopLoss,
    tp1: c.tp1,
    opportunityScore: c.opportunityScore,
    openedAt: Date.now(),
  };
}

// 檢查目前所有未平倉部位，用最新價格判斷是否觸價出場。
export function checkPositions(
  open: PaperPosition[],
  currentPrices: Record<string, number>
): { stillOpen: PaperPosition[]; newlyClosed: PaperTrade[] } {
  const stillOpen: PaperPosition[] = [];
  const newlyClosed: PaperTrade[] = [];

  open.forEach((pos) => {
    const price = currentPrices[pos.symbol];
    if (price === undefined) {
      stillOpen.push(pos);
      return;
    }
    if (price <= pos.stopLoss) {
      const riskDistance = pos.entryPrice - pos.stopLoss;
      const rMultiple = riskDistance > 0 ? (pos.stopLoss - pos.entryPrice) / riskDistance : -1;
      newlyClosed.push({ ...pos, closedAt: Date.now(), exitPrice: pos.stopLoss, result: "LOSS", rMultiple });
    } else if (price >= pos.tp1) {
      const riskDistance = pos.entryPrice - pos.stopLoss;
      const rMultiple = riskDistance > 0 ? (pos.tp1 - pos.entryPrice) / riskDistance : 1.5;
      newlyClosed.push({ ...pos, closedAt: Date.now(), exitPrice: pos.tp1, result: "WIN", rMultiple });
    } else {
      stillOpen.push(pos);
    }
  });

  return { stillOpen, newlyClosed };
}

export interface PaperStats {
  totalTrades: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  maxDrawdownR: number;
}

export function computePaperStats(trades: PaperTrade[]): PaperStats {
  if (trades.length === 0) {
    return { totalTrades: 0, winRate: 0, avgR: 0, profitFactor: 0, maxDrawdownR: 0 };
  }
  const wins = trades.filter((t) => t.result === "WIN");
  const losses = trades.filter((t) => t.result === "LOSS");
  const winRate = (wins.length / trades.length) * 100;
  const avgR = trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length;
  const grossWin = wins.reduce((a, t) => a + t.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.rMultiple, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  trades.forEach((t) => {
    cum += t.rMultiple;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  });

  return { totalTrades: trades.length, winRate, avgR, profitFactor, maxDrawdownR: maxDD };
}
