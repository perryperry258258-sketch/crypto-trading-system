import { Candle } from "./binance";
import { buildIndicatorSet, buildOpportunity, classifyMarketRegime } from "./scoring";
import { CoinSnapshot } from "./types";
import { FEE_PCT, SLIPPAGE_PCT, MAX_HOLD_BARS, LOOKBACK_MIN, INDICATOR_WINDOW } from "./backtest";

// TP結構比較回測。目的：R:R稽核發現 TP1 固定 1.5R，跟 A級要求「R:R≥3」代數上互斥，
// 導致 637 筆 Opportunity≥80 訊號的 R:R 全部卡在 1.5，A級恆為 0 筆。
// 這裡先不篩 R:R≥3，直接對「Opportunity≥80」的訊號做四種出場方案的平行比較：
// TP1(1.5R) / TP2(3R) / TP3(5R) / 分批止盈(25%/35%/40%)。
// Entry / Stop Loss / 訊號條件（Opportunity/Entry Quality/Risk/Market Regime/追高判斷）
// 四個方案完全相同，只有 Profit Target 不同 —— 這是唯一的自變數。
//
// 同一根K棒內同時觸及停損與任何TP：保守判定停損優先。
// 沒有 look-ahead bias：TP1/TP2/TP3 價位在訊號產生當下就已經用 Risk Distance 算出來，
// 不是往未來找最高點回推的。

export type TpMode = "TP1" | "TP2" | "TP3" | "PARTIAL";

export const PARTIAL_EXIT_SPLIT = { tp1: 0.25, tp2: 0.35, tp3: 0.4 }; // 參數化，非宣稱最佳比例

export interface TpVariantTrade {
  symbol: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  stopLoss: number;
  rMultiple: number;
  result: "WIN" | "LOSS" | "TIMEOUT";
  hitTp1: boolean;
  hitTp2: boolean;
  hitTp3: boolean;
  hitSL: boolean;
  timeToExitBars: number;
  maePct: number;
  mfePct: number;
}

function simulateVariant(
  candles: Candle[],
  symbol: string,
  entryBarIdx: number,
  entryPrice: number,
  stopLoss: number,
  tp1: number,
  tp2: number,
  tp3: number,
  mode: TpMode
): TpVariantTrade {
  const riskDistance = entryPrice - stopLoss;
  let remaining = 1;
  let realizedR = 0;
  let worst = entryPrice;
  let best = entryPrice;
  let hitTp1 = false;
  let hitTp2 = false;
  let hitTp3 = false;
  let hitSL = false;
  let exitIndex = Math.min(entryBarIdx + MAX_HOLD_BARS, candles.length - 1);
  let closedEarly = false;

  for (let j = entryBarIdx; j < Math.min(entryBarIdx + MAX_HOLD_BARS, candles.length); j++) {
    const bar = candles[j];
    if (bar.low < worst) worst = bar.low;
    if (bar.high > best) best = bar.high;

    // 保守判定：停損優先於同一根K棒內任何TP
    if (bar.low <= stopLoss) {
      realizedR += remaining * ((stopLoss - entryPrice) / riskDistance);
      hitSL = true;
      remaining = 0;
      exitIndex = j;
      closedEarly = true;
      break;
    }

    if (mode === "TP1") {
      if (bar.high >= tp1) {
        realizedR = (tp1 - entryPrice) / riskDistance;
        hitTp1 = true;
        remaining = 0;
        exitIndex = j;
        closedEarly = true;
        break;
      }
    } else if (mode === "TP2") {
      if (bar.high >= tp2) {
        realizedR = (tp2 - entryPrice) / riskDistance;
        hitTp2 = true;
        remaining = 0;
        exitIndex = j;
        closedEarly = true;
        break;
      }
    } else if (mode === "TP3") {
      if (bar.high >= tp3) {
        realizedR = (tp3 - entryPrice) / riskDistance;
        hitTp3 = true;
        remaining = 0;
        exitIndex = j;
        closedEarly = true;
        break;
      }
    } else {
      // PARTIAL：同一根K棒可能連續觸發多個目標
      if (!hitTp1 && bar.high >= tp1) {
        realizedR += PARTIAL_EXIT_SPLIT.tp1 * ((tp1 - entryPrice) / riskDistance);
        remaining -= PARTIAL_EXIT_SPLIT.tp1;
        hitTp1 = true;
      }
      if (!hitTp2 && bar.high >= tp2) {
        realizedR += PARTIAL_EXIT_SPLIT.tp2 * ((tp2 - entryPrice) / riskDistance);
        remaining -= PARTIAL_EXIT_SPLIT.tp2;
        hitTp2 = true;
      }
      if (!hitTp3 && bar.high >= tp3) {
        realizedR += PARTIAL_EXIT_SPLIT.tp3 * ((tp3 - entryPrice) / riskDistance);
        remaining -= PARTIAL_EXIT_SPLIT.tp3;
        hitTp3 = true;
        exitIndex = j;
        closedEarly = true;
        break; // 全部出場
      }
    }
  }

  // 超過最大持倉時間仍有剩餘部位：用最後一根收盤價結算
  if (!closedEarly && remaining > 0.0001) {
    const lastBar = candles[exitIndex];
    realizedR += remaining * ((lastBar.close - entryPrice) / riskDistance);
  }

  const costR = ((FEE_PCT + SLIPPAGE_PCT) / 100) * (entryPrice / riskDistance);
  const rMultiple = realizedR - costR;

  let result: TpVariantTrade["result"];
  if (mode === "PARTIAL") {
    result = closedEarly || hitTp1 || hitTp2 ? (rMultiple > 0 ? "WIN" : "LOSS") : "TIMEOUT";
  } else {
    result = hitSL ? "LOSS" : closedEarly ? "WIN" : "TIMEOUT";
  }

  const maePct = Math.max(0, ((entryPrice - worst) / entryPrice) * 100);
  const mfePct = Math.max(0, ((best - entryPrice) / entryPrice) * 100);

  return {
    symbol,
    entryTime: candles[entryBarIdx].time,
    exitTime: candles[exitIndex].time,
    entryPrice,
    stopLoss,
    rMultiple,
    result,
    hitTp1,
    hitTp2,
    hitTp3,
    hitSL,
    timeToExitBars: exitIndex - entryBarIdx,
    maePct,
    mfePct,
  };
}

