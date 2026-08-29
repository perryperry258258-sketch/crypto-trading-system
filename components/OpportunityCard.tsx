"use client";

import { useState } from "react";
import { OpportunityCandidate } from "@/lib/types";

const gradeStyle: Record<string, string> = {
  S: "bg-s/20 text-s border-s/40",
  A: "bg-bull/20 text-bull border-bull/40",
  B: "bg-warn/20 text-warn border-warn/40",
  C: "bg-subtext/10 text-subtext border-subtext/30",
};

const gradeEmoji: Record<string, string> = { S: "🔥", A: "🟢", B: "🟡", C: "⚪" };

function fmt(n: number) {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(4);
}

export default function OpportunityCard({ c }: { c: OpportunityCandidate }) {
  const [open, setOpen] = useState(false);
  const changeColor = c.coin.change24h >= 0 ? "text-bull" : "text-bear";

  return (
    <div className="rounded-xl border border-border bg-panel overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
        style={{ minHeight: 44 }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded border ${gradeStyle[c.grade]}`}>
            {gradeEmoji[c.grade]} {c.grade}
          </span>
          <div className="min-w-0">
            <div className="font-display font-semibold text-text truncate">{c.coin.symbol}</div>
            <div className="text-xs text-subtext numeric-safe truncate">${fmt(c.coin.price)}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono font-semibold numeric-safe">{c.opportunityScore.toFixed(0)}/100</div>
          <div className={`text-xs numeric-safe ${changeColor}`}>
            {c.coin.change24h >= 0 ? "+" : ""}
            {c.coin.change24h.toFixed(1)}% (24H)
          </div>
        </div>
      </button>

      {c.doNotChase && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-bear/10 border border-bear/30 text-bear text-xs font-semibold">
          🔴 DO NOT CHASE — 已大幅上漲且指標極端，追高風險最高
        </div>
      )}

      {open && (
        <div className="px-4 pb-4 border-t border-border pt-3 space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-panel2 py-2">
              <div className="text-subtext text-xs">進場區間</div>
              <div className="font-mono numeric-safe text-xs">
                {fmt(c.entryLow)}~{fmt(c.entryHigh)}
              </div>
            </div>
            <div className="rounded-lg bg-panel2 py-2">
              <div className="text-subtext text-xs">停損</div>
              <div className="font-mono text-bear numeric-safe">{fmt(c.stopLoss)}</div>
            </div>
            <div className="rounded-lg bg-panel2 py-2">
              <div className="text-subtext text-xs">R:R</div>
              <div className="font-mono numeric-safe">{c.riskRewardRatio.toFixed(1)}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-panel2 py-2">
              <div className="text-subtext text-xs">TP1</div>
              <div className="font-mono text-bull numeric-safe">{fmt(c.tp1)}</div>
            </div>
            <div className="rounded-lg bg-panel2 py-2">
              <div className="text-subtext text-xs">TP2</div>
              <div className="font-mono text-bull numeric-safe">{fmt(c.tp2)}</div>
            </div>
            <div className="rounded-lg bg-panel2 py-2">
              <div className="text-subtext text-xs">TP3</div>
              <div className="font-mono text-bull numeric-safe">{fmt(c.tp3)}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <div className="text-subtext">Trend</div>
              <div className="font-mono">{c.indicators.trendScore.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-subtext">Momentum</div>
              <div className="font-mono">{c.indicators.momentumScore.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-subtext">Volume</div>
              <div className="font-mono">{c.indicators.volumeScore.toFixed(0)}</div>
            </div>
          </div>

          <div>
            <div className="text-bull text-xs font-semibold mb-1">✓ 為什麼現在值得交易</div>
            <ul className="list-disc list-inside text-subtext space-y-0.5">
              {c.reasonsFor.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-bear text-xs font-semibold mb-1">✗ 為什麼可能失敗 / 失效條件</div>
            <ul className="list-disc list-inside text-subtext space-y-0.5">
              {c.reasonsAgainst.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
