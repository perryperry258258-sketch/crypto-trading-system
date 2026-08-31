// 標準技術指標計算。輸入為時間序列收盤價（舊→新）。
// 這些都是公開、通用的數學公式，非任何專有策略。

export function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(NaN);
      continue;
    }
    const slice = values.slice(i - period + 1, i + 1);
    out.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return out;
}

export function rsi(values: number[], period: number = 14): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period + 1) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(
  values: number[],
  fast: number = 12,
  slow: number = 26,
  signalPeriod: number = 9
): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = ema(macdLine, signalPeriod);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

// 以收盤價序列近似真實區間（無 OHLC 時的簡化版 ATR）
export function approxAtr(values: number[], period: number = 14): number | null {
  if (values.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < values.length; i++) {
    trs.push(Math.abs(values[i] - values[i - 1]));
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

export function bollinger(
  values: number[],
  period: number = 20,
  mult: number = 2
): { upper: number; mid: number; lower: number } {
  const slice = values.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / slice.length;
  const std = Math.sqrt(variance);
  return { upper: mid + mult * std, mid, lower: mid - mult * std };
}

export function last(values: number[]): number {
  return values[values.length - 1];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// 結構化停損：用近期 Swing Low（收盤價序列的近期低點，非完整 OHLC wick，這是已知的簡化）
// 加上「依波動率動態調整」的 ATR 緩衝，取代單純固定百分比停損。
// 多單版本（本系統目前只做多單訊號）。
export function calcStructuralStop(
  closes: number[],
  price: number,
  atr14: number | null,
  lookback: number = 20
): number {
  const window = closes.slice(-Math.min(lookback, closes.length));
  const swingLow = window.length ? Math.min(...window) : price;
  const atrPct = atr14 && price > 0 ? (atr14 / price) * 100 : 5;
  // 波動越大，緩衝倍數越大，但限制在 0.5～1.5 倍之間，避免極端值失真
  const bufferMult = clamp(atrPct / 3, 0.5, 1.5);
  const atrBuffer = (atr14 ?? price * 0.02) * bufferMult;
  let stop = swingLow - atrBuffer;

  // 保底範圍：停損距離不能小於 2%（太貼近容易被正常雜訊掃到）
  // 也不能大於 15%（結構位置在盤整格局時可能離現價過遠，失去停損意義）
  let stopPct = ((price - stop) / price) * 100;
  stopPct = clamp(stopPct, 2, 15);
  stop = price * (1 - stopPct / 100);
  return stop;
}
