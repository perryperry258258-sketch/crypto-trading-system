"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useMarketData } from "@/lib/useMarketData";
import { lightStyle, regimeLabel } from "@/lib/labels";

function fmt(n: number) {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

const statusBadge: Record<string, { label: string; className: string }> = {
  LIVE: { label: "🟢 LIVE", className: "text-bull" },
  CONNECTING: { label: "🟡 連線中", className: "text-warn" },
  DELAYED: { label: "🟡 DATA DELAY", className: "text-warn" },
  ERROR: { label: "🔴 DATA ERROR", className: "text-bear" },
};

export default function Home() {
  const {
    capital,
    capitalState,
    btc,
    eth,
    regime,
    daily,
    top3,
    dangerous,
    errors,
    loading,
    reload,
    lastUpdated,
    connectionStatus,
  } = useMarketData();

  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const bestOpp = top3[0];
  const status = statusBadge[connectionStatus];

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-display font-bold tracking-tight">首頁</h1>
        <button
          onClick={reload}
          className="btn-primary px-3 text-xs text-subtext border border-border active:scale-95 transition"
        >
          {loading ? "更新中" : "🔄 更新"}
        </button>
      </header>
      <div className={`text-xs mb-4 ${status.className}`}>
        {status.label} • {clock}
      </div>

      {errors.length > 0 && (
        <div className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn space-y-0.5">
          {errors.map((e, i) => (
            <div key={i} className="break-words">
              ⚠️ {e}
            </div>
          ))}
          <div className="text-subtext pt-1">本次更新部分失敗，以下顯示最近一次成功取得的資料，按右上角「更新」重試。</div>
        </div>
      )}

      {/* 1. 今日要不要交易 — 最優先 */}
      <section className={`rounded-2xl border p-4 mb-3 ${lightStyle[daily.light].className}`}>
        <div className="text-xs text-subtext mb-1">今日結論</div>
        <div className="text-2xl font-display font-bold mb-1">{lightStyle[daily.light].label}</div>
        <div className="text-sm leading-relaxed break-words">{daily.headline}</div>
      </section>

      {/* 2. 市場狀態 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-xs text-subtext mb-2">今日市場・{regimeLabel[regime]}</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-panel2 p-3 min-w-0">
            <div className="text-xs text-subtext mb-0.5">BTC</div>
            <div className="text-base font-semibold numeric-safe truncate">
              {btc ? `$${fmt(btc.price)}` : "—"}
            </div>
            {btc && (
              <div className={`text-xs ${btc.change24h >= 0 ? "text-bull" : "text-bear"}`}>
                {btc.change24h >= 0 ? "↑" : "↓"} {Math.abs(btc.change24h).toFixed(1)}%
              </div>
            )}
          </div>
          <div className="rounded-xl bg-panel2 p-3 min-w-0">
            <div className="text-xs text-subtext mb-0.5">ETH</div>
            <div className="text-base font-semibold numeric-safe truncate">
              {eth ? `$${fmt(eth.price)}` : "—"}
            </div>
            {eth && (
              <div className={`text-xs ${eth.change24h >= 0 ? "text-bull" : "text-bear"}`}>
                {eth.change24h >= 0 ? "↑" : "↓"} {Math.abs(eth.change24h).toFixed(1)}%
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 3. 高品質機會 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-xs text-subtext mb-2">🔥 今日機會</div>
        {bestOpp ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-lg font-display font-bold">{bestOpp.coin.symbol}</span>
              <span className="text-sm font-semibold text-accent">{bestOpp.opportunityScore.toFixed(0)}/100</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center mb-3">
              <div>
                <div className="text-xs text-subtext">上行</div>
                <div className="text-sm font-semibold text-bull numeric-safe">
                  +{(((bestOpp.tp1 - bestOpp.coin.price) / bestOpp.coin.price) * 100).toFixed(0)}%
                </div>
              </div>
              <div>
                <div className="text-xs text-subtext">停損</div>
                <div className="text-sm font-semibold text-bear numeric-safe">
                  -{(((bestOpp.coin.price - bestOpp.stopLoss) / bestOpp.coin.price) * 100).toFixed(0)}%
                </div>
              </div>
              <div>
                <div className="text-xs text-subtext">R:R</div>
                <div className="text-sm font-semibold numeric-safe">{bestOpp.riskRewardRatio.toFixed(1)}</div>
              </div>
            </div>
            <Link
              href="/opportunities"
              className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm"
            >
              查看交易計畫
            </Link>
          </div>
        ) : (
          <div className="text-sm text-subtext text-center py-3">💤 目前沒有足夠高品質的交易機會</div>
        )}
      </section>

      {/* 4. 風險 */}
      {dangerous.length > 0 && (
        <section className="rounded-2xl border border-bear/40 bg-bear/10 p-4 mb-3">
          <div className="text-xs text-bear mb-1">⚠️ 風險</div>
          <div className="text-sm text-text break-words">
            {dangerous.length} 檔標的波動或追高風險升高（{dangerous.map((d) => d.coin.symbol).join("、")}）
          </div>
        </section>
      )}

      {/* 5. 我的資金 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-xs text-subtext mb-2">💰 我的資金</div>
        <div className="flex items-end justify-between mb-2">
          <div className="text-2xl font-display font-bold numeric-safe">NT${capital.toLocaleString()}</div>
          <div className="text-xs text-subtext text-right">
            目標
            <br />
            NT$1,000,000,000
          </div>
        </div>
        <div className="text-xs text-subtext mb-1">目前 {capitalState.phase.label}</div>
        <div className="h-2 rounded-full bg-panel2 overflow-hidden">
          <div className="h-full bg-accent" style={{ width: `${capitalState.progressPct}%` }} />
        </div>
      </section>

      {/* 6. 詳細資料 */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Link href="/market" className="btn-primary border border-border bg-panel text-sm">
          市場詳細分析
        </Link>
        <Link href="/opportunities" className="btn-primary border border-border bg-panel text-sm">
          全部交易機會
        </Link>
      </div>

      <footer className="text-center text-[11px] text-subtext pb-4">
        {lastUpdated ? `Updated: ${lastUpdated.toLocaleString()}` : "尚未更新"}
        <div className="mt-2 leading-relaxed opacity-70">本系統僅供決策參考，不構成投資建議，不保證獲利。</div>
      </footer>
    </main>
  );
}
