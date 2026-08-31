import { Candle } from "./binance";
import { calcStructuralStop } from "./indicators";
import { buildIndicatorSet, computeEntryQuality } from "./scoring";

// 回測引擎（A級訊號歷史驗證版）。重要限制（誠實標註，不假造結果）：
// 1. 只測「技術面核心邏輯」，不含市場面/情緒面即時因子（大盤狀態、恐慌貪婪指數只有現在才有資料，
//    歷史上補不回去，不會硬湊假資料）。市場環境改用「當時的趨勢分數」概略判斷 BULL/BEAR/SIDEWAYS，
//    跟即時系統用 Fear&Greed 的判斷方式不完全相同。
// 2. 進場價使用「訊號K棒的下一根K棒開盤價」，不是訊號當根的收盤價，避免用還沒發生的成交價回測。
// 3. 出場規則：同一根K棒內若同時觸及停損與TP1，保守判定為「停損優先」。
// 4. 停損公式跟 lib/scoring.ts 即時計算完全相同（Swing Low + 動態 ATR 緩衝）。
// 5. 沒有 look-ahead bias：進場判斷只用訊號當時以前的資料，出場判斷只往後看未來K棒。
// 6. 手續費與滑價分開列且可調整（預設 Fee 0.1% + Slippage 0.05%）。
// 7. 量能分數在歷史回測中用「當根成交量 / 過去20根平均成交量」的比值當代理指標，
//    跟即時系統用的「24H成交額分級」不是同一種算法，這點會影響 Entry Quality 的量能子項。
// 8. ADX、VWAP 目前系統未實作，不列入計算，不假造。
// 9. 目前只有一套統一的技術面進場規則，未拆分成具名 Setup（突破/回踩/拉回等），無法做 Setup 分類統計。
// 10. 同一幣種若有未平倉的模擬訊號，不會產生新訊號（下一筆訊號只會在前一筆出場後才開始尋找）。

