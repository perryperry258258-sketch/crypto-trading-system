import { approxAtr, bollinger, calcStructuralStop, ema, last, macd, rsi } from "./indicators";
import {
  CoinSnapshot,
  FearGreed,
  GlobalMarketSnapshot,
  IndicatorSet,
  MarketRegime,
  OpportunityCandidate,
  RiskFlags,
} from "./types";

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

export function buildIndicatorSet(closes: number[]): IndicatorSet {
  const ema20 = last(ema(closes, 20));
  const ema50 = last(ema(closes, 50));
  const ema200arr = closes.length >= 200 ? ema(closes, 200) : null;
  const ema200 = ema200arr ? last(ema200arr) : null;
  const rsiArr = rsi(closes, 14);
  const rsi14 = rsiArr[rsiArr.length - 1] ?? 50;
  const macdRes = macd(closes);
  const macdLine = last(macdRes.macdLine);
  const signalLine = last(macdRes.signalLine);
  const histogram = last(macdRes.histogram);
  const atr14 = approxAtr(closes, 14);
  const bb = bollinger(closes, 20, 2);
  const price = last(closes);

  // 趨勢分數：價格相對均線排列
  let trendScore = 50;
  if (price > ema20) trendScore += 12;
  else trendScore -= 12;
  if (ema20 > ema50) trendScore += 12;
  else trendScore -= 12;
  if (ema200 !== null) {
    if (price > ema200) trendScore += 10;
    else trendScore -= 10;
    if (ema50 > ema200) trendScore += 6;
    else trendScore -= 6;
  }
  trendScore = clamp(trendScore);

  // 動能分數：RSI 落在健康偏強區間 + MACD 柱狀圖轉正
  let momentumScore = 50;
  if (rsi14 >= 50 && rsi14 <= 70) momentumScore += 20;
  else if (rsi14 > 70 && rsi14 <= 80) momentumScore += 8; // 偏熱但仍可
  else if (rsi14 > 80) momentumScore -= 15; // 過熱扣分
  else if (rsi14 < 30) momentumScore -= 10;
  if (histogram > 0 && macdLine > signalLine) momentumScore += 15;
  else if (histogram < 0) momentumScore -= 10;
  momentumScore = clamp(momentumScore);

  // 量能分數：需搭配幣別成交量資料另外調整（此處先給中性值，於 buildOpportunity 內修正）
  const volumeScore = 50;

  return {
    ema20,
    ema50,
    ema200,
    rsi14,
    macd: { macd: macdLine, signal: signalLine, histogram },
    atr14,
    bollinger: bb,
    trendScore,
    momentumScore,
    volumeScore,
  };
}

export function classifyMarketRegime(
  btcChange24h: number,
  btcTrendScore: number,
  fearGreed: number | null
): MarketRegime {
  if (fearGreed !== null && fearGreed <= 20) return "PANIC";
  if (fearGreed !== null && fearGreed >= 90) return "EUPHORIA";
  if (btcChange24h <= -8) return "PANIC";
  if (btcChange24h >= 12) return "EUPHORIA";
  if (btcTrendScore >= 65) return "BULL";
  if (btcTrendScore <= 35) return "BEAR";
  return "SIDEWAYS";
}

