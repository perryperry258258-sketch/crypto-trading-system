import { DailyState, MarketRegime, OpportunityCandidate } from "./types";

// 規格書第二節：每日只允許三種狀態
export function computeDailyState(
  regime: MarketRegime,
  candidates: OpportunityCandidate[],
  effectiveMaxRiskPct: number
): DailyState {
  const now = new Date().toISOString();
  const hasHighQuality = candidates.some((c) => (c.grade === "S" || c.grade === "A") && !c.doNotChase);
  const hasWatchable = candidates.some((c) => c.grade === "B" && !c.doNotChase);

  if (effectiveMaxRiskPct <= 0) {
    return {
      light: "NO_TRADE",
      regime,
      headline: "獲利保護機制啟動（回撤過大），今天禁止新開倉。",
      fetchedAt: now,
    };
  }

  if (regime === "PANIC") {
    return { light: "NO_TRADE", regime, headline: "市場恐慌狀態，等待市場穩定，今天不要交易。", fetchedAt: now };
  }

  if (regime === "EUPHORIA") {
    return {
      light: "CAUTION",
      regime,
      headline: "市場過熱（Euphoria），禁止追高，僅觀察不追價。",
      fetchedAt: now,
    };
  }

  if (hasHighQuality && (regime === "BULL" || regime === "SIDEWAYS")) {
    return { light: "GO", regime, headline: "出現高品質機會，且大盤環境支持交易。", fetchedAt: now };
  }

  if (hasWatchable || regime === "SIDEWAYS") {
    return { light: "CAUTION", regime, headline: "僅有中等品質機會或大盤方向不明，謹慎小倉位交易。", fetchedAt: now };
  }

  if (regime === "BEAR") {
    return { light: "NO_TRADE", regime, headline: "大盤處於空頭格局，且無高品質機會，今天不要交易。", fetchedAt: now };
  }

  return { light: "NO_TRADE", regime, headline: "目前沒有符合系統條件的高品質交易，今天不要交易。", fetchedAt: now };
}
