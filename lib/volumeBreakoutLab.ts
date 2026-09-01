import { Candle } from "./binance";
import { getETInfo } from "./openRangeLab";

// 美股開盤高成交量K突破 — 事件研究 v1（不是交易策略，沒有TP/SL）。
//
// 目的：先回答「這個市場事件本身，到底有沒有可利用的統計優勢」，再決定值不值得
// 進一步做成交易策略。這是規格書裡明確要求的「第一階段」，第二階段（真正做TP/SL）
// 只有第一階段發現統計上的方向性才值得做。
//
// 【這一版做了什麼】
// - 用5分鐘K線，開盤(09:30 ET)後的觀察窗口（30/60/90/120分鐘，可選一個）裡，
//   找出成交量最大的那根K線當作 Reference Candle。
// - 突破定義：只做「5分鐘收盤突破」（Reference Candle 的高/低點），影線突破、
//   連續兩根確認突破沒做。
// - 不設停損停利，純粹統計突破後的價格路徑：MFE/MAE（30分/1H/2H/4H四個時間點）、
//   假突破率（15分/30分/1H三個時間窗）、達到 +0.25%/0.5%/1%/2%/3% 的機率。
// - 成交量倍率分箱（Reference Candle成交量 / 觀察窗口內平均成交量）。
// - 分幣種、分方向（多方事件/空方事件）。
//
// 【這一版沒做，誠實揭露】
// - 只測收盤突破，影線突破、連續兩根確認突破沒做
// - 沒有分 Reference Candle 多空方向（陽線/陰線）與實體比例(Body/Range)的交叉分析
// - 沒有分開盤後出現時間（09:30-09:45等區段）的分析
// - 沒有 Reference Range / ATR 大小分箱
// - 沒有 BTC 領先訊號研究（BTC先突破、其他幣是否跟隨）
// - 沒有分年份、分市場環境(Bull/Bear/Sideways)
// - 這是事件研究階段，沒有任何交易策略／TP/SL/進場模擬

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const CHECKPOINTS = { m30: 6, h1: 12, h2: 24, h4: 48 }; // 5分鐘K棒數
const MAX_TRACK_BARS = 48; // 追蹤4小時

export interface VolumeBreakoutEvent {
  symbol: string;
  direction: "LONG" | "SHORT";
  refTime: number;
  breakoutTime: number;
  breakoutPrice: number;
  volumeRatio: number; // Reference Candle成交量 / 觀察窗口內平均成交量
  mfe30: number;
  mfe60: number;
  mfe120: number;
  mfe240: number;
  mae30: number;
  mae60: number;
  mae120: number;
  mae240: number;
  falseBreakout15: boolean;
  falseBreakout30: boolean;
  falseBreakout60: boolean;
  achieved025: boolean;
  achieved05: boolean;
  achieved1: boolean;
  achieved2: boolean;
  achieved3: boolean;
  weekday: string;
  year: number;
}