// Entry Quality Score：跟 Opportunity Score 分開評估，專門看「這個進場點位好不好」，
// 而不是「這個標的整體條件好不好」。這是 Signal Failure Audit 之後新增的一層過濾，
// 目的是篩掉「條件表面上很好、但進場位置其實是在追高／突破未確認」的訊號。
export function computeEntryQuality(params: {
  price: number;
  ema20: number;
  rsi14: number;
  recentHigh: number;
  riskRewardRatio: number;
  volumeScore: number;
  change24h: number;
}): number {
  let score = 50;

  // 距離 EMA20 太遠代表追高
  const extensionPct = params.ema20 > 0 ? ((params.price - params.ema20) / params.ema20) * 100 : 0;
  if (extensionPct >= 0 && extensionPct <= 3) score += 15;
  else if (extensionPct > 3 && extensionPct <= 8) score += 5;
  else if (extensionPct > 8) score -= 20; // 明顯追高
  else score -= 5; // 價格在均線下方，趨勢確認度較低

  // 太貼近前高，代表突破可能還沒回踩確認，容易被巴回來
  const distToHighPct = params.recentHigh > 0 ? ((params.recentHigh - params.price) / params.recentHigh) * 100 : 0;
  if (distToHighPct < 1) score -= 15;
  else if (distToHighPct >= 1 && distToHighPct <= 5) score += 10;

  // RSI 極端扣分，健康區間加分
  if (params.rsi14 >= 75) score -= 15;
  else if (params.rsi14 >= 50 && params.rsi14 <= 65) score += 10;

  // R:R 太低代表這筆划不來
  if (params.riskRewardRatio >= 4) score += 15;
  else if (params.riskRewardRatio >= 3) score += 8;
  else score -= 10;

  // 量能確認
  if (params.volumeScore >= 65) score += 10;
  else if (params.volumeScore < 40) score -= 10;

  // 24H 已經噴出一大段，代表進場位置偏差
  if (params.change24h >= 20) score -= 15;

  return clamp(score);
}

