import { approxAtr, bollinger, ema, last, macd, rsi } from "./indicators";
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

export function buildOpportunity(
  coin: CoinSnapshot,
  closes: number[],
  global: GlobalMarketSnapshot,
  fearGreed: FearGreed | null,
  regime: MarketRegime
): OpportunityCandidate {
  const indicators = buildIndicatorSet(closes);
  const price = coin.price;

  // 量能分數：24H 成交量 / 市值 比例（換手率），比例越高代表資金關注度越高
  const turnover = coin.marketCap > 0 ? coin.volume24h / coin.marketCap : 0;
  let volumeScore = 50;
  if (turnover >= 0.15) volumeScore = 85;
  else if (turnover >= 0.08) volumeScore = 70;
  else if (turnover >= 0.04) volumeScore = 55;
  else if (turnover >= 0.015) volumeScore = 40;
  else volumeScore = 20; // 流動性偏低
  indicators.volumeScore = volumeScore;

  // 風險旗標（規格書第十一、十二節）
  const reasons: string[] = [];
  const overheated = indicators.rsi14 >= 82;
  if (overheated) reasons.push("RSI 極端過熱 (≥82)");

  const lowLiquidity = turnover < 0.01;
  if (lowLiquidity) reasons.push("成交量／市值比過低，流動性不足");

  const hasSpiked = coin.change24h >= 25;
  const chaseRisk = hasSpiked && indicators.rsi14 >= 75;
  if (chaseRisk) reasons.push(`24H 已上漲 ${coin.change24h.toFixed(1)}%，RSI 極端，追高風險高`);

  // 簡化版假突破偵測：價格接近近7日高點但量能分數偏低
  const sparklineHigh = coin.sparkline.length ? Math.max(...coin.sparkline) : price;
  const nearHigh = sparklineHigh > 0 && price >= sparklineHigh * 0.98;
  const falseBreakoutRisk = nearHigh && volumeScore < 45;
  if (falseBreakoutRisk) reasons.push("價格逼近前高但量能未同步放大，疑似假突破");

  const riskFlags: RiskFlags = {
    overheated,
    falseBreakoutRisk,
    lowLiquidity,
    chaseRisk,
    reasons,
  };

  // 市場面加減分
  let marketAdj = 0;
  if (regime === "BULL") marketAdj += 8;
  if (regime === "BEAR") marketAdj -= 15;
  if (regime === "PANIC") marketAdj -= 30;
  if (regime === "EUPHORIA") marketAdj -= 10; // 過熱環境降低評分，避免追高
  if (global.marketCapChange24h < -5) marketAdj -= 10;

  // 情緒面加減分（極端恐慌／極端貪婪都扣分，中性偏多略加分）
  let sentimentAdj = 0;
  if (fearGreed) {
    if (fearGreed.value <= 20) sentimentAdj -= 10;
    else if (fearGreed.value >= 90) sentimentAdj -= 8;
    else if (fearGreed.value >= 45 && fearGreed.value <= 70) sentimentAdj += 5;
  }

  let opportunityScore =
    indicators.trendScore * 0.35 +
    indicators.momentumScore * 0.25 +
    volumeScore * 0.2 +
    50 * 0.2 + // 基本面資料 V0.2 尚未整合，先給中性權重
    marketAdj +
    sentimentAdj;

  // 風險旗標懲罰
  if (overheated) opportunityScore -= 20;
  if (lowLiquidity) opportunityScore -= 25;
  if (falseBreakoutRisk) opportunityScore -= 15;
  if (chaseRisk) opportunityScore -= 30;

  opportunityScore = clamp(opportunityScore);

  // 風險分數（越高越危險）
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

  // 停損：以近期 ATR 為基礎，至少 3%，最多 12%
  const atrPct = indicators.atr14 && price > 0 ? (indicators.atr14 / price) * 100 : 5;
  const stopPct = clamp(atrPct * 1.5, 3, 12);
  const stopLoss = price * (1 - stopPct / 100);
  const entryLow = price * 0.995;
  const entryHigh = price * 1.005;
  const riskDistance = price - stopLoss;
  const tp1 = price + riskDistance * 1.5;
  const tp2 = price + riskDistance * 3;
  const tp3 = price + riskDistance * 5;
  const riskRewardRatio = riskDistance > 0 ? (tp1 - price) / riskDistance : 0;

  const grade: OpportunityCandidate["grade"] = doNotChase
    ? "C"
    : opportunityScore >= 90
    ? "S"
    : opportunityScore >= 80
    ? "A"
    : opportunityScore >= 70
    ? "B"
    : "C";

  const reasonsFor: string[] = [];
  if (indicators.trendScore >= 65) reasonsFor.push("價格站上主要均線，趨勢偏多");
  if (indicators.momentumScore >= 65) reasonsFor.push("動能健康，MACD 柱狀圖轉正");
  if (volumeScore >= 65) reasonsFor.push("成交量／市值比偏高，資金關注度提升");
  if (regime === "BULL") reasonsFor.push("大盤處於多頭格局，環境支持做多");
  if (fearGreed && fearGreed.value >= 45 && fearGreed.value <= 70) reasonsFor.push("市場情緒中性偏多，非極端區間");
  if (reasonsFor.length === 0) reasonsFor.push("目前條件僅屬中性，非明確做多訊號");

  const reasonsAgainst: string[] = [
    `跌破停損價 $${stopLoss.toFixed(4)} 視為判斷失效`,
    "若成交量無法配合放大，突破可能為假突破",
  ];
  if (regime === "BEAR" || regime === "PANIC") reasonsAgainst.push("大盤處於空頭／恐慌格局，逆勢交易風險高");
  if (indicators.rsi14 >= 70) reasonsAgainst.push("RSI 偏高，短期有回檔疑慮");
  riskFlags.reasons.forEach((r) => reasonsAgainst.push(r));

  return {
    coin,
    indicators,
    opportunityScore,
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
