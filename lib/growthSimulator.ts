import { computeCapitalState, effectiveMaxRiskPct } from "./phases";
import { OosTradeRecord } from "./signalLog";

// 資金成長機率模擬器（新功能，不是策略邏輯的一部分）。
//
// 做法：拿樣本外段真實的514筆交易（真實R值分布、真實進場時間間隔），用蒙地卡羅重抽樣
// （bootstrap：每一步隨機抽一筆歷史交易的R值/間隔，可重複抽），套用「現有、完全沒有修改」
// 的 lib/phases.ts 風控框架（computeCapitalState / effectiveMaxRiskPct），逐步模擬本金成長，
// 一直到達目標金額，或超過每次模擬的交易筆數上限。跑很多次模擬，回報一個機率分布
// （P10/P50/P90），不是單一個「保證答案」的數字。
//
// 【誠實揭露】
// - 這是機率估計，不是預測，樣本只有514筆，未來實際表現可能跟這514筆的分布不一樣
// - 「每筆交易間隔多久」是從歷史進場時間反推的統計間隔，不是保證未來也會用同樣頻率出現訊號
// - PROTECT_MODE（回撤達20%，理論上禁止新交易）在這裡做了一個模擬簡化：
//   為了不讓模擬卡死在無限迴圈，模擬器假設此時仍以0.1%的極小風險嘗試操作，
//   這是模擬器內部的簡化假設，不代表系統實際允許在保護模式下交易
// - 沒有把手續費/滑價以外的其他真實世界摩擦（例如訊號執行延遲、實際成交價滑點）算進去，
//   這些retestStrategyLab.ts的回測本身已經扣過一次，這裡沿用同樣的R值，不重複計算

export interface GrowthSimResult {
  simulations: number;
  reachedCount: number;
  reachedPct: number;
  tradesNeeded: { p10: number; p50: number; p90: number } | null;
  daysNeeded: { p10: number; p50: number; p90: number } | null;
  sampleSize: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

export function runGrowthSimulation(
  historicalTrades: OosTradeRecord[],
  startCapital: number,
  targetCapital: number,
  simulations: number = 1000,
  maxTradesPerSim: number = 20000
): GrowthSimResult {
  const sorted = [...historicalTrades].sort((a, b) => a.entryTime - b.entryTime);
  const rMultiples = sorted.map((t) => t.rMultiple);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].entryTime - sorted[i - 1].entryTime;
    if (d >= 0) intervals.push(d);
  }

  if (rMultiples.length === 0 || intervals.length === 0) {
    return { simulations: 0, reachedCount: 0, reachedPct: 0, tradesNeeded: null, daysNeeded: null, sampleSize: rMultiples.length };
  }

  const tradesResults: number[] = [];
  const daysResults: number[] = [];
  let reachedCount = 0;

  for (let sim = 0; sim < simulations; sim++) {
    let capital = startCapital;
    let peak = startCapital;
    let trades = 0;
    let elapsedSeconds = 0;
    let reached = capital >= targetCapital;

    while (!reached && trades < maxTradesPerSim) {
      const capitalState = computeCapitalState(capital, peak);
      let riskPct = effectiveMaxRiskPct(capitalState);
      if (riskPct <= 0) riskPct = 0.1; // 模擬簡化：避免PROTECT_MODE卡死整個模擬

      const r = rMultiples[Math.floor(Math.random() * rMultiples.length)];
      capital = Math.max(0, capital * (1 + (riskPct / 100) * r));
      peak = Math.max(peak, capital);
      trades += 1;

      const interval = intervals[Math.floor(Math.random() * intervals.length)];
      elapsedSeconds += interval;

      if (capital >= targetCapital) reached = true;
      if (capital <= 0) break; // 本金歸零，這次模擬提前結束（不計入reached）
    }

    if (reached) {
      reachedCount++;
      tradesResults.push(trades);
      daysResults.push(elapsedSeconds / 86400);
    }
  }

  tradesResults.sort((a, b) => a - b);
  daysResults.sort((a, b) => a - b);

  return {
    simulations,
    reachedCount,
    reachedPct: (reachedCount / simulations) * 100,
    tradesNeeded:
      tradesResults.length > 0
        ? { p10: percentile(tradesResults, 0.1), p50: percentile(tradesResults, 0.5), p90: percentile(tradesResults, 0.9) }
        : null,
    daysNeeded:
      daysResults.length > 0
        ? { p10: percentile(daysResults, 0.1), p50: percentile(daysResults, 0.5), p90: percentile(daysResults, 0.9) }
        : null,
    sampleSize: rMultiples.length,
  };
}
