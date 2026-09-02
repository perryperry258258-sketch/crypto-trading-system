import { LiveSignal } from "./retestEngine";

// Signal Record（驗收第5項＋第8項）。
//
// 設計：每次即時引擎輪詢時，對每個處在 RETEST_CONFIRMED/TP_HIT/SL_HIT/EXPIRED 狀態的
// LiveSignal，用 symbol+refTime 當id去 upsert 一筆記錄。因為 evaluateLiveSignal() 每次
// 都是用「目前為止所有可見資料」重新完整判斷一次，所以晚一點的輪詢如果看到狀態從
// RETEST_CONFIRMED 變成 TP_HIT，直接覆寫同一筆記錄就好，不需要額外維護一個「進行中部位」
// 的狀態機——這樣比較不容易因為某次輪詢漏跑而讓紀錄卡住不動。
//
// 這份紀錄同時滿足兩個用途：
// 1. Signal Record（完整訊號生命週期紀錄，驗收第5項要求的所有欄位）
// 2. Paper Trading（因為每筆紀錄的最終status/rMultiple就是「如果照這個訊號交易」的結果，
//    不需要另外做一套部位追蹤系統）
//
// 【誠實揭露】
// - EXPIRED時的rMultiple是用「過期當下的現價」概算，不是精確的時間出場價格模擬，
//   跟回測用bar.close精確模擬不完全一樣，這裡只是概算
// - WIN/LOSS的rMultiple沒有扣手續費/滑價（回測有扣），所以這裡的數字會比回測的
//   期望值「看起來好一點點」，比較Paper vs 回測時要記得這個系統性差異

export interface SignalRecord {
  id: string; // symbol + refTime
  symbol: string;
  direction: "LONG" | "SHORT";
  refTime: number;
  refHigh: number;
  refLow: number;
  refVolume: number;
  breakoutTime: number;
  retestTime: number;
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  status: "OPEN" | "WIN" | "LOSS" | "EXPIRED";
  rMultiple: number | null;
  firstLoggedAt: number;
  lastUpdatedAt: number;
}

const RECORD_KEY = "cts_signal_records_v2"; // v2：資料源從現貨改永續合約，版本升級讓舊的現貨訊號紀錄自動失效，不會混進來比較
const MAX_RECORDS = 500;

export function loadSignalRecords(): SignalRecord[] {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSignalRecords(records: SignalRecord[]) {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
  } catch {
    // 忽略儲存失敗，不影響當前 session
  }
}

export function upsertFromLiveSignal(s: LiveSignal, tpMultiple: number): void {
  if (!s.refTime || !s.entryPrice || !s.stopLoss || !s.takeProfit || !s.riskDistance || !s.direction) return;
  if (!["RETEST_CONFIRMED", "TP_HIT", "SL_HIT", "EXPIRED"].includes(s.state)) return;

  const id = `${s.symbol}_${s.refTime}`;
  const status: SignalRecord["status"] =
    s.state === "RETEST_CONFIRMED" ? "OPEN" : s.state === "TP_HIT" ? "WIN" : s.state === "SL_HIT" ? "LOSS" : "EXPIRED";

  let rMultiple: number | null = null;
  if (status === "WIN") rMultiple = tpMultiple;
  else if (status === "LOSS") rMultiple = -1;
  else if (status === "EXPIRED" && s.currentPrice) {
    rMultiple =
      s.direction === "LONG"
        ? (s.currentPrice - s.entryPrice) / s.riskDistance
        : (s.entryPrice - s.currentPrice) / s.riskDistance;
  }

  const records = loadSignalRecords();
  const idx = records.findIndex((r) => r.id === id);
  const now = Date.now();

  const record: SignalRecord = {
    id,
    symbol: s.symbol,
    direction: s.direction,
    refTime: s.refTime,
    refHigh: s.refHigh ?? 0,
    refLow: s.refLow ?? 0,
    refVolume: s.refVolume ?? 0,
    breakoutTime: s.breakoutTime ?? 0,
    retestTime: s.retestTime ?? s.signalTime ?? 0,
    entryTime: s.signalTime ?? 0,
    entryPrice: s.entryPrice,
    stopLoss: s.stopLoss,
    takeProfit: s.takeProfit,
    status,
    rMultiple,
    firstLoggedAt: idx === -1 ? now : records[idx].firstLoggedAt,
    lastUpdatedAt: now,
  };

  if (idx === -1) {
    saveSignalRecords([...records, record]);
  } else {
    const updated = [...records];
    updated[idx] = record;
    saveSignalRecords(updated);
  }
}

export interface PaperReport {
  sampleCount: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdownR: number;
}

export function auditSignalRecords(records: SignalRecord[]): PaperReport {
  const resolved = records.filter((r) => r.status !== "OPEN" && r.rMultiple !== null);
  const n = resolved.length;
  const wins = resolved.filter((r) => r.status === "WIN");
  const losses = resolved.filter((r) => r.status === "LOSS");
  const completed = wins.length + losses.length;
  const winRate = completed ? (wins.length / completed) * 100 : 0;
  const expectancy = n ? resolved.reduce((a, r) => a + (r.rMultiple ?? 0), 0) / n : 0;
  const grossWin = resolved.filter((r) => (r.rMultiple ?? 0) > 0).reduce((a, r) => a + (r.rMultiple ?? 0), 0);
  const grossLoss = Math.abs(resolved.filter((r) => (r.rMultiple ?? 0) <= 0).reduce((a, r) => a + (r.rMultiple ?? 0), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  resolved
    .sort((a, b) => a.entryTime - b.entryTime)
    .forEach((r) => {
      cum += r.rMultiple ?? 0;
      if (cum > peak) peak = cum;
      const dd = peak - cum;
      if (dd > maxDD) maxDD = dd;
    });

  return { sampleCount: n, winRate, expectancy, profitFactor, maxDrawdownR: maxDD };
}

// 策略驗證狀態（驗收 Part 15）。journal頁面每次跑完「一鍵執行完整分析」的樣本外驗證後，
// 把結果存起來，首頁讀這裡顯示「策略驗證狀態」，不需要在首頁重新跑一次完整回測
// （2年的5分鐘資料量太大，首頁載入時跑不起）。

export interface OosSummary {
  verdict: "PASSED" | "INSUFFICIENT" | "FAILED";
  sampleCount: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdownR: number;
  windowMinutes: number;
  tpMultiple: number;
  computedAt: number;
}

const OOS_SUMMARY_KEY = "cts_oos_summary_v2"; // v2：資料源從現貨改永續合約，舊的現貨樣本外驗證結果不再適用

export function saveOosSummary(summary: OosSummary) {
  try {
    localStorage.setItem(OOS_SUMMARY_KEY, JSON.stringify(summary));
  } catch {
    // 忽略儲存失敗
  }
}

export function loadOosSummary(): OosSummary | null {
  try {
    const raw = localStorage.getItem(OOS_SUMMARY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
