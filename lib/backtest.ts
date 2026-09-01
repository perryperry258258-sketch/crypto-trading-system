import { Candle } from "./binance";
import { buildIndicatorSet, buildOpportunity, classifyMarketRegime } from "./scoring";
import { CoinSnapshot } from "./types";

// 回測引擎（A級訊號歷史驗證版 v2 — 回測邏輯稽核後修正）。
//
// 【上一版的問題，稽核後誠實記錄】：舊版回測沒有真的呼叫 production 用的 buildOpportunity()，
// 而是自己另外寫了一套簡化邏輯，用「趨勢分數≥65 AND 動能分數≥65」當成隱藏的第一道關卡，
// 沒通過這關就完全不會進入 A 級判斷（連 Opportunity Score、Risk Score、Market Regime、
// 追高判斷都沒算）。這道關卡是回測自己加的，production 即時系統完全沒有這個門檻，
// 兩邊邏輯不一致，稽核後移除。
//
// 【這一版怎麼修的】：每一根K棒都直接呼叫跟 production 完全相同的 buildOpportunity()
// 函式（用歷史當時的資料組成一個 CoinSnapshot），沒有任何額外的隱藏篩選條件，
// 判斷邏輯保證跟你手機上看到的即時系統一致。
//
// 其他限制（誠實標註，不假造結果）：
// 1. 市場面：Market Regime 用「當時的趨勢分數」判斷（跟 production 一樣的函式 classifyMarketRegime），
//    但恐慌貪婪指數歷史上無法還原，一律視為 null（跟 production 傳入 fearGreed=null 時的行為一致）。
// 2. 24H成交量改用「當時往前24根1H K棒的 quote volume 加總」估算，這是可以從歷史K線真實取得的資料，
//    不是假造的。
// 3. 進場價使用「訊號K棒的下一根K棒開盤價」，不是訊號當根的收盤價。
// 4. 出場規則：同一根K棒內若同時觸及停損與TP1，保守判定為「停損優先」。
// 5. 沒有 look-ahead bias：進場判斷只用訊號當時以前的資料，出場判斷只往後看未來K棒。
// 6. 手續費與滑價分開列（預設 Fee 0.1% + Slippage 0.05%）。
// 7. ADX、VWAP 目前系統未實作，不列入計算，不假造。
// 8. 目前只有一套統一的技術面進場規則，未拆分成具名 Setup，無法做 Setup 分類統計。
// 9. 同一幣種若有未平倉的模擬訊號，不會產生新訊號。

export interface BacktestTrade {
  symbol: string;
  entryIndex: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  exitPrice: number;
  result: "WIN" | "LOSS" | "TIMEOUT";
  rMultiple: number;
  entryQuality: number;
  riskScore: number;
  riskRewardRatio: number;
  opportunityScore: number;
  grade: "S" | "A" | "B" | "C";
  maePct: number;
  mfePct: number;
  timeToExitBars: number;
  stopDistancePct: number;
  regimeApprox: "BULL" | "BEAR" | "SIDEWAYS" | "EUPHORIA" | "PANIC";
}

export interface DebugStats {
  totalBars: number;
  evaluatedBars: number;
  passedTrend: number;
  passedMomentum: number;
  passedOpportunity80: number;
  passedEntryQuality75: number;
  passedRiskLE40: number;
  passedRR3: number;
  passedRegimeOk: number;
  passedNotChasing: number;
  finalASignals: number;
}

export interface BacktestResult {
  symbol: string;
  interval: string;
  totalBars: number;
  trades: BacktestTrade[];
  debug: DebugStats;
}

export const LOOKBACK_MIN = 60;
export const INDICATOR_WINDOW = 250;
export const MAX_HOLD_BARS = 200;
export const FEE_PCT = 0.1;
export const SLIPPAGE_PCT = 0.05;

function emptyDebug(totalBars: number): DebugStats {
  return {
    totalBars,
    evaluatedBars: 0,
    passedTrend: 0,
    passedMomentum: 0,
    passedOpportunity80: 0,
    passedEntryQuality75: 0,
    passedRiskLE40: 0,
    passedRR3: 0,
    passedRegimeOk: 0,
    passedNotChasing: 0,
    finalASignals: 0,
  };
}

