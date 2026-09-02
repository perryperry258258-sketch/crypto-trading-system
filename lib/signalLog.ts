// Signal Log（Part 16）。記錄每一個 RETEST_CONFIRMED（A級進場）訊號，存在手機本地
// localStorage，不上傳、不接資料庫。目的是讓系統自己累積「真實即時訊號」的紀錄，
// 之後才能比較「即時訊號的表現」跟「回測的表現」是否一致（規格書 Part 16 的要求）。
//
// 這一版只記錄訊號本身，不追蹤後續結果（TP/SL/EXPIRED）——那是下一步再做的事，
// 先把訊號本身穩定記錄下來。

export interface SignalLogEntry {
  id: string; // symbol + signalTime，用來去重
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskDistance: number;
  signalTime: number; // 回踩確認時間（unix秒）
  loggedAt: number; // 第一次被記錄到的時間（ms）
}

const LOG_KEY = "cts_signal_log_v1";
const MAX_LOG_HISTORY = 500;

export function loadSignalLog(): SignalLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSignalLog(entries: SignalLogEntry[]) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_LOG_HISTORY)));
  } catch {
    // 忽略儲存失敗，不影響當前 session
  }
}

// 記錄一個新確認的訊號；如果同一個 id 已經記錄過（同一個symbol、同一個signalTime），
// 不會重複新增，回傳 false 代表這次沒有新增（避免每次刷新都重複寫入同一筆）。
export function logSignal(entry: Omit<SignalLogEntry, "id" | "loggedAt">): boolean {
  const id = `${entry.symbol}_${entry.signalTime}`;
  const existing = loadSignalLog();
  if (existing.some((e) => e.id === id)) return false;
  const updated = [...existing, { ...entry, id, loggedAt: Date.now() }];
  saveSignalLog(updated);
  return true;
}
