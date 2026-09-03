"use client";

import { useEffect, useState } from "react";
import { fetchKlines } from "@/lib/binance";
import { evaluateLiveSignal, LiveSignal } from "@/lib/retestEngine";
import { upsertFromLiveSignal } from "@/lib/signalLog";
import { SignalCard, SignalListRow, EmptyState, sortByRecency } from "@/components/ui";

// UI/UX改版：只改視覺呈現與篩選分頁，抓取/判斷邏輯（evaluateLiveSignal）完全不變。

const AUDIT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT"];
const ENGINE_WINDOW = 60;
const ENGINE_TP = 1;

type FilterTab = "ALL" | "ACTIVE" | "WAITING";

const WAITING_STATES = new Set(["SETUP", "WATCHING", "WAIT_RETEST"]);

export default function OpportunitiesPage() {
  const [signals, setSignals] = useState<LiveSignal[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>("ALL");

  const runCheck = async () => {
    setLoading(true);
    setError(null);
    const results: LiveSignal[] = [];
    const failedSymbols: string[] = [];
    let successCount = 0;
    for (const symbol of AUDIT_SYMBOLS) {
      try {
        const candles = await fetchKlines(symbol, "5m", 288);
        successCount++;
        const signal = evaluateLiveSignal(symbol, candles, ENGINE_WINDOW, ENGINE_TP, 0.3);
        results.push(signal);
        upsertFromLiveSignal(signal, ENGINE_TP);
      } catch {
        failedSymbols.push(symbol.replace("USDT", ""));
      }
    }
    setLoading(false);
    if (successCount === 0) {
      setError("所有幣種的即時資料都抓取失敗，請檢查網路連線後再試一次");
      return;
    }
    if (failedSymbols.length > 0) {
      setError(`${failedSymbols.join("、")} 這次抓取失敗，重新整理應該就會恢復。`);
    }
    setSignals(results);
  };

  useEffect(() => {
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSignals = sortByRecency(signals ? signals.filter((s) => s.state === "RETEST_CONFIRMED") : []);
  const waitingSignals = signals ? signals.filter((s) => WAITING_STATES.has(s.state)) : [];

  const filtered =
    tab === "ACTIVE" ? activeSignals : tab === "WAITING" ? waitingSignals : signals ?? [];

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-display font-bold tracking-tight">A級機會</h1>
        <button
          onClick={runCheck}
          disabled={loading}
          className="w-9 h-9 rounded-full flex items-center justify-center border border-border active:scale-90 transition text-subtext"
          aria-label="更新"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "animate-spin" : ""}>
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </header>

      {/* 篩選分頁 */}
      <div className="flex gap-2 mb-4">
        {[
          { key: "ALL" as FilterTab, label: "全部" },
          { key: "ACTIVE" as FilterTab, label: "可進場" },
          { key: "WAITING" as FilterTab, label: "等待中" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-xl text-sm py-2 border transition ${
              tab === t.key ? "bg-brand/15 text-brand border-brand/40" : "bg-panel2 text-subtext border-border"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{error}</div>}

      {!signals ? (
        <div className="text-sm text-subtext text-center py-8">{loading ? "檢查中…" : "尚無資料"}</div>
      ) : filtered.length === 0 ? (
        <EmptyState text={tab === "ACTIVE" ? "目前沒有A級機會" : "沒有符合條件的幣種"} sub="系統持續監控" />
      ) : tab === "ACTIVE" ? (
        filtered.map((s) => <SignalCard key={s.symbol} s={s} />)
      ) : (
        filtered.map((s) => <SignalListRow key={s.symbol} s={s} />)
      )}
    </main>
  );
}
