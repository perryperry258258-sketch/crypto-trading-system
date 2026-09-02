import { Candle } from "./binance";
import { detectFromOpen, findTodayOpenIdx, checkDataFreshness, WEEKDAYS } from "./retestCore";

// 即時訊號狀態機。
//
// 驗收修正：偵測邏輯已改為呼叫 lib/retestCore.ts 的 detectFromOpen()，
// 跟回測（lib/retestStrategyLab.ts）共用同一份程式碼，不再是兩份平行邏輯（驗收第1項）。
//
// 【狀態說明】
// DATA_STALE       - 🔴 資料延遲或異常，暫停訊號判斷（驗收第4項）
// NO_SESSION_TODAY - 今天不是交易日（週末），或資料不足
// BEFORE_WINDOW    - 還沒到今天美股開盤時間
// SETUP            - 開盤區間正在形成中
// WATCHING         - Reference Candle已形成，還沒突破
// WAIT_RETEST      - 已突破，正在等待回踩
// RETEST_CONFIRMED - 🟢 回踩確認，A級進場訊號（尚未觸及SL/TP）
// TP_HIT           - 已觸及停利
// SL_HIT           - 已觸及停損
// EXPIRED          - 追蹤時間(4小時)到了，沒有完成整個流程
//
// 【驗收第3項再次確認】detectFromOpen() 內部：只有窗口收集滿windowBars根才會選出
// Reference Candle，突破偵測的迴圈從windowEnd才開始——這裡不重新判斷，直接繼承
// retestCore.ts 已經內建的防護。
//
// 【驗收第6項】同一個Reference Candle最多一個交易事件：Reference Candle 綁定「今天的
// 09:30那根K棒」，一天只有一根，所以結構上不可能對同一個Reference Candle重複產生訊號。

export type SignalState =
  | "DATA_STALE"
  | "NO_SESSION_TODAY"
  | "BEFORE_WINDOW"
  | "SETUP"
  | "WATCHING"
  | "WAIT_RETEST"
  | "RETEST_CONFIRMED"
  | "TP_HIT"
  | "SL_HIT"
  | "EXPIRED";

export interface LiveSignal {
  symbol: string;
  state: SignalState;
  direction: "LONG" | "SHORT" | null;
  refTime: number | null;
  refHigh: number | null;
  refLow: number | null;
  refVolume: number | null;
  breakoutTime: number | null;
  retestTime: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskDistance: number | null;
  currentPrice: number | null;
  distanceToBreakoutPct: number | null; // 現價距離突破線還差幾%（WATCHING狀態時有意義）
  signalTime: number | null; // 進入RETEST_CONFIRMED狀態的時間
  dataAgeMinutes: number | null;
  updatedAt: number;
}

