import { Candle } from "./binance";
import { buildIndicatorSet } from "./scoring";

// 回測引擎。重要限制（誠實標註，不假造結果）：
// 1. 只測「技術面核心邏輯」（趨勢分數 + 動能分數），不含市場面/情緒面/量能面 ——
//    那些因子（大盤狀態、恐慌貪婪指數、當下成交量分級）只有「現在」才有，歷史上補不回去，
//    硬湊歷史數據會變成假資料，所以誠實地不做。
// 2. 出場規則跟 lib/paperTrading.ts 一致：只認「碰到 TP1」或「碰到停損」，不含 TP2/TP3。
// 3. 停損/止盈公式跟 lib/scoring.ts 的即時計算完全相同（ATR 為基礎）。
// 4. 沒有 look-ahead bias：第 i 根K棒的進場判斷只用 closes[0..i]，出場判斷只往後看未來K棒。
// 5. 假設每筆交易來回手續費+滑價共 0.15%，從報酬中扣除，避免高估績效。

export interface BacktestTrade {
  entryIndex: number;
  entryTime: number; // unix seconds
  exitTime: number;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  exitPrice: number;
  result: "WIN" | "LOSS" | "TIMEOUT";
  rMultiple: number;
}

export interface BacktestResult {
  symbol: string;
  interval: string;
  totalBars: number;
  trades: BacktestTrade[];
  winRate: number;
  avgR: number;
  profitFactor: number;
  maxDrawdownR: number;
  totalTrades: number;
}

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

const LOOKBACK_MIN = 60; // 至少需要這麼多根K棒才能算出可信的指標
const INDICATOR_WINDOW = 250; // 每次計算指標往前看的視窗（效能與準確度的折衷）
const MAX_HOLD_BARS = 200; // 最多持有這麼多根K棒沒觸價就強制平倉
const FEE_SLIPPAGE_PCT = 0.15; // 假設來回手續費+滑價

export function runBacktest(symbol: string, interval: string, candles: Candle[]): BacktestResult {
  const closes = candles.map((c) => c.close);
  const trades: BacktestTrade[] = [];

  let i = LOOKBACK_MIN;
  while (i < candles.length) {
    const windowStart = Math.max(0, i - INDICATOR_WINDOW);
    const window = closes.slice(windowStart, i + 1);
    if (window.length < LOOKBACK_MIN) {
      i++;
      continue;
    }

    const ind = buildIndicatorSet(window);
    const entrySignal = ind.trendScore >= 65 && ind.momentumScore >= 65;

    if (entrySignal) {
      const price = closes[i];
      const atrPct = ind.atr14 && price > 0 ? (ind.atr14 / price) * 100 : 5;
      const stopPct = clamp(atrPct * 1.5, 3, 12);
      const stopLoss = price * (1 - stopPct / 100);
      const riskDistance = price - stopLoss;
      const tp1 = price + riskDistance * 1.5;

      let exitIndex = Math.min(i + MAX_HOLD_BARS, candles.length - 1);
      let exitPrice = candles[exitIndex].close;
      let result: BacktestTrade["result"] = "TIMEOUT";

      for (let j = i + 1; j < Math.min(i + 1 + MAX_HOLD_BARS, candles.length); j++) {
        const bar = candles[j];
        if (bar.low <= stopLoss) {
          exitIndex = j;
          exitPrice = stopLoss;
          result = "LOSS";
          break;
        }
        if (bar.high >= tp1) {
          exitIndex = j;
          exitPrice = tp1;
          result = "WIN";
          break;
        }
      }

      const grossR = riskDistance > 0 ? (exitPrice - price) / riskDistance : 0;
      const feeR = riskDistance > 0 ? (FEE_SLIPPAGE_PCT / 100) * (price / riskDistance) : 0;
      const rMultiple = grossR - feeR;

      trades.push({
        entryIndex: i,
        entryTime: candles[i].time,
        exitTime: candles[exitIndex].time,
        entryPrice: price,
        stopLoss,
        tp1,
        exitPrice,
        result,
        rMultiple,
      });

      i = exitIndex + 1; // 出場後才找下一筆訊號，一次只模擬一筆部位
      continue;
    }
    i++;
  }

  const wins = trades.filter((t) => t.rMultiple > 0);
  const losses = trades.filter((t) => t.rMultiple <= 0);
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const avgR = trades.length ? trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length : 0;
  const grossWin = wins.reduce((a, t) => a + t.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.rMultiple, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  trades.forEach((t) => {
    cum += t.rMultiple;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  });

  return {
    symbol,
    interval,
    totalBars: candles.length,
    trades,
    winRate,
    avgR,
    profitFactor,
    maxDrawdownR: maxDD,
    totalTrades: trades.length,
  };
}