export interface TpComparisonResult {
  symbol: string;
  totalBars: number;
  signalCount: number;
  variants: Record<TpMode, TpVariantTrade[]>;
}

// 訊號辨識只用「Opportunity Score ≥ 80」，不套用 R:R≥3 這道門檻（這正是要測試的變數）。
// 同一幣種不重疊部位：用四個方案裡最晚結束的那個當作「這筆訊號結束」的參考點，
// 確保四個方案永遠是在同一組訊號上比較。
export function runTpComparisonBacktest(symbol: string, interval: string, candles: Candle[]): TpComparisonResult {
  const closes = candles.map((c) => c.close);
  const variants: Record<TpMode, TpVariantTrade[]> = { TP1: [], TP2: [], TP3: [], PARTIAL: [] };
  let signalCount = 0;

  let i = LOOKBACK_MIN;
  while (i < candles.length - 1) {
    const windowStart = Math.max(0, i - INDICATOR_WINDOW);
    const window = closes.slice(windowStart, i + 1);
    if (window.length < LOOKBACK_MIN) {
      i++;
      continue;
    }

    const ind = buildIndicatorSet(window);
    const vol24Start = Math.max(0, i - 24);
    const volume24h = candles.slice(vol24Start, i + 1).reduce((a, c) => a + c.volume * c.close, 0);
    const refIdx = Math.max(0, i - 24);
    const change24h = closes[refIdx] > 0 ? ((closes[i] - closes[refIdx]) / closes[refIdx]) * 100 : 0;
    const high24h = Math.max(...candles.slice(vol24Start, i + 1).map((c) => c.high));
    const low24h = Math.min(...candles.slice(vol24Start, i + 1).map((c) => c.low));

    const coin: CoinSnapshot = {
      id: symbol,
      symbol: symbol.replace("USDT", ""),
      name: symbol.replace("USDT", ""),
      price: closes[i],
      change24h,
      high24h,
      low24h,
      volume24h,
    };
    const regime = classifyMarketRegime(change24h, ind.trendScore, null);
    const candidate = buildOpportunity(coin, window, null, null, regime);

    if (candidate.opportunityScore >= 80) {
      signalCount++;
      const entryBarIdx = i + 1;
      const entryPrice = candles[entryBarIdx].open;
      const stopLoss = candidate.stopLoss;
      const riskDistance = entryPrice - stopLoss;
      if (riskDistance <= 0) {
        i++;
        continue;
      }
      const tp1 = entryPrice + riskDistance * 1.5;
      const tp2 = entryPrice + riskDistance * 3;
      const tp3 = entryPrice + riskDistance * 5;

      const modes: TpMode[] = ["TP1", "TP2", "TP3", "PARTIAL"];
      let latestExitIdx = entryBarIdx;
      modes.forEach((mode) => {
        const trade = simulateVariant(candles, symbol, entryBarIdx, entryPrice, stopLoss, tp1, tp2, tp3, mode);
        variants[mode].push(trade);
        const exitIdx = entryBarIdx + trade.timeToExitBars;
        if (exitIdx > latestExitIdx) latestExitIdx = exitIdx;
      });

      i = latestExitIdx + 1;
      continue;
    }
    i++;
  }

  return { symbol, totalBars: candles.length, signalCount, variants };
}

export interface VariantAuditReport {
  label: string;
  signalCount: number;
  winRate: number;
  slFirst: number;
  tp1First: number;
  tp2First: number;
  tp3First: number;
  timeout: number;
  avgR: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdownR: number;
  maxConsecutiveLosses: number;
  avgHoldingBars: number;
  avgMAE: number;
  avgMFE: number;
}

export function auditVariant(trades: TpVariantTrade[], label: string): VariantAuditReport {
  const n = trades.length;
  const wins = trades.filter((t) => t.result === "WIN");
  const timeouts = trades.filter((t) => t.result === "TIMEOUT");
  const winRate = n ? (wins.length / n) * 100 : 0;
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

  const avgHoldingBars = n ? trades.reduce((a, t) => a + t.timeToExitBars, 0) / n : 0;
  const avgMAE = n ? trades.reduce((a, t) => a + t.maePct, 0) / n : 0;
  const avgMFE = n ? trades.reduce((a, t) => a + t.mfePct, 0) / n : 0;

  return {
    label,
    signalCount: n,
    winRate,
    slFirst: trades.filter((t) => t.hitSL && t.result === "LOSS").length,
    tp1First: trades.filter((t) => t.hitTp1 && !t.hitTp2 && !t.hitTp3).length,
    tp2First: trades.filter((t) => t.hitTp2 && !t.hitTp3).length,
    tp3First: trades.filter((t) => t.hitTp3).length,
    timeout: timeouts.length,
    avgR,
    expectancy: avgR,
    profitFactor,
    maxDrawdownR: maxDD,
    maxConsecutiveLosses: maxConsec,
    avgHoldingBars,
    avgMAE,
    avgMFE,
  };
}