export interface BacktestTrade {
  symbol: string;
  entryIndex: number;
  entryTime: number; // unix seconds，實際成交（下一根K棒開盤）的時間
  exitTime: number;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  exitPrice: number;
  result: "WIN" | "LOSS" | "TIMEOUT";
  rMultiple: number;
  entryQuality: number;
  riskRewardRatio: number;
  qualifiesAsA: boolean;
  maePct: number;
  mfePct: number;
  timeToExitBars: number;
  stopDistancePct: number;
  regimeApprox: "BULL" | "BEAR" | "SIDEWAYS";
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
export const FEE_PCT = 0.1;
export const SLIPPAGE_PCT = 0.05;
const VOLUME_LOOKBACK = 20;

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function approxRegime(trendScore: number): "BULL" | "BEAR" | "SIDEWAYS" {
  if (trendScore >= 65) return "BULL";
  if (trendScore <= 35) return "BEAR";
  return "SIDEWAYS";
}

export function runBacktest(symbol: string, interval: string, candles: Candle[]): BacktestResult {
  const closes = candles.map((c) => c.close);
  const trades: BacktestTrade[] = [];

  let i = LOOKBACK_MIN;
  while (i < candles.length - 1) {
    const windowStart = Math.max(0, i - INDICATOR_WINDOW);
    const window = closes.slice(windowStart, i + 1);
    if (window.length < LOOKBACK_MIN) {
      i++;
      continue;
    }

    const ind = buildIndicatorSet(window);
    const entrySignal = ind.trendScore >= 65 && ind.momentumScore >= 65;

    if (entrySignal) {
      // 進場價：訊號K棒的下一根開盤價（不是訊號當根收盤價），避免用還沒發生的成交價
      const entryBarIdx = i + 1;
      const price = candles[entryBarIdx].open;
      const signalPrice = closes[i];

      const stopLoss = calcStructuralStop(window, signalPrice, ind.atr14);
      const riskDistance = price - stopLoss;
      if (riskDistance <= 0) {
        i++;
        continue;
      }
      const stopDistancePct = (riskDistance / price) * 100;
      const tp1 = price + riskDistance * 1.5;
      const riskRewardRatio = (tp1 - price) / riskDistance;

      const recentHigh = Math.max(...window.slice(-20));
      const volStart = Math.max(0, i - VOLUME_LOOKBACK);
      const avgVol = candles.slice(volStart, i).reduce((a, c) => a + c.volume, 0) / Math.max(1, i - volStart);
      const volRatio = avgVol > 0 ? candles[i].volume / avgVol : 1;
      const volumeScoreLocal = volRatio >= 1.5 ? 80 : volRatio >= 1.0 ? 60 : volRatio >= 0.7 ? 45 : 30;

      const refIdx = Math.max(0, i - 24);
      const change24h = closes[refIdx] > 0 ? ((signalPrice - closes[refIdx]) / closes[refIdx]) * 100 : 0;

      const entryQuality = computeEntryQuality({
        price: signalPrice,
        ema20: ind.ema20,
        rsi14: ind.rsi14,
        recentHigh,
        riskRewardRatio,
        volumeScore: volumeScoreLocal,
        change24h,
      });
      const qualifiesAsA = entryQuality >= 75 && riskRewardRatio >= 3;
      const regimeApprox = approxRegime(ind.trendScore);

      let exitIndex = Math.min(entryBarIdx + MAX_HOLD_BARS, candles.length - 1);
      let exitPrice = candles[exitIndex].close;
      let result: BacktestTrade["result"] = "TIMEOUT";
      let worst = price;
      let best = price;

      for (let j = entryBarIdx; j < Math.min(entryBarIdx + MAX_HOLD_BARS, candles.length); j++) {
        const bar = candles[j];
        if (bar.low < worst) worst = bar.low;
        if (bar.high > best) best = bar.high;
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

      const grossR = (exitPrice - price) / riskDistance;
      const costPct = FEE_PCT + SLIPPAGE_PCT; // 來回各算一次，簡化為一次性扣除
      const costR = (costPct / 100) * (price / riskDistance);
      const rMultiple = grossR - costR;

      trades.push({
        symbol,
        entryIndex: entryBarIdx,
        entryTime: candles[entryBarIdx].time,
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
        timeToExitBars: exitIndex - entryBarIdx,
        stopDistancePct,
        regimeApprox,
      });

      i = exitIndex + 1;
      continue;
    }
    i++;
  }

  return { symbol, interval, totalBars: candles.length, trades };
}

export interface SignalAuditReport {
  label: string;
  totalSignals: number;
  completedTrades: number;
  tpFirst: number;
  slFirst: number;
  timeout: number;
  winRate: number;
  lossRate: number;
  avgR: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdownR: number;
  maxConsecutiveLosses: number;
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
  const completedTrades = winners.length + losers.length;

  const winRate = completedTrades ? (winners.length / completedTrades) * 100 : 0;
  const lossRate = completedTrades ? (losers.length / completedTrades) * 100 : 0;
  const avgR = total ? trades.reduce((a, t) => a + t.rMultiple, 0) / total : 0;
  const grossWin = winners.reduce((a, t) => a + t.rMultiple, 0);
  const grossLoss = Math.abs(losers.reduce((a, t) => a + t.rMultiple, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  let consecLoss = 0;
  let maxConsecLoss = 0;
  trades.forEach((t) => {
    cum += t.rMultiple;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
    if (t.result === "LOSS") {
      consecLoss++;
      if (consecLoss > maxConsecLoss) maxConsecLoss = consecLoss;
    } else if (t.result === "WIN") {
      consecLoss = 0;
    }
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
    completedTrades,
    tpFirst: winners.length,
    slFirst: losers.length,
    timeout: timeouts.length,
    winRate,
    lossRate,
    avgR,
    profitFactor,
    expectancy: avgR,
    maxDrawdownR: maxDD,
    maxConsecutiveLosses: maxConsecLoss,
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

export function gradeStrategy(
  all: SignalAuditReport,
  outOfSample: SignalAuditReport | null
): { emoji: string; label: string; desc: string } {
  if (all.completedTrades < 100) {
    return {
      emoji: "⚠️",
      label: "樣本不足",
      desc: `已完成交易只有 ${all.completedTrades} 筆（門檻 100 筆），不足以判斷策略是否有效。`,
    };
  }
  if (all.completedTrades < 300) {
    const positive = all.profitFactor >= 1.3 && all.avgR > 0;
    return {
      emoji: "🟡",
      label: positive ? "初步結果（偏正向）" : "初步結果",
      desc: `已完成交易 ${all.completedTrades} 筆，介於 100～300 之間，只能算初步結果，還不到有統計參考價值的門檻（300筆）。`,
    };
  }

  const oosOk = !outOfSample || outOfSample.completedTrades < 20 || outOfSample.profitFactor >= 1.0;
  if (all.profitFactor > 1.3 && all.avgR > 0 && oosOk) {
    return {
      emoji: "🟢",
      label: "通過",
      desc: `已完成交易 ${all.completedTrades} 筆（開始具有統計參考價值），獲利因子 ${all.profitFactor.toFixed(
        2
      )}，樣本外（後半段）表現${oosOk ? "沒有明顯惡化" : ""}。但仍不能保證未來一定有效。`,
    };
  }
  if (all.profitFactor >= 1.0) {
    return {
      emoji: "🟡",
      label: "尚不足",
      desc: `獲利因子 ${all.profitFactor.toFixed(2)}，接近打平或樣本外表現轉弱，證據還不夠充分。`,
    };
  }
  return {
    emoji: "🔴",
    label: "不通過",
    desc: `獲利因子 ${all.profitFactor.toFixed(2)}（小於1代表長期是虧的），或樣本外表現為負。`,
  };
      }
