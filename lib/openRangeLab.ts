import { Candle } from "./binance";
import { FEE_PCT, SLIPPAGE_PCT } from "./backtest";

// 美股開盤區間突破策略（US Open Range Breakout）Lab v1。
//
// 這是全新、獨立的策略，跟系統其他的 A級策略／進場邏輯實驗室完全分開，不會互相影響。
//
// 【這一版做了什麼】
// - 開盤區間：09:30 美東時間開始，30分鐘或60分鐘（可選），用瀏覽器原生 Intl.DateTimeFormat 搭配
//   America/New_York 時區換算，夏令時間(DST)由瀏覽器的時區資料庫自動處理，沒有寫死偏移量。
// - 突破判定：只做「收盤突破」（區間後那一段K棒收盤價 > 區間高 / < 區間低）。
// - 進場：突破確認後，下一根K棒開盤才進場，不用突破那根的收盤價假設成交。
// - 停損：只測「區間對側」（多單停損=區間低，空單停損=區間高）。
// - TP：分開測 1R / 2R / 3R 三檔。
// - 出場時間：當天美股收盤（16:00 ET）強制出場，這是唯一測試的時間出場規則。
// - 多單/空單分開統計，不假設兩邊表現一樣。
// - 只算平日（週一～週五）的區間，週末沒有真正的「美股開盤」，不列入。
// - 同一根K棒內同時觸及停損與TP：保守判定停損優先。
//
// 【這一版沒做，誠實揭露】
// - 只做收盤突破，影線突破、收盤+成交量確認突破這兩版沒做
// - 只測區間對側停損，ATR停損、區間大小倍數停損沒做
// - 只測美股收盤這一種時間出場，30分/1H/2H/4H/隔日開盤這些沒做
// - 沒有正式的訓練/驗證/樣本外三段切分，也沒有跨年份/跨幣種的嚴格 walk-forward
// - 沒有 BTC 大盤環境交叉分析、沒有成交量比例分箱、沒有區間大小分箱
// - 沒有參數穩定性掃描（例如停損倍數在鄰近值是否都有效）

export interface ETInfo {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string; // "Mon".."Sun"
}

