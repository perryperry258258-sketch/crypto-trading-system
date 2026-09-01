import { Candle } from "./binance";
import { getETInfo } from "./openRangeLab";

// 美股開盤高成交量K突破 — 事件研究 v2（不是交易策略，沒有TP/SL）。
//
// 目的：先回答「這個市場事件本身，到底有沒有可利用的統計優勢」，再決定值不值得
// 進一步做成交易策略。
//
// 【v2 新增】
// - 回踩研究（Phase 2 最重要的部分）：突破後，價格是否曾回踩到 Reference High/Low 附近
//   但沒有真正收盤跌破，之後才繼續往突破方向走。分開統計「直接進場」vs「等回踩才進場」
//   兩種事件的表現，回答「等回踩會不會比較好」。
// - CLV（Close Location Value）分箱：(收盤-最低)/(最高-最低)，衡量 Reference Candle
//   收在當根區間的哪個位置。
// - 95% 信賴區間（Wilson score interval），不是只給單一百分比數字。
//
// 【誠實揭露：無 look-ahead bias】Reference Candle 是用完整觀察窗口的資料選出來的，
// 但突破偵測的迴圈是從「觀察窗口結束後」才開始找（i + windowBars 之後），
// 不會提前使用窗口結束前還沒發生的資料，這點已確認沒有問題。
//
// 【這一版仍然沒做，誠實揭露】
// - 只測收盤突破，影線突破、連續兩根確認突破、收盤+成交量confirmed沒做
// - 沒有分開盤後出現時間（09:30-09:45等區段）的分析
// - 沒有 Reference Range / ATR 大小分箱、沒有突破距離(Breakout Distance)研究
// - 沒有 BTC 市場環境分類、沒有 BTC 領先訊號研究（BTC先突破、其他幣是否跟隨）
// - 沒有分年份
// - 這是事件研究階段，沒有任何交易策略／TP/SL/部位大小設計

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const CHECKPOINTS = { m30: 6, h1: 12, h2: 24, h4: 48 }; // 5分鐘K棒數
const MAX_TRACK_BARS = 48; // 追蹤4小時
const RETEST_ZONE_PCT = 0.3; // 回踩容許範圍：距離Reference水平±0.3%內算「碰到」

function computeSnapshots(
  candles5m: Candle[],
  startIdx: number,
  trackEnd: number,
  refPrice: number,
  direction: "LONG" | "SHORT"
): { snapshots: Record<string, { mfe: number; mae: number }>; worst: number; best: number } {
  let worst = refPrice;
  let best = refPrice;
  const snapshots: Record<string, { mfe: number; mae: number }> = {};

  for (let j = startIdx; j < trackEnd; j++) {
    const bar = candles5m[j];
    const barsElapsed = j - startIdx;
    if (direction === "LONG") {
      if (bar.low < worst) worst = bar.low;
      if (bar.high > best) best = bar.high;
    } else {
      if (bar.high > worst) worst = bar.high;
      if (bar.low < best) best = bar.low;
    }
    (Object.keys(CHECKPOINTS) as (keyof typeof CHECKPOINTS)[]).forEach((key) => {
      if (barsElapsed === CHECKPOINTS[key] - 1 && !snapshots[key]) {
        const mfePct =
          direction === "LONG" ? ((best - refPrice) / refPrice) * 100 : ((refPrice - best) / refPrice) * 100;
        const maePct =
          direction === "LONG" ? ((refPrice - worst) / refPrice) * 100 : ((worst - refPrice) / refPrice) * 100;
        snapshots[key] = { mfe: Math.max(0, mfePct), mae: Math.max(0, maePct) };
      }
    });
  }
  (Object.keys(CHECKPOINTS) as (keyof typeof CHECKPOINTS)[]).forEach((key) => {
    if (!snapshots[key]) {
      const mfePct =
        direction === "LONG" ? ((best - refPrice) / refPrice) * 100 : ((refPrice - best) / refPrice) * 100;
      const maePct =
        direction === "LONG" ? ((refPrice - worst) / refPrice) * 100 : ((worst - refPrice) / refPrice) * 100;
      snapshots[key] = { mfe: Math.max(0, mfePct), mae: Math.max(0, maePct) };
    }
  });
  return { snapshots, worst, best };
}

export interface VolumeBreakoutEvent {
  symbol: string;
  direction: "LONG" | "SHORT";
  refTime: number;
  breakoutTime: number;
  breakoutPrice: number;
  volumeRatio: number;
  clv: number; // Reference Candle 的 Close Location Value，0~1
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
  retestFound: boolean;
  retestMfe30: number;
  retestMfe60: number;
  retestMfe120: number;
  retestMfe240: number;
  retestMae30: number;
  retestMae60: number;
  retestMae120: number;
  retestMae240: number;
  retestAchieved025: boolean;
  retestAchieved05: boolean;
  retestAchieved1: boolean;
  retestAchieved2: boolean;
  retestAchieved3: boolean;
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
    const clv = refHigh > refLow ? (refCandle.close - refLow) / (refHigh - refLow) : 0.5;

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
    const refLevel = direction === "LONG" ? refHigh : refLow;

    let falseBreakout15 = false;
    let falseBreakout30 = false;
    let falseBreakout60 = false;
    let closedBackThrough = false;
    let retestBarIdx: number | null = null;

