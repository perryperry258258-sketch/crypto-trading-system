"use client";

// 簡單的 SVG 折線圖：把一連串交易的 R 倍數累加起來，畫出「資金曲線」的形狀。
// 不用額外的圖表套件，資料量小（幾十筆交易），純 SVG 就夠了。

export default function EquityCurve({ rMultiples }: { rMultiples: number[] }) {
  if (rMultiples.length < 2) {
    return <div className="text-xs text-subtext text-center py-6">交易次數還太少，畫不出曲線</div>;
  }

  const cum: number[] = [];
  let running = 0;
  rMultiples.forEach((r) => {
    running += r;
    cum.push(running);
  });

  const w = 320;
  const h = 110;
  const pad = 6;
  const max = Math.max(0, ...cum);
  const min = Math.min(0, ...cum);
  const range = max - min || 1;

  const points = cum
    .map((v, i) => {
      const x = pad + (i / (cum.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const zeroY = h - pad - ((0 - min) / range) * (h - pad * 2);
  const final = cum[cum.length - 1];
  const color = final >= 0 ? "#20C97A" : "#F0475B";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 110 }} preserveAspectRatio="none">
      <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="#232937" strokeWidth={1} strokeDasharray="4 3" />
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
