// 蒙地卡羅重排（Monte Carlo Reshuffling）。
//
// 目的：歷史回測只給你「一種發生順序」的最大回撤，但交易的實際順序本來就有隨機性——
// 同一批交易的結果，如果運氣不同、發生的先後順序不同，最大回撤可能差很多。
// 這裡把同一批交易的 R 倍數重新洗牌很多次，每次都重算一次最大回撤，
// 統計出「最壞回撤」大概落在哪個範圍，而不是只看歷史剛好發生的那一種順序。
//
// 誠實限制：這裡只重排順序，不會憑空生出新的交易或改變每筆交易的 R 倍數本身，
// 所以如果原始策略沒有正期望值，重排一千次也不會讓它變成有正期望值——
// 這個工具回答的是「回撤風險有多大」，不是「策略有沒有效」。

function maxDrawdown(rSeries: number[]): number {
  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  rSeries.forEach((r) => {
    cum += r;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  });
  return maxDD;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface MonteCarloResult {
  simulations: number;
  tradeCount: number;
  p5DrawdownR: number;
  p50DrawdownR: number;
  p95DrawdownR: number;
  worstDrawdownR: number;
  historicalDrawdownR: number; // 真實歷史順序下的最大回撤，跟上面的重排分布對照用
}

export function runMonteCarlo(rMultiples: number[], simulations: number = 2000): MonteCarloResult {
  const historicalDrawdownR = maxDrawdown(rMultiples);
  const drawdowns: number[] = [];
  for (let i = 0; i < simulations; i++) {
    drawdowns.push(maxDrawdown(shuffle(rMultiples)));
  }
  drawdowns.sort((a, b) => a - b);
  const pct = (p: number) => drawdowns[Math.min(drawdowns.length - 1, Math.floor(p * drawdowns.length))];
  return {
    simulations,
    tradeCount: rMultiples.length,
    p5DrawdownR: pct(0.05),
    p50DrawdownR: pct(0.5),
    p95DrawdownR: pct(0.95),
    worstDrawdownR: drawdowns[drawdowns.length - 1],
    historicalDrawdownR,
  };
}
