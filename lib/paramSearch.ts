import { Candle } from "./binance";
import { buildIndicatorSet } from "./scoring";
import { calcStructuralStop } from "./indicators";
import { FEE_PCT, SLIPPAGE_PCT, MAX_HOLD_BARS, LOOKBACK_MIN, INDICATOR_WINDOW } from "./backtest";
import { TpVariantTrade, auditVariant, VariantAuditReport } from "./tpComparison";
import { IndicatorSet } from "./types";

// 參數網格搜尋（訓練/測試分離版）。
//
// 這是「一直測到期望值變正為止」這個想法唯一統計上站得住腳的做法：
// 把每個幣種的歷史資料依時間切成「搜尋段」（前70%）跟「驗證段」（後30%，完全不參與挑選）。
// 在搜尋段裡大量嘗試不同的趨勢/動能門檻組合，挑出搜尋段表現最好的一組。
// 這組贏家最後只用驗證段（沒被看過的資料）重新檢驗一次 —— 只有兩段都是正的，才算數。
// 如果驗證段是負的，代表搜尋段那個「正期望值」只是矇到歷史雜訊，不是真的優勢。
//
// TP固定用TP2(3R)當出場基準（TP基準本身尚未定案，之後可以重測）。
// 其他限制跟既有回測引擎相同：無 look-ahead bias、進場價用訊號下一根K棒開盤價、
// 同根K棒停損優先、手續費+滑價已扣除。

export interface ParamCombo {
  trendMin: number;
  momentumMin: number;
}

export const TREND_GRID = [50, 55, 60, 65, 70];
export const MOMENTUM_GRID = [50, 55, 60, 65, 70];

export function buildParamGrid(): ParamCombo[] {
  const combos: ParamCombo[] = [];
  TREND_GRID.forEach((t) => MOMENTUM_GRID.forEach((m) => combos.push({ trendMin: t, momentumMin: m })));
  return combos;
}

export interface BarIndicator {
  idx: number;
  ind: IndicatorSet;
  price: number;
}

// 每根K棒的指標只算一次，讓 25 組參數共用，避免重複計算拖慢速度。
export function precomputeIndicators(closes: number[]): BarIndicator[] {
  const out: BarIndicator[] = [];
  for (let i = LOOKBACK_MIN; i < closes.length - 1; i++) {
    const windowStart = Math.max(0, i - INDICATOR_WINDOW);
    const window = closes.slice(windowStart, i + 1);
    if (window.length < LOOKBACK_MIN) continue;
    out.push({ idx: i, ind: buildIndicatorSet(window), price: closes[i] });
  }
  return out;
}

// 用預先算好的指標，跑單一組參數在指定範圍（搜尋段或驗證段）內的訊號回測。
export function runComboBacktest(
  combo: ParamCombo,
  symbol: string,
  candles: Candle[],
  closes: number[],
  barIndicators: BarIndicator[],
  rangeStart: number,
  rangeEnd: number
): TpVariantTrade[] {
  const trades: TpVariantTrade[] = [];
  let nextAllowedIdx = rangeStart;

  for (const bi of barIndicators) {
    if (bi.idx < rangeStart || bi.idx >= rangeEnd) continue;
    if (bi.idx < nextAllowedIdx) continue;
    const { ind, price, idx } = bi;
    if (ind.trendScore < combo.trendMin || ind.momentumScore < combo.momentumMin) continue;

    const entryBarIdx = idx + 1;
    if (entryBarIdx >= candles.length || entryBarIdx >= rangeEnd) continue;
    const entryPrice = candles[entryBarIdx].open;

    const windowStart = Math.max(0, idx - INDICATOR_WINDOW);
    const window = closes.slice(windowStart, idx + 1);
    const stopLoss = calcStructuralStop(window, price, ind.atr14);
    const riskDistance = entryPrice - stopLoss;
    if (riskDistance <= 0) continue;
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

    nextAllowedIdx = exitIndex + 1;
  }

  return trades;
}

export interface ComboResult {
  combo: ParamCombo;
  search: VariantAuditReport;
  holdout: VariantAuditReport;
}

export function rankCombos(results: ComboResult[]): ComboResult[] {
  // 只考慮搜尋段樣本數 >=20 的組合（太少沒有參考意義），依搜尋段平均R排序
  return results.filter((r) => r.search.signalCount >= 20).sort((a, b) => b.search.avgR - a.search.avgR);
}
