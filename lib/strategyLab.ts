import { Candle } from "./binance";
import { buildIndicatorSet } from "./scoring";
import { calcStructuralStop } from "./indicators";
import { FEE_PCT, SLIPPAGE_PCT, MAX_HOLD_BARS, LOOKBACK_MIN, INDICATOR_WINDOW } from "./backtest";
import { TpVariantTrade, auditVariant, VariantAuditReport } from "./tpComparison";
import { IndicatorSet } from "./types";

// 進場邏輯比較實驗室。
//
// 重要警告（誠實揭露，這比程式碼本身更重要）：測試好幾種策略、挑歷史表現最好的那個，
// 本身就是統計陷阱（data snooping / multiple comparison bias）。樣本數不夠大時，
// 測越多種策略，純粹運氣好跑出漂亮數字的機率就越高。這裡不會、也不該自動選出「最佳」策略，
// 只提供三種邏輯上明顯不同的進場方式，讓你自己比較數字、看前半段/後半段是否一致。
//
// 三個策略都先固定用 TP2(3R) 當出場基準（TP基準本身尚未定案，這是暫定值，
// 之後決定TP基準後可以重新測）。其他限制跟既有回測引擎相同：無 look-ahead bias、
// 進場價用訊號下一根K棒開盤價、同根K棒停損優先、手續費+滑價已扣除。

export type StrategyId = "MOMENTUM" | "PULLBACK" | "MEANREV";

export const STRATEGY_INFO: Record<StrategyId, { name: string; desc: string }> = {
  MOMENTUM: { name: "動能追蹤（現行）", desc: "趨勢分數≥65 且 動能分數≥65" },
  PULLBACK: { name: "回踩確認", desc: "趨勢≥55、價格拉回EMA20附近(0~3%)、RSI回到中性區間(40~60)" },
  MEANREV: { name: "均值回歸", desc: "RSI超賣(≤30) 且 價格低於EMA20（邏輯完全相反，賭反彈）" },
};

function checkEntry(strategy: StrategyId, ind: IndicatorSet, price: number): boolean {
  if (strategy === "MOMENTUM") return ind.trendScore >= 65 && ind.momentumScore >= 65;
  if (strategy === "PULLBACK") {
    const distPct = ind.ema20 > 0 ? ((price - ind.ema20) / ind.ema20) * 100 : 999;
    return ind.trendScore >= 55 && distPct >= 0 && distPct <= 3 && ind.rsi14 >= 40 && ind.rsi14 <= 60;
  }
  return ind.rsi14 <= 30 && price < ind.ema20; // MEANREV
}

export function runStrategyBacktest(strategy: StrategyId, symbol: string, candles: Candle[]): TpVariantTrade[] {
  const closes = candles.map((c) => c.close);
  const trades: TpVariantTrade[] = [];

  let i = LOOKBACK_MIN;
  while (i < candles.length - 1) {
    const windowStart = Math.max(0, i - INDICATOR_WINDOW);
    const window = closes.slice(windowStart, i + 1);
    if (window.length < LOOKBACK_MIN) {
      i++;
      continue;
    }

    const ind = buildIndicatorSet(window);
    const price = closes[i];

    if (checkEntry(strategy, ind, price)) {
      const entryBarIdx = i + 1;
      const entryPrice = candles[entryBarIdx].open;
      const stopLoss = calcStructuralStop(window, price, ind.atr14);
      const riskDistance = entryPrice - stopLoss;
      if (riskDistance <= 0) {
        i++;
        continue;
      }
      const tp2 = entryPrice + riskDistance * 3;

      let exitIndex = Math.min(entryBarIdx + MAX_HOLD_BARS, candles.length - 1);
      let result: TpVariantTrade["result"] = "TIMEOUT";
      let hitSL = false;
      let hitTp2 = false;
      let worst = entryPrice;
      let best = entryPrice;

      for (let j = entryBarIdx; j < Math.min(entryBarIdx + MAX_HOLD_BARS, candles.length); j++) {
        const bar = candles[j];
        if (bar.low < worst) worst = bar.low;
        if (bar.high > best) best = bar.high;
        if (bar.low <= stopLoss) {
          exitIndex = j;
          hitSL = true;
          result = "LOSS";
          break;
        }
        if (bar.high >= tp2) {
          exitIndex = j;
          hitTp2 = true;
          result = "WIN";
          break;
        }
      }

      const exitPrice = hitSL ? stopLoss : hitTp2 ? tp2 : candles[exitIndex].close;
      const grossR = (exitPrice - entryPrice) / riskDistance;
      const costR = ((FEE_PCT + SLIPPAGE_PCT) / 100) * (entryPrice / riskDistance);
      const rMultiple = grossR - costR;
      const maePct = Math.max(0, ((entryPrice - worst) / entryPrice) * 100);
      const mfePct = Math.max(0, ((best - entryPrice) / entryPrice) * 100);

      trades.push({
        symbol,
        entryTime: candles[entryBarIdx].time,
        exitTime: candles[exitIndex].time,
        entryPrice,
        stopLoss,
        rMultiple,
        result,
        hitTp1: false,
        hitTp2,
        hitTp3: false,
        hitSL,
        timeToExitBars: exitIndex - entryBarIdx,
        maePct,
        mfePct,
      });

      i = exitIndex + 1;
      continue;
    }
    i++;
  }
  return trades;
}

export interface StrategyLabResult {
  strategy: StrategyId;
  overall: VariantAuditReport;
  firstHalf: VariantAuditReport;
  secondHalf: VariantAuditReport;
  consistent: "CONSISTENT" | "INCONSISTENT" | "BOTH_NEGATIVE" | "TOO_FEW";
}

export function buildStrategyLabResult(strategy: StrategyId, trades: TpVariantTrade[]): StrategyLabResult {
  const overall = auditVariant(trades, STRATEGY_INFO[strategy].name);
  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const mid = Math.floor(sorted.length / 2);
  const firstHalf = auditVariant(sorted.slice(0, mid), "前半段");
  const secondHalf = auditVariant(sorted.slice(mid), "後半段");

  let consistent: StrategyLabResult["consistent"] = "TOO_FEW";
  if (firstHalf.signalCount >= 10 && secondHalf.signalCount >= 10) {
    if (firstHalf.avgR > 0 && secondHalf.avgR > 0) consistent = "CONSISTENT";
    else if (firstHalf.avgR <= 0 && secondHalf.avgR <= 0) consistent = "BOTH_NEGATIVE";
    else consistent = "INCONSISTENT";
  }

  return { strategy, overall, firstHalf, secondHalf, consistent };
}
