import { Candle } from "./binance";
import { calcStructuralStop } from "./indicators";
import { buildIndicatorSet, computeEntryQuality } from "./scoring";

// 回測引擎（Signal Failure Audit 版）。重要限制（誠實標註，不假造結果）：
// 1. 只測「技術面核心邏輯」，不含市場面/情緒面（大盤狀態、恐慌貪婪指數只有現在才有資料，
//    歷史上補不回去，不會硬湊假資料）。
// 2. 出場規則：同一根K棒內若同時觸及停損與TP1，保守判定為「停損優先」（符合稽核要求）。
// 3. 停損公式跟 lib/scoring.ts 即時計算完全相同（Swing Low + 動態 ATR 緩衝）。
// 4. 沒有 look-ahead bias：第 i 根K棒的進場判斷只用 closes[0..i]，出場判斷只往後看未來K棒。
// 5. 假設每筆交易來回手續費+滑價共 0.15%，從報酬中扣除。
// 6. 量能分數在歷史回測中用「當根成交量 / 過去20根平均成交量」的比值當代理指標，
//    跟即時系統用的「24H成交額分級」不是同一種算法（historical volume 沒有 24H USDT 成交額可用），
//    這點會影響 Entry Quality 的量能子項，誠實標註在此。

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
  entryQuality: number;
  riskRewardRatio: number;
  qualifiesAsA: boolean; // 是否符合新版 A 級的四道關卡（Entry Quality/R:R 門檻，市場面因子回測無法還原故不列入）
  maePct: number; // Maximum Adverse Excursion：出場前價格最不利時，相對進場價的百分比（正數）
  mfePct: number; // Maximum Favorable Excursion：出場前價格最有利時，相對進場價的百分比（正數）
  timeToExitBars: number; // 進場到出場經過幾根K棒
  stopDistancePct: number;
}

export interface BacktestResult {
  symbol: string;
  interval: string;
  totalBars: number;
  trades: BacktestTrade[];
}

const LOOKBACK_MIN = 60;
const INDICATOR_WINDOW = 250;
const MAX_HOLD_BARS = 200;
const FEE_SLIPPAGE_PCT = 0.15;
const VOLUME_LOOKBACK = 20;

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

// 執行單一幣種的技術面訊號回測。broad trigger（trend+momentum）用來取得足夠樣本數，
// 每筆交易另外標註 qualifiesAsA，讓稽核報告可以比較「全部技術面訊號」vs「符合新版A級門檻」的表現差異。
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
      const stopLoss = calcStructuralStop(window, price, ind.atr14);
      const riskDistance = price - stopLoss;
      const stopDistancePct = (riskDistance / price) * 100;
      const tp1 = price + riskDistance * 1.5;
      const riskRewardRatio = riskDistance > 0 ? (tp1 - price) / riskDistance : 0;

      const recentHigh = Math.max(...window.slice(-20));
      const volStart = Math.max(0, i - VOLUME_LOOKBACK);
      const avgVol =
        candles.slice(volStart, i).reduce((a, c) => a + c.volume, 0) / Math.max(1, i - volStart);
      const volRatio = avgVol > 0 ? candles[i].volume / avgVol : 1;
      const volumeScoreLocal = volRatio >= 1.5 ? 80 : volRatio >= 1.0 ? 60 : volRatio >= 0.7 ? 45 : 30;

      const refIdx = Math.max(0, i - 24);
      const change24h = closes[refIdx] > 0 ? ((price - closes[refIdx]) / closes[refIdx]) * 100 : 0;

      const entryQuality = computeEntryQuality({
        price,
        ema20: ind.ema20,
        rsi14: ind.rsi14,
        recentHigh,
        riskRewardRatio,
        volumeScore: volumeScoreLocal,
        change24h,
      });
      const qualifiesAsA = entryQuality >= 75 && riskRewardRatio >= 3;

      let exitIndex = Math.min(i + MAX_HOLD_BARS, candles.length - 1);
      let exitPrice = candles[exitIndex].close;
      let result: BacktestTrade["result"] = "TIMEOUT";
      let worst = price; // MAE 追蹤：出場前碰過的最低價
      let best = price; // MFE 追蹤：出場前碰過的最高價

      for (let j = i + 1; j < Math.min(i + 1 + MAX_HOLD_BARS, candles.length); j++) {
        const bar = candles[j];
        if (bar.low < worst) worst = bar.low;
        if (bar.high > best) best = bar.high;
        // 保守判定：同一根K棒同時觸及停損與TP1，一律判定停損優先
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

      const maePct = price > 0 ? Math.max(0, ((price - worst) / price) * 100) : 0;
      const mfePct = price > 0 ? Math.max(0, ((best - price) / price) * 100) : 0;

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
        entryQuality,
        riskRewardRatio,
        qualifiesAsA,
        maePct,
        mfePct,
        timeToExitBars: exitIndex - i,
        stopDistancePct,
      });

      i = exitIndex + 1; // 出場後才找下一筆訊號，一次只模擬一筆部位
      continue;
    }
    i++;
  }

  return { symbol, interval, totalBars: candles.length, trades };
}

