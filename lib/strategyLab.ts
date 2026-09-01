import { Candle } from "./binance";
import { buildIndicatorSet } from "./scoring";
import { calcStructuralStop, approxAtr } from "./indicators";
import { FEE_PCT, SLIPPAGE_PCT, MAX_HOLD_BARS, LOOKBACK_MIN, INDICATOR_WINDOW } from "./backtest";
import { TpVariantTrade, auditVariant, VariantAuditReport } from "./tpComparison";
import { IndicatorSet } from "./types";

// 進場邏輯比較實驗室（策略探索擴充版）。
//
// 重要警告（誠實揭露，這比程式碼本身更重要）：測試好幾種策略、挑歷史表現最好的那個，
// 本身就是統計陷阱（data snooping / multiple comparison bias）。樣本數不夠大時，
// 測越多種策略，純粹運氣好跑出漂亮數字的機率就越高。這裡不會、也不該自動選出「最佳」策略，
// 只提供七種邏輯上明顯不同的進場方式，讓你自己比較數字、看前半段/後半段是否一致，
// 「穩健度分數」是綜合幾個健檢指標算出來的排序參考，不是保證有效的認證。
//
// 七個策略都先固定用 TP2(3R) 當出場基準（TP基準本身尚未定案，之後可以重測）。
// 其他限制跟既有回測引擎相同：無 look-ahead bias、進場價用訊號下一根K棒開盤價、
// 同根K棒停損優先、手續費+滑價已扣除。突破/回踩確認/波動擴張/相對強弱度這幾個是我自己
// 操作化的定義（用具體數字門檻表達文字描述的概念），不是唯一的教科書寫法，誠實標註。
// 相對強弱度需要額外傳入 BTC 的價格序列（用時間戳對照，不是陣列索引），
// 如果沒有提供 btcSeries，這個策略永遠不會產生訊號（不是壞掉，是資料不足）。

export type StrategyId =
  | "MOMENTUM"
  | "PULLBACK"
  | "MEANREV"
  | "BREAKOUT"
  | "BREAKOUT_RETEST"
  | "VOL_EXPANSION"
  | "RELATIVE_STRENGTH";

export const STRATEGY_INFO: Record<StrategyId, { name: string; desc: string }> = {
  MOMENTUM: { name: "動能追蹤", desc: "趨勢分數≥65 且 動能分數≥65" },
  PULLBACK: { name: "回踩確認", desc: "趨勢≥55、價格拉回EMA20附近(0~3%)、RSI回到中性區間(40~60)" },
  MEANREV: { name: "均值回歸", desc: "RSI超賣(≤30) 且 價格低於EMA20（邏輯完全相反，賭反彈）" },
  BREAKOUT: { name: "突破", desc: "價格創20根K棒新高，且成交量放大" },
  BREAKOUT_RETEST: { name: "突破+回踩確認", desc: "近期突破前高後，價格回踩到前高附近(0~2%)且RSI降溫" },
  VOL_EXPANSION: { name: "波動擴張", desc: "ATR比10根K棒前明顯放大(≥1.3倍)，且趨勢≥55" },
  RELATIVE_STRENGTH: {
    name: "相對強弱度",
    desc: "過去20根K棒漲幅比BTC同期高出8%以上，且BTC本身沒有明顯走弱，RSI未過熱",
  },
};

interface EntryContext {
  ind: IndicatorSet;
  price: number;
  volumeRatio: number; // 當根成交量 / 過去20根平均成交量
  recentHigh20: number; // 過去20根K棒(不含當根)最高價
  priorLevel: number; // 更早之前(第8~30根K棒前)的最高價，當作「前高」參考
  brokeOutRecently: boolean; // 最近8根K棒內是否曾經突破 priorLevel
  atrExpanding: boolean; // 目前ATR是否比10根K棒前明顯放大
  relStrength: number | null; // 過去20根K棒漲幅 減去 BTC同期漲幅（百分點）；沒有BTC對照資料時為null
  btcReturn: number | null; // BTC同期報酬率（百分比），沒有對照資料時為null
}

function checkEntry(strategy: StrategyId, ctx: EntryContext): boolean {
  const { ind, price } = ctx;
  if (strategy === "MOMENTUM") return ind.trendScore >= 65 && ind.momentumScore >= 65;
  if (strategy === "PULLBACK") {
    const distPct = ind.ema20 > 0 ? ((price - ind.ema20) / ind.ema20) * 100 : 999;
    return ind.trendScore >= 55 && distPct >= 0 && distPct <= 3 && ind.rsi14 >= 40 && ind.rsi14 <= 60;
  }
  if (strategy === "MEANREV") return ind.rsi14 <= 30 && price < ind.ema20;
  if (strategy === "BREAKOUT") return price > ctx.recentHigh20 && ctx.volumeRatio >= 1.3;
  if (strategy === "BREAKOUT_RETEST") {
    const distToLevelPct = ctx.priorLevel > 0 ? ((ctx.priorLevel - price) / ctx.priorLevel) * 100 : 999;
    return ctx.brokeOutRecently && distToLevelPct >= 0 && distToLevelPct <= 2 && ind.rsi14 >= 40 && ind.rsi14 <= 65;
  }
  if (strategy === "RELATIVE_STRENGTH") {
    if (ctx.relStrength === null || ctx.btcReturn === null) return false;
    return ctx.relStrength >= 8 && ctx.btcReturn >= -2 && ind.rsi14 <= 75;
  }
  // VOL_EXPANSION
  return ctx.atrExpanding && ind.trendScore >= 55;
}

