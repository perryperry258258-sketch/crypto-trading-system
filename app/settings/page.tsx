"use client";

import { useEffect, useState } from "react";
import { useMarketData } from "@/lib/useMarketData";
import { PHASES } from "@/lib/phases";

const wsStatusLabel: Record<string, { label: string; className: string }> = {
  LIVE: { label: "🟢 Connected", className: "text-bull" },
  CONNECTING: { label: "🟡 Connecting", className: "text-warn" },
  DELAYED: { label: "🟡 Delayed", className: "text-warn" },
  ERROR: { label: "🔴 Error", className: "text-bear" },
};

export default function SettingsPage() {
  const { capital, setCapital, capitalState, connectionStatus, lastTickAt, lastUpdated, scanUpdatedAt, coins, candidates, global } =
    useMarketData();
  const [input, setInput] = useState(String(capital));
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const tickAgeMs = lastTickAt ? now - lastTickAt.getTime() : null;
  const ws = wsStatusLabel[connectionStatus];
  const restOk = coins.length > 0;
  const coingeckoOk = global !== null;
  const chartOk = candidates.length > 0 || coins.length > 0; // 圖表與 dashboard 共用同一個 Binance K線來源

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-4">
        <h1 className="text-xl font-display font-bold tracking-tight">設定</h1>
      </header>

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-3">DATA HEALTH</div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-subtext">Binance WebSocket</span>
            <span className={ws.className}>{ws.label}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">Binance REST（初始快照）</span>
            <span className={restOk ? "text-bull" : "text-bear"}>{restOk ? "🟢 Working" : "🔴 No data"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">CoinGecko（市值/大盤）</span>
            <span className={coingeckoOk ? "text-bull" : "text-bear"}>{coingeckoOk ? "🟢 Working" : "🔴 Error"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">TradingView Chart（Binance K線）</span>
            <span className={chartOk ? "text-bull" : "text-bear"}>{chartOk ? "🟢 Working" : "⚪ 尚無資料"}</span>
          </div>
          <div className="h-px bg-border my-2" />
          <div className="flex items-center justify-between">
            <span className="text-subtext">Last Tick（Binance WS）</span>
            <span className="numeric-safe">{lastTickAt ? lastTickAt.toLocaleTimeString() : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">Data Latency</span>
            <span className="numeric-safe">{tickAgeMs !== null ? `${tickAgeMs.toLocaleString()} ms` : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">CoinGecko 最後更新</span>
            <span className="numeric-safe">{lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">技術指標最後掃描</span>
            <span className="numeric-safe">{scanUpdatedAt ? scanUpdatedAt.toLocaleTimeString() : "—"}</span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-xs text-subtext mb-2">目前本金</div>
        <div className="flex gap-2">
          <input
            inputMode="numeric"
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/[^0-9]/g, ""))}
            className="flex-1 min-w-0 bg-panel2 border border-border rounded-xl px-3 text-lg numeric-safe"
            style={{ minHeight: 44 }}
          />
          <button
            onClick={() => setCapital(Number(input) || capital)}
            className="btn-primary px-4 bg-accent/20 text-accent border border-accent/40 text-sm"
          >
            儲存
          </button>
        </div>
        <div className="text-xs text-subtext mt-2">
          目前 {capitalState.phase.label} ・ 單筆最大風險 {capitalState.phase.maxRiskPct.toFixed(2)}%
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-3">資金階段與風控對照表</div>
        <div className="space-y-2">
          {PHASES.map((p) => (
            <div
              key={p.index}
              className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 ${
                p.index === capitalState.phase.index ? "bg-accent/15 border border-accent/40" : "bg-panel2"
              }`}
            >
              <span className="font-medium">{p.label}</span>
              <span className="text-subtext numeric-safe truncate mx-2">
                NT${p.from.toLocaleString()}
                {p.to ? ` ~ ${p.to.toLocaleString()}` : "+"}
              </span>
              <span className="font-semibold numeric-safe">{p.maxRiskPct.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-2">關於本系統</div>
        <div className="text-sm text-subtext leading-relaxed break-words">
          本系統僅供交易決策參考，所有評分、訊號與回測結果都可能出錯或失效，不構成投資建議，不保證獲利。請自行承擔交易風險。
        </div>
      </section>
    </main>
  );
}