export function runBacktest(symbol: string, interval: string, candles: Candle[]): BacktestResult {
  const closes = candles.map((c) => c.close);
  const trades: BacktestTrade[] = [];
  const debug = emptyDebug(candles.length);
  const symbolDisplay = symbol.replace("USDT", "");

  let i = LOOKBACK_MIN;
  while (i < candles.length - 1) {
    const windowStart = Math.max(0, i - INDICATOR_WINDOW);
    const window = closes.slice(windowStart, i + 1);
    if (window.length < LOOKBACK_MIN) {
      i++;
      continue;
    }
    debug.evaluatedBars++;

    const ind = buildIndicatorSet(window);
    if (ind.trendScore >= 65) debug.passedTrend++;
    if (ind.momentumScore >= 65) debug.passedMomentum++;

    // 用當時往前24根1H K棒的 quote volume 加總，估算「24H成交額」（真實歷史資料，非假造）
    const vol24Start = Math.max(0, i - 24);
    const volume24h = candles.slice(vol24Start, i + 1).reduce((a, c) => a + c.volume * c.close, 0);

    const refIdx = Math.max(0, i - 24);
    const change24h = closes[refIdx] > 0 ? ((closes[i] - closes[refIdx]) / closes[refIdx]) * 100 : 0;

    const high24h = Math.max(...candles.slice(vol24Start, i + 1).map((c) => c.high));
    const low24h = Math.min(...candles.slice(vol24Start, i + 1).map((c) => c.low));

    const coin: CoinSnapshot = {
      id: symbol,
      symbol: symbolDisplay,
      name: symbolDisplay,
      price: closes[i],
      change24h,
      high24h,
      low24h,
      volume24h,
    };

    const regime = classifyMarketRegime(change24h, ind.trendScore, null);

    // 直接呼叫跟 production 完全相同的函式，沒有任何額外的隱藏篩選條件
    const candidate = buildOpportunity(coin, window, null, null, regime);

    if (candidate.opportunityScore >= 80) debug.passedOpportunity80++;
    if (candidate.entryQuality >= 75) debug.passedEntryQuality75++;
    if (candidate.riskScore <= 40) debug.passedRiskLE40++;
    if (candidate.riskRewardRatio >= 3) debug.passedRR3++;
    if (regime !== "PANIC") debug.passedRegimeOk++;
    if (!candidate.doNotChase) debug.passedNotChasing++;

    if (candidate.grade === "A" || candidate.grade === "S") {
      debug.finalASignals++;

      const entryBarIdx = i + 1;
      const price = candles[entryBarIdx].open;
      // 停損/TP1 直接用 candidate 裡（跟 production 相同函式）算好的價位，
      // 只是實際成交價位移到下一根K棒的開盤價（避免用還沒發生的收盤價成交）
      const stopLoss = candidate.stopLoss;
      const tp1 = candidate.tp1;
      const riskDistance = price - stopLoss;
      if (riskDistance <= 0) {
        i++;
        continue;
      }
      const stopDistancePct = (riskDistance / price) * 100;

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
      const costPct = FEE_PCT + SLIPPAGE_PCT;
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
        entryQuality: candidate.entryQuality,
        riskScore: candidate.riskScore,
        riskRewardRatio: candidate.riskRewardRatio,
        opportunityScore: candidate.opportunityScore,
        grade: candidate.grade,
        maePct,
        mfePct,
        timeToExitBars: exitIndex - entryBarIdx,
        stopDistancePct,
        regimeApprox: regime,
      });

      i = exitIndex + 1;
      continue;
    }
    i++;
  }

  return { symbol, interval, totalBars: candles.length, trades, debug };
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
  expectancy: number; // 每筆平均期望值（跟 avgR 相同定義，獨立命名對應規格書用詞）
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

// 樣本數門檻 + 表現雙重判定（規格書 PART21/22）：
// 樣本 <100 一律不能判定通過或不通過，只能說樣本不足；
// 100~300 最高只能給「初步結果」（黃燈），不給綠燈；
// >=300 才開始依 Profit Factor / Expectancy / Out-of-Sample 表現判定 🟢/🟡/🔴。
export function gradeStrategy(
  all: SignalAuditReport,
  outOfSample: SignalAuditReport | null
): { emoji: string; label: string; desc: string } {
  if (all.totalSignals === 0) {
    return {
      emoji: "⚠️",
      label: "樣本不足",
      desc: "目前沒有產生足夠的A級歷史訊號，無法驗證策略。",
    };
  }
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