export function evaluateLiveSignal(
  symbol: string,
  candles5m: Candle[],
  windowMinutes: 30 | 60 | 90 | 120,
  tpMultiple: number,
  retestZonePct: number
): LiveSignal {
  const freshness = checkDataFreshness(candles5m);
  const base: LiveSignal = {
    symbol,
    state: "NO_SESSION_TODAY",
    direction: null,
    refTime: null,
    refHigh: null,
    refLow: null,
    refVolume: null,
    breakoutTime: null,
    retestTime: null,
    entryPrice: null,
    stopLoss: null,
    takeProfit: null,
    riskDistance: null,
    currentPrice: candles5m.length ? candles5m[candles5m.length - 1].close : null,
    distanceToBreakoutPct: null,
    signalTime: null,
    dataAgeMinutes: freshness.ageMinutes,
    updatedAt: Date.now(),
  };

  if (candles5m.length === 0) return { ...base, state: "DATA_STALE" };
  if (!freshness.fresh) return { ...base, state: "DATA_STALE" };

  const openIdx = findTodayOpenIdx(candles5m);
  if (openIdx === -1) {
    // 用最後一根K棒判斷是不是週末（非交易日）還是單純還沒到開盤時間
    return { ...base, state: "BEFORE_WINDOW" };
  }

  const windowBars = windowMinutes / 5;
  const det = detectFromOpen(candles5m, openIdx, windowBars, retestZonePct);

  if (det.windowIncomplete) return { ...base, state: "SETUP" };

  const currentPrice = candles5m[candles5m.length - 1].close;

  if (det.breakoutIdx === null) {
    const expired = candles5m.length - 1 >= det.windowEnd + 48;
    const distPct = det.refHigh && det.refLow
      ? Math.min(
          Math.abs((det.refHigh - currentPrice) / currentPrice) * 100,
          Math.abs((currentPrice - det.refLow) / currentPrice) * 100
        )
      : null;
    return {
      ...base,
      state: expired ? "EXPIRED" : "WATCHING",
      refTime: det.refCandle?.time ?? null,
      refHigh: det.refHigh,
      refLow: det.refLow,
      refVolume: det.refCandle?.volume ?? null,
      distanceToBreakoutPct: distPct,
      currentPrice,
    };
  }

  const refLevel = det.direction === "LONG" ? det.refHigh! : det.refLow!;

  if (det.retestBarIdx === null) {
    const expired = candles5m.length - 1 >= det.breakoutIdx + 48;
    const state: SignalState = det.closedBackThrough ? "EXPIRED" : expired ? "EXPIRED" : "WAIT_RETEST";
    return {
      ...base,
      state,
      direction: det.direction,
      refTime: det.refCandle?.time ?? null,
      refHigh: det.refHigh,
      refLow: det.refLow,
      refVolume: det.refCandle?.volume ?? null,
      breakoutTime: candles5m[det.breakoutIdx].time,
      currentPrice,
    };
  }

  const entryPrice = refLevel;
  const stopLoss = det.direction === "LONG" ? det.refLow! : det.refHigh!;
  const riskDistance = Math.abs(entryPrice - stopLoss);
  if (riskDistance <= 0) {
    return {
      ...base,
      state: "EXPIRED",
      direction: det.direction,
      refHigh: det.refHigh,
      refLow: det.refLow,
      currentPrice,
    };
  }
  const takeProfit =
    det.direction === "LONG" ? entryPrice + riskDistance * tpMultiple : entryPrice - riskDistance * tpMultiple;

  let state: SignalState = "RETEST_CONFIRMED";
  for (let j = det.retestBarIdx; j < candles5m.length; j++) {
    const bar = candles5m[j];
    if (det.direction === "LONG") {
      if (bar.low <= stopLoss) {
        state = "SL_HIT";
        break;
      }
      if (bar.high >= takeProfit) {
        state = "TP_HIT";
        break;
      }
    } else {
      if (bar.high >= stopLoss) {
        state = "SL_HIT";
        break;
      }
      if (bar.low <= takeProfit) {
        state = "TP_HIT";
        break;
      }
    }
  }
  if (state === "RETEST_CONFIRMED" && candles5m.length - 1 >= det.trackEnd) {
    state = "EXPIRED";
  }

  return {
    symbol,
    state,
    direction: det.direction,
    refTime: det.refCandle?.time ?? null,
    refHigh: det.refHigh,
    refLow: det.refLow,
    refVolume: det.refCandle?.volume ?? null,
    breakoutTime: candles5m[det.breakoutIdx].time,
    retestTime: candles5m[det.retestBarIdx].time,
    entryPrice,
    stopLoss,
    takeProfit,
    riskDistance,
    currentPrice,
    distanceToBreakoutPct: 0,
    signalTime: candles5m[det.retestBarIdx].time,
    dataAgeMinutes: freshness.ageMinutes,
    updatedAt: Date.now(),
  };
}

export const STATE_INFO: Record<SignalState, { emoji: string; label: string }> = {
  DATA_STALE: { emoji: "🔴", label: "資料異常，暫停訊號判斷" },
  NO_SESSION_TODAY: { emoji: "⚪", label: "非交易日" },
  BEFORE_WINDOW: { emoji: "⚪", label: "尚未開盤" },
  SETUP: { emoji: "🟡", label: "開盤區間形成中" },
  WATCHING: { emoji: "🔵", label: "觀察突破中" },
  WAIT_RETEST: { emoji: "🟠", label: "已突破，等待回踩" },
  RETEST_CONFIRMED: { emoji: "🟢", label: "A級進場訊號" },
  TP_HIT: { emoji: "🟢", label: "已觸及停利" },
  SL_HIT: { emoji: "🔴", label: "已觸及停損" },
  EXPIRED: { emoji: "⚪", label: "已過期" },
};