export interface SignalAuditReport {
  label: string;
  totalSignals: number;
  tpFirst: number;
  slFirst: number;
  timeout: number;
  winRate: number;
  lossRate: number;
  avgR: number;
  profitFactor: number;
  maxDrawdownR: number;
  avgTimeToSLHours: number;
  avgTimeToTPHours: number;
  avgMAEWinners: number;
  avgMAELosers: number;
  avgMFEWinners: number;
  avgMFELosers: number;
  avgStopDistancePct: number;
}

export function auditTrades(trades: BacktestTrade[], label: string): SignalAuditReport {
  const total = trades.length;
  const winners = trades.filter((t) => t.result === "WIN");
  const losers = trades.filter((t) => t.result === "LOSS");
  const timeouts = trades.filter((t) => t.result === "TIMEOUT");

  const winRate = total ? (winners.length / total) * 100 : 0;
  const lossRate = total ? (losers.length / total) * 100 : 0;
  const avgR = total ? trades.reduce((a, t) => a + t.rMultiple, 0) / total : 0;
  const grossWin = winners.reduce((a, t) => a + t.rMultiple, 0);
  const grossLoss = Math.abs(losers.reduce((a, t) => a + t.rMultiple, 0));
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

  const avgTimeToSLHours = losers.length ? losers.reduce((a, t) => a + t.timeToExitBars, 0) / losers.length : 0;
  const avgTimeToTPHours = winners.length ? winners.reduce((a, t) => a + t.timeToExitBars, 0) / winners.length : 0;
  const avgMAEWinners = winners.length ? winners.reduce((a, t) => a + t.maePct, 0) / winners.length : 0;
  const avgMAELosers = losers.length ? losers.reduce((a, t) => a + t.maePct, 0) / losers.length : 0;
  const avgMFEWinners = winners.length ? winners.reduce((a, t) => a + t.mfePct, 0) / winners.length : 0;
  const avgMFELosers = losers.length ? losers.reduce((a, t) => a + t.mfePct, 0) / losers.length : 0;
  const avgStopDistancePct = total ? trades.reduce((a, t) => a + t.stopDistancePct, 0) / total : 0;

  return {
    label,
    totalSignals: total,
    tpFirst: winners.length,
    slFirst: losers.length,
    timeout: timeouts.length,
    winRate,
    lossRate,
    avgR,
    profitFactor,
    maxDrawdownR: maxDD,
    avgTimeToSLHours,
    avgTimeToTPHours,
    avgMAEWinners,
    avgMAELosers,
    avgMFEWinners,
    avgMFELosers,
    avgStopDistancePct,
  };
}

export function stopLossVerdict(report: SignalAuditReport): { emoji: string; label: string } {
  if (report.tpFirst < 5) return { emoji: "🤷", label: "獲利交易樣本太少，無法判斷" };
  const ratio = report.avgStopDistancePct > 0 ? report.avgMAEWinners / report.avgStopDistancePct : 0;
  if (ratio >= 0.8) return { emoji: "🔴", label: "明顯過窄 — 成功交易的正常回檔幅度已經很接近停損距離" };
  if (ratio >= 0.5) return { emoji: "🟡", label: "偏窄 — 有一定比例的正常回檔可能誤觸停損" };
  return { emoji: "🟢", label: "合理 — 停損距離明顯大於成功交易的正常回檔幅度" };
}
