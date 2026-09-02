import { Candle } from "./binance";
import { getETInfo } from "./openRangeLab";
import { FEE_PCT, SLIPPAGE_PCT } from "./backtest";
import { detectFromOpen, WEEKDAYS, MAX_TRACK_BARS } from "./retestCore";

// 回踩策略 Phase 3 — 真正的TP/SL交易模擬。
//
// 驗收修正：偵測邏輯（Reference Candle選法/突破/回踩）已改為呼叫 lib/retestCore.ts 的
// detectFromOpen()，跟即時引擎（lib/retestEngine.ts）共用同一份程式碼，不再是兩份平行邏輯。
// 這裡只負責「掃過歷史找出每一次09:30開盤」+「把偵測結果轉換成完整交易(含SL/TP模擬)」，
// 偵測本身完全交給共用核心。
//
// 【設計】
// - 進場價：Reference水平本身。
// - 停損：Reference Candle區間對側。
// - TP：可指定倍數。
// - 出場時間上限：4小時。
// - 手續費+滑價已扣除。
//
// 【誠實揭露：這次沒做的】
// - 只測「等回踩」這個進場方式，不重複測直接進場（已證實較差）
// - 停損只測Reference區間對側，沒有測ATR停損或其他停損倍數
// - 沒有分年份、沒有BTC市場環境交叉分析
// - 最長開放到730天（2年）；730天在5分鐘K線下資料量非常大，手機瀏覽器執行時間可能長達10幾分鐘，
//   務必保持螢幕開啟、不要切換到其他App，否則可能被系統中斷

const DEFAULT_RETEST_ZONE_PCT = 0.3;

export interface RetestTrade {
  symbol: string;
  direction: "LONG" | "SHORT";
  refTime: number;
  refHigh: number;
  refLow: number;
  refVolume: number;
  breakoutTime: number;
  retestTime: number;
  retestPrice: number; // 回踩那根K棒觸及到的價格（低點/高點），跟entryPrice(乾淨水平)分開記錄
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
    const info = getETInfo(candles5m[i].time);
    if (info.hour !== 9 || info.minute !== 30 || !WEEKDAYS.includes(info.weekday)) continue;

    // 確認這windowBars根K棒本身連續(沒有資料缺口)，這是回測特有的資料品質檢查，
    // 即時引擎不需要這個檢查(即時資料源假設本身連續)。
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

    const det = detectFromOpen(candles5m, i, windowBars, retestZonePct);
    if (det.windowIncomplete || !det.refCandle || det.retestBarIdx === null || !det.direction || det.breakoutIdx === null) {
      continue; // 沒有出現回踩，或還沒收集滿觀察窗口，這次不進場
    }

    const { refCandle, refHigh, refLow, direction, breakoutIdx, retestBarIdx, trackEnd } = det;
    const refLevel = direction === "LONG" ? refHigh! : refLow!;
    const entryPrice = refLevel;
    const stopLoss = direction === "LONG" ? refLow! : refHigh!;
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
    const retestBar = candles5m[retestBarIdx];
    const retestPrice = direction === "LONG" ? retestBar.low : retestBar.high;

    trades.push({
      symbol,
      direction,
      refTime: refCandle.time,
      refHigh: refHigh!,
      refLow: refLow!,
      refVolume: refCandle.volume,
      breakoutTime: candles5m[breakoutIdx].time,
      retestTime: candles5m[retestBarIdx].time,
      retestPrice,
      entryTime: candles5m[retestBarIdx].time,
      exitTime: candles5m[exitIndex].time,
      entryPrice,
      stopLoss,
      takeProfit,
      rMultiple,
      result,
    });

    i = exitIndex; // 同一個Reference Candle只產生一次交易事件，跳到這筆交易結束後繼續掃
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

// 訓練/驗證/樣本外三段切分：前60%當訓練段、中間20%當驗證段、最後20%完全不能拿來調參，
// 只能用來最後檢驗一次。依進場時間排序後照比例切，不是隨機打散（保留時間先後順序）。
export function splitTrainValOOS(trades: RetestTrade[]): {
  train: RetestTrade[];
  validation: RetestTrade[];
  oos: RetestTrade[];
} {
  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const trainEnd = Math.floor(sorted.length * 0.6);
  const valEnd = Math.floor(sorted.length * 0.8);
  return {
    train: sorted.slice(0, trainEnd),
    validation: sorted.slice(trainEnd, valEnd),
    oos: sorted.slice(valEnd),
  };
}