    for (let j = breakoutIdx; j < trackEnd; j++) {
      const bar = candles5m[j];
      const barsElapsed = j - breakoutIdx;
      if (direction === "LONG") {
        if (bar.close < refHigh) {
          closedBackThrough = true;
          if (barsElapsed <= 3) falseBreakout15 = true;
          if (barsElapsed <= 6) falseBreakout30 = true;
          if (barsElapsed <= 12) falseBreakout60 = true;
        }
        if (
          retestBarIdx === null &&
          j > breakoutIdx &&
          !closedBackThrough &&
          bar.low <= refHigh * (1 + RETEST_ZONE_PCT / 100)
        ) {
          retestBarIdx = j;
        }
      } else {
        if (bar.close > refLow) {
          closedBackThrough = true;
          if (barsElapsed <= 3) falseBreakout15 = true;
          if (barsElapsed <= 6) falseBreakout30 = true;
          if (barsElapsed <= 12) falseBreakout60 = true;
        }
        if (
          retestBarIdx === null &&
          j > breakoutIdx &&
          !closedBackThrough &&
          bar.high >= refLow * (1 - RETEST_ZONE_PCT / 100)
        ) {
          retestBarIdx = j;
        }
      }
    }

    const { snapshots } = computeSnapshots(candles5m, breakoutIdx, trackEnd, breakoutPrice, direction);
    const finalMfePct = snapshots.h4.mfe;

    let retestFound = false;
    let retestSnap = { m30: { mfe: 0, mae: 0 }, h1: { mfe: 0, mae: 0 }, h2: { mfe: 0, mae: 0 }, h4: { mfe: 0, mae: 0 } };
    if (retestBarIdx !== null) {
      retestFound = true;
      const r = computeSnapshots(candles5m, retestBarIdx, trackEnd, refLevel, direction);
      retestSnap = r.snapshots as typeof retestSnap;
    }
    const retestFinalMfePct = retestSnap.h4.mfe;

    events.push({
      symbol,
      direction,
      refTime: refCandle.time,
      breakoutTime: candles5m[breakoutIdx].time,
      breakoutPrice,
      volumeRatio,
      clv,
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
      retestFound,
      retestMfe30: retestSnap.m30.mfe,
      retestMfe60: retestSnap.h1.mfe,
      retestMfe120: retestSnap.h2.mfe,
      retestMfe240: retestSnap.h4.mfe,
      retestMae30: retestSnap.m30.mae,
      retestMae60: retestSnap.h1.mae,
      retestMae120: retestSnap.h2.mae,
      retestMae240: retestSnap.h4.mae,
      retestAchieved025: retestFinalMfePct >= 0.25,
      retestAchieved05: retestFinalMfePct >= 0.5,
      retestAchieved1: retestFinalMfePct >= 1,
      retestAchieved2: retestFinalMfePct >= 2,
      retestAchieved3: retestFinalMfePct >= 3,
      weekday: info.weekday,
      year: info.year,
    });
  }

  return events;
}

// Wilson score interval：比單純用 標準差 估計的信賴區間，在樣本數較小或機率接近0/100%時更準確
export function wilsonCI(successes: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const phat = successes / n;
  const denom = 1 + (z * z) / n;
  const center = phat + (z * z) / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n));
  const lower = (center - margin) / denom;
  const upper = (center + margin) / denom;
  return [Math.max(0, lower * 100), Math.min(100, upper * 100)];
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
  achieved1RateCI: [number, number];
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
  const achieved1Count = events.filter((e) => e.achieved1).length;

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
    achieved1RateCI: wilsonCI(achieved1Count, n),
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

// 把「等回踩才進場」的事件，轉成跟直接進場同樣的資料結構，方便重複使用 auditVolumeBreakout。
export function toRetestReport(events: VolumeBreakoutEvent[], label: string): VolumeBreakoutReport {
  const retestQualified = events.filter((e) => e.retestFound);
  const mapped: VolumeBreakoutEvent[] = retestQualified.map((e) => ({
    ...e,
    mfe30: e.retestMfe30,
    mfe60: e.retestMfe60,
    mfe120: e.retestMfe120,
    mfe240: e.retestMfe240,
    mae30: e.retestMae30,
    mae60: e.retestMae60,
    mae120: e.retestMae120,
    mae240: e.retestMae240,
    achieved025: e.retestAchieved025,
    achieved05: e.retestAchieved05,
    achieved1: e.retestAchieved1,
    achieved2: e.retestAchieved2,
    achieved3: e.retestAchieved3,
  }));
  return auditVolumeBreakout(mapped, label);
}

export const VOLUME_RATIO_BINS: { label: string; min: number; max: number }[] = [
  { label: "<0.8", min: -Infinity, max: 0.8 },
  { label: "0.8~1.0", min: 0.8, max: 1.0 },
  { label: "1.0~1.2", min: 1.0, max: 1.2 },
  { label: "1.2~1.5", min: 1.2, max: 1.5 },
  { label: "1.5~2", min: 1.5, max: 2 },
  { label: ">2", min: 2, max: Infinity },
];

export const CLV_BINS: { label: string; min: number; max: number }[] = [
  { label: "CLV<0.2", min: -Infinity, max: 0.2 },
  { label: "0.2~0.4", min: 0.2, max: 0.4 },
  { label: "0.4~0.6", min: 0.4, max: 0.6 },
  { label: "0.6~0.8", min: 0.6, max: 0.8 },
  { label: "CLV>0.8", min: 0.8, max: Infinity },
];
