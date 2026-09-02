import { Candle } from "./binance";
import { getETInfo } from "./openRangeLab";

// 回踩策略核心偵測邏輯 — 唯一的真相來源（Single Source of Truth）。
//
// 這是驗收第1項的修正：回測（retestStrategyLab.ts）跟即時引擎（retestEngine.ts）
// 之前是兩份平行but邏輯相同的程式碼，有日後修改時漂移不同步的風險。
// 現在兩邊都呼叫這裡的 detectFromOpen()，Reference Candle 選法、突破定義、回踩定義
// 完全共用同一份程式碼，不會再有兩邊不一致的可能。
//
// 這個函式本身不知道自己是在跑「回測」還是「即時」——它純粹是：
// 「給定一個09:30那根K棒的位置，跟這根K棒之後所有能看到的K棒，告訴我目前偵測到什麼」。
// 回測呼叫時，candles是完整歷史陣列，所以breakout/retest通常能找到完整結果。
// 即時引擎呼叫時，candles只到「現在」，所以可能還沒掃到breakout或retest，
// 這正是「即時」跟「回測」唯一該有的差異——資料看到多少，不是判斷邏輯不同。

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const MAX_TRACK_BARS = 48; // 追蹤上限4小時（5分鐘K棒數）

export interface RetestDetection {
  windowEnd: number; // Reference Candle觀察窗口結束的index
  refCandle: Candle | null;
  refHigh: number | null;
  refLow: number | null;
  breakoutIdx: number | null;
  direction: "LONG" | "SHORT" | null;
  retestBarIdx: number | null;
  closedBackThrough: boolean; // 突破後是否曾經收盤跌破回Reference內（代表這次突破已經失敗）
  trackEnd: number; // 4小時追蹤窗口的index上限（用來判斷EXPIRED）
  windowIncomplete: boolean; // true代表觀察窗口還沒收集滿（資料不足以形成Reference Candle）
}

// candles: 該從哪一根K棒開始找都可以，只要 candles[openIdx] 是09:30那根。
// 呼叫前必須自己確認 openIdx 對應的是正確的09:30 ET K棒（用 getETInfo 檢查），
// 這裡不重複檢查時間，只負責偵測邏輯本身。
export function detectFromOpen(
  candles: Candle[],
  openIdx: number,
  windowBars: number,
  retestZonePct: number
): RetestDetection {
  const windowEnd = openIdx + windowBars;
  const base: RetestDetection = {
    windowEnd,
    refCandle: null,
    refHigh: null,
    refLow: null,
    breakoutIdx: null,
    direction: null,
    retestBarIdx: null,
    closedBackThrough: false,
    trackEnd: windowEnd + MAX_TRACK_BARS,
    windowIncomplete: false,
  };

  // Look-ahead bias 防護：觀察窗口還沒收集滿 windowBars 根K棒之前，
  // 不能宣稱已經知道哪一根是最大成交量K。
  if (candles.length - 1 < windowEnd) {
    return { ...base, windowIncomplete: true };
  }

  const windowBarsArr = candles.slice(openIdx, windowEnd);
  let refIdx = 0;
  for (let k = 1; k < windowBarsArr.length; k++) {
    if (windowBarsArr[k].volume > windowBarsArr[refIdx].volume) refIdx = k;
  }
  const refCandle = windowBarsArr[refIdx];
  const refHigh = refCandle.high;
  const refLow = refCandle.low;

  // 找突破：只從windowEnd(觀察窗口結束後)開始找，不會提前使用窗口內的資料判斷突破
  let breakoutIdx: number | null = null;
  let direction: "LONG" | "SHORT" | null = null;
  const breakoutScanEnd = Math.min(windowEnd + MAX_TRACK_BARS, candles.length);
  for (let j = windowEnd; j < breakoutScanEnd; j++) {
    const bar = candles[j];
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

  if (breakoutIdx === null || !direction) {
    return { ...base, refCandle, refHigh, refLow };
  }

  const trackEnd = Math.min(breakoutIdx + MAX_TRACK_BARS, candles.length);
  let closedBackThrough = false;
  let retestBarIdx: number | null = null;

  for (let j = breakoutIdx; j < candles.length && j < breakoutIdx + MAX_TRACK_BARS; j++) {
    const bar = candles[j];
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

  return {
    windowEnd,
    refCandle,
    refHigh,
    refLow,
    breakoutIdx,
    direction,
    retestBarIdx,
    closedBackThrough,
    trackEnd,
    windowIncomplete: false,
  };
}

// 找出 candles 陣列中，跟「最後一根K棒同一天」的09:30 ET K棒的index。
// 用在即時引擎：只關心「今天」的開盤區間。
export function findTodayOpenIdx(candles: Candle[]): number {
  if (candles.length === 0) return -1;
  const lastInfo = getETInfo(candles[candles.length - 1].time);
  for (let i = 0; i < candles.length; i++) {
    const info = getETInfo(candles[i].time);
    if (
      info.hour === 9 &&
      info.minute === 30 &&
      info.year === lastInfo.year &&
      info.month === lastInfo.month &&
      info.day === lastInfo.day
    ) {
      return i;
    }
  }
  return -1;
}

// 判斷資料是否新鮮（驗收第4項：資料延遲或異常時禁止產生訊號）。
// maxAgeMinutes 預設15分鐘 = 3根5分鐘K棒的容忍度，超過這個視為資料異常。
export function checkDataFreshness(candles: Candle[], maxAgeMinutes: number = 15): { fresh: boolean; ageMinutes: number | null } {
  if (candles.length === 0) return { fresh: false, ageMinutes: null };
  const lastBarTime = candles[candles.length - 1].time * 1000;
  const ageMinutes = (Date.now() - lastBarTime) / 60000;
  return { fresh: ageMinutes <= maxAgeMinutes, ageMinutes };
}
