import { Candle } from "./binance";
import { getETInfo } from "./openRangeLab";
import { FEE_PCT, SLIPPAGE_PCT } from "./backtest";

// 回踩策略 Phase 3 — 真正的TP/SL交易模擬。
//
// 這是建立在已經驗證過、通過穩定性測試的發現之上：「等回踩才進場」在 ±0.2%/0.3%/0.5%
// 三個容忍度下都一致優於「直接進場」。這裡把它做成真正的交易（有進場價、停損、TP），
// 不再只是事件統計。
//
// 【設計】
// - 進場條件：跟事件研究一樣——觀察窗口內找出成交量最大的K線當Reference，
//   5分鐘收盤突破後，價格回踩到Reference水平±容忍度內且沒有收盤跌破，才進場。
// - 進場價：Reference水平本身（乾淨的參考價，不是回踩那根K棒的收盤價）。
// - 停損：Reference Candle區間對側（多單=Reference Low，空單=Reference High）。
//   這是唯一測試的停損方式。
// - TP：分開測 1R / 1.5R / 2R / 3R 四檔，找哪個對這個訊號最有利。
// - 出場時間上限：4小時（跟事件研究的追蹤窗口一致）。
// - 手續費+滑價已扣除。
//
// 【誠實揭露：這次沒做的】
// - 只測「等回踩」這個進場方式，沒有同時對照「直接進場」接TP/SL（先前已經證實直接進場較差，不重複做）
// - 停損只測Reference區間對側，沒有測ATR停損或其他停損倍數
// - 沒有做正式的訓練/驗證/樣本外切分
// - 沒有分年份、沒有BTC市場環境交叉分析
// - 最長開放到730天（2年）；730天在5分鐘K線下資料量非常大，手機瀏覽器執行時間可能長達10幾分鐘，
//   務必保持螢幕開啟、不要切換到其他App，否則可能被系統中斷

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const MAX_TRACK_BARS = 48; // 追蹤4小時（5分鐘K棒數）
const DEFAULT_RETEST_ZONE_PCT = 0.3;

export interface RetestTrade {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rMultiple: number;
  result: "WIN" | "LOSS" | "TIMEEXIT";
}

export function runRetestStrategyBacktest(
  symbol: string,
  candles5m: Candle[],
  windowMinutes: 30 | 60 | 90 | 120,
  tpMultiple: number,
  retestZonePct: number = DEFAULT_RETEST_ZONE_PCT
): RetestTrade[] {
  const trades: RetestTrade[] = [];
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

    const trackEnd = Math.min(breakoutIdx + MAX_TRACK_BARS, candles5m.length);
    const refLevel = direction === "LONG" ? refHigh : refLow;

    let closedBackThrough = false;
    let retestBarIdx: number | null = null;

    for (let j = breakoutIdx; j < trackEnd; j++) {
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
    if (retestBarIdx === null) continue; // 沒有出現回踩，這次不進場（已驗證直接進場較差，不重複測）

    const entryPrice = refLevel;
    const stopLoss = direction === "LONG" ? refLow : refHigh;
    const riskDistance = Math.abs(entryPrice - stopLoss);
    if (riskDistance <= 0) continue;
    const takeProfit =
      direction === "LONG" ? entryPrice + riskDistance * tpMultiple : entryPrice - riskDistance * tpMultiple;

    let result: RetestTrade["result"] = "TIMEEXIT";
    let exitIndex = retestBarIdx;
    let exitPrice = candles5m[retestBarIdx].close;

    for (let j = retestBarIdx; j < trackEnd; j++) {
      const bar = candles5m[j];
      if (direction === "LONG") {
        if (bar.low <= stopLoss) {
          exitIndex = j;
          exitPrice = stopLoss;
          result = "LOSS";
          break;
        }
        if (bar.high >= takeProfit) {
          exitIndex = j;
          exitPrice = takeProfit;
          result = "WIN";
          break;
        }
      } else {
        if (bar.high >= stopLoss) {
          exitIndex = j;
          exitPrice = stopLoss;
          result = "LOSS";
          break;
        }
        if (bar.low <= takeProfit) {
          exitIndex = j;
          exitPrice = takeProfit;
          result = "WIN";
          break;
        }
      }
      exitIndex = j;
      exitPrice = bar.close;
    }

    const grossR =
      direction === "LONG" ? (exitPrice - entryPrice) / riskDistance : (entryPrice - exitPrice) / riskDistance;
    const costR = ((FEE_PCT + SLIPPAGE_PCT) / 100) * (entryPrice / riskDistance);
    const rMultiple = grossR - costR;

    trades.push({
      symbol,
      direction,
      entryTime: candles5m[retestBarIdx].time,
      exitTime: candles5m[exitIndex].time,
      entryPrice,
      stopLoss,
      takeProfit,
      rMultiple,
      result,
    });
  }

  return trades;
}

export interface RetestStrategyReport {
  label: string;
  tradeCount: number;
  winRate: number;
  completedTrades: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdownR: number;
  maxConsecutiveLosses: number;
}

export function auditRetestStrategy(trades: RetestTrade[], label: string): RetestStrategyReport {
  const n = trades.length;
  const wins = trades.filter((t) => t.result === "WIN");
  const losses = trades.filter((t) => t.result === "LOSS");
  const completed = wins.length + losses.length;
  const winRate = completed ? (wins.length / completed) * 100 : 0;
  const expectancy = n ? trades.reduce((a, t) => a + t.rMultiple, 0) / n : 0;
  const grossWin = trades.filter((t) => t.rMultiple > 0).reduce((a, t) => a + t.rMultiple, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((a, t) => a + t.rMultiple, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  let consec = 0;
  let maxConsec = 0;
  trades.forEach((t) => {
    cum += t.rMultiple;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
    if (t.rMultiple <= 0) {
      consec++;
      if (consec > maxConsec) maxConsec = consec;
    } else {
      consec = 0;
    }
  });

  return {
    label,
    tradeCount: n,
    winRate,
    completedTrades: completed,
    expectancy,
    profitFactor,
    maxDrawdownR: maxDD,
    maxConsecutiveLosses: maxConsec,
  };
}

export const RETEST_STRATEGY_TP_OPTIONS = [1, 1.5, 2, 3];
export const RETEST_STRATEGY_DURATION_OPTIONS = [
  { label: "90天", days: 90 },
  { label: "180天（約半年）", days: 180 },
  { label: "365天（約1年）", days: 365 },
  { label: "730天（約2年，非常久，務必保持螢幕開啟）", days: 730 },
];