export function runVolumeBreakoutEventStudy(
  symbol: string,
  candles5m: Candle[],
  windowMinutes: 30 | 60 | 90 | 120
): VolumeBreakoutEvent[] {
  const events: VolumeBreakoutEvent[] = [];
  const windowBars = windowMinutes / 5;

  for (let i = 0; i < candles5m.length - windowBars - MAX_TRACK_BARS; i++) {
    const first = candles5m[i];
    const info = getETInfo(first.time);
    if (info.hour !== 9 || info.minute !== 30 || !WEEKDAYS.includes(info.weekday)) continue;

    const windowBarsArr = candles5m.slice(i, i + windowBars);
    if (windowBarsArr.length < windowBars) continue;
    let contiguous = true;
    for (let k = 1; k < windowBarsArr.length; k++) {
      if (windowBarsArr[k].time - windowBarsArr[k - 1].time !== 300) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) continue;

    let refIdx = 0;
    for (let k = 1; k < windowBarsArr.length; k++) {
      if (windowBarsArr[k].volume > windowBarsArr[refIdx].volume) refIdx = k;
    }
    const refCandle = windowBarsArr[refIdx];
    const avgVol = windowBarsArr.reduce((a, c) => a + c.volume, 0) / windowBarsArr.length;
    const volumeRatio = avgVol > 0 ? refCandle.volume / avgVol : 1;
    const refHigh = refCandle.high;
    const refLow = refCandle.low;

    let breakoutIdx = -1;
    let direction: "LONG" | "SHORT" | null = null;
    for (let j = i + windowBars; j < Math.min(i + windowBars + MAX_TRACK_BARS, candles5m.length); j++) {
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
    if (breakoutIdx === -1 || !direction) continue;

    const breakoutPrice = candles5m[breakoutIdx].close;
    const trackEnd = Math.min(breakoutIdx + MAX_TRACK_BARS, candles5m.length);

    let worst = breakoutPrice;
    let best = breakoutPrice;
    const snapshots: Record<string, { mfe: number; mae: number }> = {};
    let falseBreakout15 = false;
    let falseBreakout30 = false;
    let falseBreakout60 = false;

    for (let j = breakoutIdx; j < trackEnd; j++) {
      const bar = candles5m[j];
      const barsElapsed = j - breakoutIdx;
      if (direction === "LONG") {
        if (bar.low < worst) worst = bar.low;
        if (bar.high > best) best = bar.high;
        if (bar.close < refHigh) {
          if (barsElapsed <= 3) falseBreakout15 = true;
          if (barsElapsed <= 6) falseBreakout30 = true;
          if (barsElapsed <= 12) falseBreakout60 = true;
        }
      } else {
        if (bar.high > worst) worst = bar.high;
        if (bar.low < best) best = bar.low;
        if (bar.close > refLow) {
          if (barsElapsed <= 3) falseBreakout15 = true;
          if (barsElapsed <= 6) falseBreakout30 = true;
          if (barsElapsed <= 12) falseBreakout60 = true;
        }
      }

      (Object.keys(CHECKPOINTS) as (keyof typeof CHECKPOINTS)[]).forEach((key) => {
        if (barsElapsed === CHECKPOINTS[key] - 1) {
          const mfePct =
            direction === "LONG"
              ? ((best - breakoutPrice) / breakoutPrice) * 100
              : ((breakoutPrice - best) / breakoutPrice) * 100;
          const maePct =
            direction === "LONG"
              ? ((breakoutPrice - worst) / breakoutPrice) * 100
              : ((worst - breakoutPrice) / breakoutPrice) * 100;
          snapshots[key] = { mfe: Math.max(0, mfePct), mae: Math.max(0, maePct) };
        }
      });
    }
    (Object.keys(CHECKPOINTS) as (keyof typeof CHECKPOINTS)[]).forEach((key) => {
      if (!snapshots[key]) {
        const mfePct =
          direction === "LONG"
            ? ((best - breakoutPrice) / breakoutPrice) * 100
            : ((breakoutPrice - best) / breakoutPrice) * 100;
        const maePct =
          direction === "LONG"
            ? ((breakoutPrice - worst) / breakoutPrice) * 100
            : ((worst - breakoutPrice) / breakoutPrice) * 100;
        snapshots[key] = { mfe: Math.max(0, mfePct), mae: Math.max(0, maePct) };
      }
    });

    const finalMfePct = snapshots.h4.mfe;
    events.push({
      symbol,
      direction,
      refTime: refCandle.time,
      breakoutTime: candles5m[breakoutIdx].time,
      breakoutPrice,
      volumeRatio,
      mfe30: snapshots.m30.mfe,
      mfe60: snapshots.h1.mfe,
      mfe120: snapshots.h2.mfe,
      mfe240: snapshots.h4.mfe,
      mae30: snapshots.m30.mae,
      mae60: snapshots.h1.mae,
      mae120: snapshots.h2.mae,
      mae240: snapshots.h4.mae,
      falseBreakout15,
      falseBreakout30,
      falseBreakout60,
      achieved025: finalMfePct >= 0.25,
      achieved05: finalMfePct >= 0.5,
      achieved1: finalMfePct >= 1,
      achieved2: finalMfePct >= 2,
      achieved3: finalMfePct >= 3,
      weekday: info.weekday,
      year: info.year,
    });
  }

  return events;
}

export interface VolumeBreakoutReport {
  label: string;
  eventCount: number;
  avgVolumeRatio: number;
  falseBreakoutRate15: number;
  falseBreakoutRate30: number;
  falseBreakoutRate60: number;
  achieved025Rate: number;
  achieved05Rate: number;
  achieved1Rate: number;
  achieved2Rate: number;
  achieved3Rate: number;
  avgMfe30: number;
  avgMfe60: number;
  avgMfe120: number;
  avgMfe240: number;
  avgMae30: number;
  avgMae60: number;
  avgMae120: number;
  avgMae240: number;
}

export function auditVolumeBreakout(events: VolumeBreakoutEvent[], label: string): VolumeBreakoutReport {
  const n = events.length;
  const avg = (fn: (e: VolumeBreakoutEvent) => number) => (n ? events.reduce((a, e) => a + fn(e), 0) / n : 0);
  const rate = (fn: (e: VolumeBreakoutEvent) => boolean) => (n ? (events.filter(fn).length / n) * 100 : 0);

  return {
    label,
    eventCount: n,
    avgVolumeRatio: avg((e) => e.volumeRatio),
    falseBreakoutRate15: rate((e) => e.falseBreakout15),
    falseBreakoutRate30: rate((e) => e.falseBreakout30),
    falseBreakoutRate60: rate((e) => e.falseBreakout60),
    achieved025Rate: rate((e) => e.achieved025),
    achieved05Rate: rate((e) => e.achieved05),
    achieved1Rate: rate((e) => e.achieved1),
    achieved2Rate: rate((e) => e.achieved2),
    achieved3Rate: rate((e) => e.achieved3),
    avgMfe30: avg((e) => e.mfe30),
    avgMfe60: avg((e) => e.mfe60),
    avgMfe120: avg((e) => e.mfe120),
    avgMfe240: avg((e) => e.mfe240),
    avgMae30: avg((e) => e.mae30),
    avgMae60: avg((e) => e.mae60),
    avgMae120: avg((e) => e.mae120),
    avgMae240: avg((e) => e.mae240),
  };
}

export const VOLUME_RATIO_BINS: { label: string; min: number; max: number }[] = [
  { label: "<0.8", min: -Infinity, max: 0.8 },
  { label: "0.8~1.0", min: 0.8, max: 1.0 },
  { label: "1.0~1.2", min: 1.0, max: 1.2 },
  { label: "1.2~1.5", min: 1.2, max: 1.5 },
  { label: "1.5~2", min: 1.5, max: 2 },
  { label: ">2", min: 2, max: Infinity },
];