export function runStrategyBacktest(
  strategy: StrategyId,
  symbol: string,
  candles: Candle[],
  btcSeries?: Map<number, number> | null
): TpVariantTrade[] {
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

    const volStart = Math.max(0, i - 20);
    const avgVol = candles.slice(volStart, i).reduce((a, c) => a + c.volume, 0) / Math.max(1, i - volStart);
    const volumeRatio = avgVol > 0 ? candles[i].volume / avgVol : 1;

    const highWindow = candles.slice(Math.max(0, i - 20), i).map((c) => c.high);
    const recentHigh20 = highWindow.length ? Math.max(...highWindow) : price;

    const priorLevelWindow = candles.slice(Math.max(0, i - 30), Math.max(0, i - 8)).map((c) => c.high);
    const priorLevel = priorLevelWindow.length ? Math.max(...priorLevelWindow) : price;
    const recentBreakWindow = candles.slice(Math.max(0, i - 8), i).map((c) => c.high);
    const brokeOutRecently = recentBreakWindow.length > 0 && Math.max(...recentBreakWindow) > priorLevel * 1.005;

    let atrExpanding = false;
    if (i - 10 >= LOOKBACK_MIN) {
      const priorWindowStart = Math.max(0, i - 10 - INDICATOR_WINDOW);
      const priorWindow = closes.slice(priorWindowStart, i - 10 + 1);
      if (priorWindow.length >= LOOKBACK_MIN) {
        const priorAtr = approxAtr(priorWindow, 14);
        if (priorAtr && ind.atr14) atrExpanding = ind.atr14 > priorAtr * 1.3;
      }
    }

    // 相對強弱度：用時間戳對照 BTC 同一時刻的價格，避免用陣列索引對齊（不同幣種抓到的K棒數量可能有微小差異）
    let relStrength: number | null = null;
    let btcReturn: number | null = null;
    if (btcSeries && i >= 20) {
      const btcNow = btcSeries.get(candles[i].time);
      const btcPast = btcSeries.get(candles[i - 20].time);
      const altPast = closes[i - 20];
      if (btcNow !== undefined && btcPast !== undefined && btcPast > 0 && altPast > 0) {
        const altReturn = ((price - altPast) / altPast) * 100;
        btcReturn = ((btcNow - btcPast) / btcPast) * 100;
        relStrength = altReturn - btcReturn;
      }
    }

    const ctx: EntryContext = {
      ind,
      price,
      volumeRatio,
      recentHigh20,
      priorLevel,
      brokeOutRecently,
      atrExpanding,
      relStrength,
      btcReturn,
    };

    if (checkEntry(strategy, ctx)) {
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

export function buildBtcSeries(candles: Candle[]): Map<number, number> {
  const m = new Map<number, number>();
  candles.forEach((c) => m.set(c.time, c.close));
  return m;
}

export interface StrategyLabResult {
  strategy: StrategyId;
  overall: VariantAuditReport;
  firstHalf: VariantAuditReport;
  secondHalf: VariantAuditReport;
  consistent: "CONSISTENT" | "INCONSISTENT" | "BOTH_NEGATIVE" | "TOO_FEW";
  robustnessScore: number; // 0-100，綜合健檢分數，不是有效性認證
  status: "CANDIDATE" | "NEED_MORE" | "FAILED";
}

// 穩健度分數：綜合幾個健檢面向，滿分100。這不是「保證有效」的認證，
// 只是把好幾個健檢指標濃縮成一個排序參考，方便比較，細節仍要看完整數字。
function computeRobustness(overall: VariantAuditReport, consistent: StrategyLabResult["consistent"]): number {
  let score = 0;
  if (overall.avgR > 0) score += 30;
  if (overall.profitFactor >= 1.2) score += 20;
  else if (overall.profitFactor >= 1.0) score += 10;
  if (overall.signalCount >= 100) score += 20;
  else if (overall.signalCount >= 50) score += 10;
  if (consistent === "CONSISTENT") score += 30;
  else if (consistent === "INCONSISTENT") score += 10;
  return Math.min(100, score);
}

function computeStatus(overall: VariantAuditReport, consistent: StrategyLabResult["consistent"]): StrategyLabResult["status"] {
  if (overall.avgR <= 0 || overall.profitFactor <= 1) return "FAILED";
  if (consistent !== "CONSISTENT" || overall.signalCount < 50) return "NEED_MORE";
  return "CANDIDATE";
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

  const robustnessScore = computeRobustness(overall, consistent);
  const status = computeStatus(overall, consistent);

  return { strategy, overall, firstHalf, secondHalf, consistent, robustnessScore, status };
}