export function buildOpportunity(
  coin: CoinSnapshot,
  closes: number[],
  global: GlobalMarketSnapshot | null,
  fearGreed: FearGreed | null,
  regime: MarketRegime
): OpportunityCandidate {
  const indicators = buildIndicatorSet(closes);
  const price = coin.price;

  // 量能分數：直接用 Binance 24H 成交額（USDT）分級，不再依賴 CoinGecko 市值。
  const quoteVolume = coin.volume24h;
  let volumeScore = 50;
  if (quoteVolume >= 5_000_000_000) volumeScore = 90;
  else if (quoteVolume >= 1_000_000_000) volumeScore = 75;
  else if (quoteVolume >= 300_000_000) volumeScore = 60;
  else if (quoteVolume >= 50_000_000) volumeScore = 42;
  else volumeScore = 20;
  indicators.volumeScore = volumeScore;

  const reasons: string[] = [];
  const overheated = indicators.rsi14 >= 82;
  if (overheated) reasons.push("RSI 極端過熱 (≥82)");

  const lowLiquidity = quoteVolume < 20_000_000;
  if (lowLiquidity) reasons.push("24H 成交額過低，流動性不足");

  const hasSpiked = coin.change24h >= 25;
  const chaseRisk = hasSpiked && indicators.rsi14 >= 75;
  if (chaseRisk) reasons.push(`24H 已上漲 ${coin.change24h.toFixed(1)}%，RSI 極端，追高風險高`);

  const recentHigh = closes.length ? Math.max(...closes) : price;
  const nearHigh = recentHigh > 0 && price >= recentHigh * 0.98;
  const falseBreakoutRisk = nearHigh && volumeScore < 45;
  if (falseBreakoutRisk) reasons.push("價格逼近前高但量能未同步放大，疑似假突破");

  const riskFlags: RiskFlags = { overheated, falseBreakoutRisk, lowLiquidity, chaseRisk, reasons };

  let marketAdj = 0;
  if (regime === "BULL") marketAdj += 8;
  if (regime === "BEAR") marketAdj -= 15;
  if (regime === "PANIC") marketAdj -= 30;
  if (regime === "EUPHORIA") marketAdj -= 10;
  if (global && global.marketCapChange24h < -5) marketAdj -= 10;

  let sentimentAdj = 0;
  if (fearGreed) {
    if (fearGreed.value <= 20) sentimentAdj -= 10;
    else if (fearGreed.value >= 90) sentimentAdj -= 8;
    else if (fearGreed.value >= 45 && fearGreed.value <= 70) sentimentAdj += 5;
  }

  let opportunityScore =
    indicators.trendScore * 0.35 + indicators.momentumScore * 0.25 + volumeScore * 0.2 + 50 * 0.2 + marketAdj + sentimentAdj;

  if (overheated) opportunityScore -= 20;
  if (lowLiquidity) opportunityScore -= 25;
  if (falseBreakoutRisk) opportunityScore -= 15;
  if (chaseRisk) opportunityScore -= 30;
  opportunityScore = clamp(opportunityScore);

  let riskScore = 0;
  riskScore += overheated ? 30 : 0;
  riskScore += lowLiquidity ? 30 : 0;
  riskScore += falseBreakoutRisk ? 20 : 0;
  riskScore += chaseRisk ? 30 : 0;
  riskScore += regime === "PANIC" ? 25 : regime === "EUPHORIA" ? 15 : 0;
  const volAtrPct = indicators.atr14 && price > 0 ? (indicators.atr14 / price) * 100 : 0;
  riskScore += clamp(volAtrPct * 3, 0, 20);
  riskScore = clamp(riskScore);

  const doNotChase = chaseRisk;

  // 停損改為「Swing Low + 動態 ATR 緩衝」，取代原本單純的固定百分比（Signal Failure Audit 後修正）
  const stopLoss = calcStructuralStop(closes, price, indicators.atr14);
  const entryLow = price * 0.995;
  const entryHigh = price * 1.005;
  const riskDistance = price - stopLoss;
  const tp1 = price + riskDistance * 1.5;
  const tp2 = price + riskDistance * 3;
  const tp3 = price + riskDistance * 5;
  const riskRewardRatio = riskDistance > 0 ? (tp1 - price) / riskDistance : 0;

  const entryQuality = computeEntryQuality({
    price,
    ema20: indicators.ema20,
    rsi14: indicators.rsi14,
    recentHigh,
    riskRewardRatio,
    volumeScore,
    change24h: coin.change24h,
  });

  // 重新定義 A/S 級（Signal Failure Audit 後修正）：
  // 不再只看 Opportunity Score，加上 Entry Quality、Risk Score、R:R、市場環境四道關卡，
  // 目的是篩掉「條件看起來不錯，但進場位置其實是在追高／突破未確認」的訊號。
  const isS =
    !doNotChase &&
    opportunityScore >= 90 &&
    entryQuality >= 85 &&
    riskScore <= 30 &&
    riskRewardRatio >= 4 &&
    regime !== "PANIC" &&
    regime !== "EUPHORIA" &&
    !lowLiquidity;
  const isA =
    !doNotChase &&
    opportunityScore >= 80 &&
    entryQuality >= 75 &&
    riskScore <= 40 &&
    riskRewardRatio >= 3 &&
    regime !== "PANIC";
  const grade: OpportunityCandidate["grade"] = isS ? "S" : isA ? "A" : opportunityScore >= 70 ? "B" : "C";

  const reasonsFor: string[] = [];
  if (indicators.trendScore >= 65) reasonsFor.push("價格站上主要均線，趨勢偏多");
  if (indicators.momentumScore >= 65) reasonsFor.push("動能健康，MACD 柱狀圖轉正");
  if (volumeScore >= 65) reasonsFor.push("24H 成交額高，流動性與資金關注度充足");
  if (entryQuality >= 75) reasonsFor.push("進場位置品質佳：非追高、有回落空間、R:R 充足");
  if (regime === "BULL") reasonsFor.push("大盤處於多頭格局，環境支持做多");
  if (fearGreed && fearGreed.value >= 45 && fearGreed.value <= 70) reasonsFor.push("市場情緒中性偏多，非極端區間");
  if (reasonsFor.length === 0) reasonsFor.push("目前條件僅屬中性，非明確做多訊號");

  const reasonsAgainst: string[] = [
    `跌破停損價 $${stopLoss.toFixed(4)} 視為判斷失效`,
    "若成交量無法配合放大，突破可能為假突破",
  ];
  if (entryQuality < 60) reasonsAgainst.push("進場位置品質偏低（可能追高或突破未確認），即使分數高也建議觀望");
  if (regime === "BEAR" || regime === "PANIC") reasonsAgainst.push("大盤處於空頭／恐慌格局，逆勢交易風險高");
  if (indicators.rsi14 >= 70) reasonsAgainst.push("RSI 偏高，短期有回檔疑慮");
  riskFlags.reasons.forEach((r) => reasonsAgainst.push(r));

  return {
    coin,
    indicators,
    opportunityScore,
    entryQuality,
    riskScore,
    grade,
    entryLow,
    entryHigh,
    stopLoss,
    tp1,
    tp2,
    tp3,
    riskRewardRatio,
    reasonsFor,
    reasonsAgainst,
    riskFlags,
    doNotChase,
  };
}
