import { Candle } from "./binance";
import { getETInfo } from "./openRangeLab";

// 即時訊號狀態機（Part 3-11）。
//
// 核心原則：這裡的偵測邏輯必須跟 lib/retestStrategyLab.ts 的 runRetestStrategyBacktest
// 完全一致（Reference Candle選法、突破定義、回踩定義、SL/TP公式），不重新發明。
// 差別只在於：回測是掃過歷史找出「已經發生過的完整交易」，這裡是掃「今天到目前為止」的
// K棒，回答「現在正處在哪個階段」。
//
// 【狀態說明】
// NO_SESSION_TODAY - 今天不是交易日（週末），或資料不足
// BEFORE_WINDOW    - 還沒到今天美股開盤時間
// SETUP            - 開盤區間正在形成中（還沒滿windowMinutes分鐘）
// WATCHING         - Reference Candle已形成，還沒突破
// WAIT_RETEST      - 已突破，正在等待回踩
// RETEST_CONFIRMED - 🟢 回踩確認，A級進場訊號（尚未觸及SL/TP）
// TP_HIT           - 已觸及停利
// SL_HIT           - 已觸及停損
// EXPIRED          - 追蹤時間(4小時)到了，沒有完成整個流程
//
// 【誠實揭露】
// - 這裡假設傳入的candles5m已經涵蓋「今天美股開盤以來到現在」的完整資料，資料是否夠新、
//   夠完整由呼叫端負責（用 fetchKlines 抓最近的K棒，limit要夠大）
// - 沒有處理「資料有缺口」的情況比回測嚴謹（回測會直接跳過不連續的區段，這裡假設即時資料源
//   本身是連續的）
// - RETEST_CONFIRMED 到 TP_HIT/SL_HIT 之間，如果价格同時觸及兩者，這裡跟回測一樣保守判定
//   停損優先

export type SignalState =
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
  refHigh: number | null;
  refLow: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskDistance: number | null;
  currentPrice: number | null;
  signalTime: number | null; // 進入目前狀態的K棒時間（RETEST_CONFIRMED時＝回踩確認時間）
  updatedAt: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const MAX_TRACK_BARS = 48; // 追蹤4小時（5分鐘K棒數），跟回測完全一致

export function evaluateLiveSignal(
  symbol: string,
  candles5m: Candle[],
  windowMinutes: 30 | 60 | 90 | 120,
  tpMultiple: number,
  retestZonePct: number
): LiveSignal {
  const base: LiveSignal = {
    symbol,
    state: "NO_SESSION_TODAY",
    direction: null,
    refHigh: null,
    refLow: null,
    entryPrice: null,
    stopLoss: null,
    takeProfit: null,
    riskDistance: null,
    currentPrice: candles5m.length ? candles5m[candles5m.length - 1].close : null,
    signalTime: null,
    updatedAt: Date.now(),
  };

  if (candles5m.length === 0) return base;

  const lastInfo = getETInfo(candles5m[candles5m.length - 1].time);
  if (!WEEKDAYS.includes(lastInfo.weekday)) return { ...base, state: "NO_SESSION_TODAY" };

  const windowBars = windowMinutes / 5;

  // 找今天(ET)09:30那根K棒
  let openIdx = -1;
  for (let i = 0; i < candles5m.length; i++) {
    const info = getETInfo(candles5m[i].time);
    if (
      info.hour === 9 &&
      info.minute === 30 &&
      info.year === lastInfo.year &&
      info.month === lastInfo.month &&
      info.day === lastInfo.day
    ) {
      openIdx = i;
      break;
    }
  }
  if (openIdx === -1) return { ...base, state: "BEFORE_WINDOW" };

  const windowEnd = openIdx + windowBars;
  if (candles5m.length - 1 < windowEnd) return { ...base, state: "SETUP" };

  const windowBarsArr = candles5m.slice(openIdx, windowEnd);
  let refIdx = 0;
  for (let k = 1; k < windowBarsArr.length; k++) {
    if (windowBarsArr[k].volume > windowBarsArr[refIdx].volume) refIdx = k;
  }
  const refCandle = windowBarsArr[refIdx];
  const refHigh = refCandle.high;
  const refLow = refCandle.low;

  const trackEndCap = Math.min(windowEnd + MAX_TRACK_BARS, candles5m.length);

  // 找突破
  let breakoutIdx = -1;
  let direction: "LONG" | "SHORT" | null = null;
  for (let j = windowEnd; j < candles5m.length; j++) {
    const bar = candles5m[j];
    if (bar.close > refHigh) {
      breakoutIdx = j;
      direction = "LONG";
      break;
    }
    if (bar.close < refLow) {
      breakoutIdx = j;
      direction = "SHORT";
      break;
    }
  }

  if (breakoutIdx === -1) {
    const expired = candles5m.length >= windowEnd + MAX_TRACK_BARS;
    return { ...base, state: expired ? "EXPIRED" : "WATCHING", refHigh, refLow };
  }

  const refLevel = direction === "LONG" ? refHigh : refLow;
  const trackEnd = Math.min(breakoutIdx + MAX_TRACK_BARS, candles5m.length);

  let closedBackThrough = false;
  let retestBarIdx: number | null = null;
  for (let j = breakoutIdx; j < candles5m.length; j++) {
    const bar = candles5m[j];
    if (direction === "LONG") {
      if (bar.close < refHigh) closedBackThrough = true;
      if (retestBarIdx === null && j > breakoutIdx && !closedBackThrough && bar.low <= refHigh * (1 + retestZonePct / 100)) {
        retestBarIdx = j;
      }
    } else {
      if (bar.close > refLow) closedBackThrough = true;
      if (retestBarIdx === null && j > breakoutIdx && !closedBackThrough && bar.high >= refLow * (1 - retestZonePct / 100)) {
        retestBarIdx = j;
      }
    }
  }

  if (retestBarIdx === null) {
    const expired = candles5m.length >= breakoutIdx + MAX_TRACK_BARS;
    if (closedBackThrough) return { ...base, state: "EXPIRED", direction, refHigh, refLow };
    return { ...base, state: expired ? "EXPIRED" : "WAIT_RETEST", direction, refHigh, refLow };
  }

  const entryPrice = refLevel;
  const stopLoss = direction === "LONG" ? refLow : refHigh;
  const riskDistance = Math.abs(entryPrice - stopLoss);
  if (riskDistance <= 0) return { ...base, state: "EXPIRED", direction, refHigh, refLow };
  const takeProfit =
    direction === "LONG" ? entryPrice + riskDistance * tpMultiple : entryPrice - riskDistance * tpMultiple;

  let state: SignalState = "RETEST_CONFIRMED";
  for (let j = retestBarIdx; j < candles5m.length; j++) {
    const bar = candles5m[j];
    if (direction === "LONG") {
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
  if (state === "RETEST_CONFIRMED" && candles5m.length >= trackEnd) {
    state = "EXPIRED"; // 4小時追蹤時間到了還沒碰SL/TP，視為過期，不是正式SL/TP結果
  }

  return {
    symbol,
    state,
    direction,
    refHigh,
    refLow,
    entryPrice,
    stopLoss,
    takeProfit,
    riskDistance,
    currentPrice: candles5m[candles5m.length - 1].close,
    signalTime: candles5m[retestBarIdx].time,
    updatedAt: Date.now(),
  };
}

export const STATE_INFO: Record<SignalState, { emoji: string; label: string }> = {
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