export function getETInfo(unixSeconds: number): ETInfo {
  const d = new Date(unixSeconds * 1000);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // en-US的 hour12:false 有時會給 "24" 代表午夜
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export interface OpenRangeTrade {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rMultiple: number;
  result: "WIN" | "LOSS" | "TIMEEXIT";
  mfeR: number; // 出場前最有利的價格，換算成R倍數
  maeR: number;
  falseBreakout: boolean; // 突破後價格是否又跌破/漲破回突破那條線（吐回整段突破）
  weekday: string;
  year: number;
}

// tpMultiple: 1、2 或 3（對應 1R/2R/3R）。rangeMinutes: 30 或 60（開盤區間長度）。
export function runOpenRangeBacktest(
  symbol: string,
  candles30m: Candle[],
  tpMultiple: number,
  rangeMinutes: 30 | 60 = 30
): OpenRangeTrade[] {
  const trades: OpenRangeTrade[] = [];
  const barsPerRange = rangeMinutes / 30; // 30分鐘=1根、60分鐘=2根（合併成一個區間）

  for (let i = 0; i < candles30m.length - barsPerRange * 3; i++) {
    const firstRangeBar = candles30m[i];
    const info = getETInfo(firstRangeBar.time);
    if (info.hour !== 9 || info.minute !== 30 || !WEEKDAYS.includes(info.weekday)) continue;

    const rangeBars = candles30m.slice(i, i + barsPerRange);
    const signalBars = candles30m.slice(i + barsPerRange, i + barsPerRange * 2);
    const entryBar = candles30m[i + barsPerRange * 2];
    if (rangeBars.length < barsPerRange || signalBars.length < barsPerRange || !entryBar) continue;

    // 安全檢查：確保這段K棒都是連續的30分鐘（沒有資料缺口）
    const allBars = [...rangeBars, ...signalBars, entryBar];
    let contiguous = true;
    for (let k = 1; k < allBars.length; k++) {
      if (allBars[k].time - allBars[k - 1].time !== 1800) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) continue;

    const rangeHigh = Math.max(...rangeBars.map((b) => b.high));
    const rangeLow = Math.min(...rangeBars.map((b) => b.low));
    const signalClose = signalBars[signalBars.length - 1].close;

    let direction: "LONG" | "SHORT" | null = null;
    if (signalClose > rangeHigh) direction = "LONG";
    else if (signalClose < rangeLow) direction = "SHORT";
    if (!direction) continue;

    const entryPrice = entryBar.open;
    const stopLoss = direction === "LONG" ? rangeLow : rangeHigh;
    const riskDistance = Math.abs(entryPrice - stopLoss);
    if (riskDistance <= 0) continue;
    const takeProfit =
      direction === "LONG" ? entryPrice + riskDistance * tpMultiple : entryPrice - riskDistance * tpMultiple;
    const breakoutLevel = direction === "LONG" ? rangeHigh : rangeLow;

    const entryBarIdx = i + barsPerRange * 2;
    let result: OpenRangeTrade["result"] = "TIMEEXIT";
    let exitIndex = entryBarIdx;
    let exitPrice = entryBar.close;
    let worst = entryPrice; // 對多單是最低價，對空單是最高價（不利方向）
    let best = entryPrice; // 對多單是最高價，對空單是最低價（有利方向）
    let falseBreakout = false;
    const entryDay = info; // 用 rangeBar 的日期即可，跟entryBar同一天

    for (let j = entryBarIdx; j < candles30m.length; j++) {
      const bar = candles30m[j];
      const barInfo = getETInfo(bar.time);
      // 超過同一天美股收盤(16:00 ET)就強制出場
      if (barInfo.year !== entryDay.year || barInfo.month !== entryDay.month || barInfo.day !== entryDay.day) {
        exitIndex = j - 1 >= entryBarIdx ? j - 1 : entryBarIdx;
        exitPrice = candles30m[exitIndex].close;
        result = "TIMEEXIT";
        break;
      }
      if (barInfo.hour > 16 || (barInfo.hour === 16 && barInfo.minute >= 0)) {
        exitIndex = j;
        exitPrice = bar.open; // 收盤時間到，用當根開盤價結算（保守，不用未來的收盤價）
        result = "TIMEEXIT";
        break;
      }

      if (direction === "LONG") {
        if (bar.low < worst) worst = bar.low;
        if (bar.high > best) best = bar.high;
        if (bar.low <= breakoutLevel) falseBreakout = true;
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
        if (bar.high > worst) worst = bar.high;
        if (bar.low < best) best = bar.low;
        if (bar.high >= breakoutLevel) falseBreakout = true;
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
    const mfeR = direction === "LONG" ? (best - entryPrice) / riskDistance : (entryPrice - best) / riskDistance;
    const maeR = direction === "LONG" ? (entryPrice - worst) / riskDistance : (worst - entryPrice) / riskDistance;

    trades.push({
      symbol,
      direction,
      entryTime: entryBar.time,
      exitTime: candles30m[exitIndex].time,
      entryPrice,
      stopLoss,
      takeProfit,
      rMultiple,
      result,
      mfeR: Math.max(0, mfeR),
      maeR: Math.max(0, maeR),
      falseBreakout,
      weekday: info.weekday,
      year: info.year,
    });
  }

  return trades;
}

export interface OpenRangeAudit {
  label: string;
  totalSignals: number;
  winRate: number; // 對TP/SL已分出勝負的交易而言
  completedTrades: number;
  falseBreakoutRate: number;
  achieved1R: number; // 達到至少1R的比例(%)
  achieved2R: number;
  achieved3R: number;
  avgMFE: number;
  avgMAE: number;
  avgR: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdownR: number;
  maxConsecutiveLosses: number;
}

export function auditOpenRange(trades: OpenRangeTrade[], label: string): OpenRangeAudit {
  const n = trades.length;
  const wins = trades.filter((t) => t.result === "WIN");
  const losses = trades.filter((t) => t.result === "LOSS");
  const completed = wins.length + losses.length;
  const winRate = completed ? (wins.length / completed) * 100 : 0;
  const falseBreakoutRate = n ? (trades.filter((t) => t.falseBreakout).length / n) * 100 : 0;
  const achieved1R = n ? (trades.filter((t) => t.mfeR >= 1).length / n) * 100 : 0;
  const achieved2R = n ? (trades.filter((t) => t.mfeR >= 2).length / n) * 100 : 0;
  const achieved3R = n ? (trades.filter((t) => t.mfeR >= 3).length / n) * 100 : 0;
  const avgMFE = n ? trades.reduce((a, t) => a + t.mfeR, 0) / n : 0;
  const avgMAE = n ? trades.reduce((a, t) => a + t.maeR, 0) / n : 0;
  const avgR = n ? trades.reduce((a, t) => a + t.rMultiple, 0) / n : 0;
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
    totalSignals: n,
    winRate,
    completedTrades: completed,
    falseBreakoutRate,
    achieved1R,
    achieved2R,
    achieved3R,
    avgMFE,
    avgMAE,
    avgR,
    expectancy: avgR,
    profitFactor,
    maxDrawdownR: maxDD,
    maxConsecutiveLosses: maxConsec,
  };
}
