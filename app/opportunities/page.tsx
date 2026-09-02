"use client";

import { useEffect, useState } from "react";
import { fetchKlines } from "@/lib/binance";
import { evaluateLiveSignal, STATE_INFO, LiveSignal } from "@/lib/retestEngine";
import { upsertFromLiveSignal } from "@/lib/signalLog";

// 全部即時狀態 — 回踩引擎對8個幣種的完整判斷，取代舊Opportunity Score系統的
// 「今日高品質機會」排行榜（那套系統已經整套移除，回測證實沒有統計優勢）。

const AUDIT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT"];
const ENGINE_WINDOW = 60;
const ENGINE_TP = 1;

function SignalDetailCard({ s }: { s: LiveSignal }) {
  const info = STATE_INFO[s.state];
  const isActive = s.state === "RETEST_CONFIRMED";
  return (
    <div
      className={`rounded-2xl border p-4 mb-3 ${
        isActive ? "bg-bull/10 border-bull/30" : "bg-panel border-border"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-lg font-display font-bold">{s.symbol.replace("USDT", "")}</span>
        <span className="text-sm font-semibold">
          {info.emoji} {info.label}
        </span>
      </div>

      {s.direction && (
        <div className="text-xs text-subtext mb-2">
          方向：{s.direction === "LONG" ? "做多" : "做空"}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs mb-2">
        <div>
          <div className="text-subtext">現價</div>
          <div className="font-semibold numeric-safe">{s.currentPrice?.toPrecision(6) ?? "—"}</div>
        </div>
        <div>
          <div className="text-subtext">資料延遲</div>
          <div className="font-semibold numeric-safe">
            {s.dataAgeMinutes != null ? `${s.dataAgeMinutes.toFixed(1)}分` : "—"}
          </div>
        </div>
        <div>
          <div className="text-subtext">Reference High</div>
          <div className="font-semibold numeric-safe">{s.refHigh?.toPrecision(6) ?? "—"}</div>
        </div>
        <div>
          <div className="text-subtext">Reference Low</div>
          <div className="font-semibold numeric-safe">{s.refLow?.toPrecision(6) ?? "—"}</div>
        </div>
        {s.distanceToBreakoutPct != null && (
          <div className="col-span-2">
            <div className="text-subtext">距突破</div>
            <div className="font-semibold numeric-safe">{s.distanceToBreakoutPct.toFixed(2)}%</div>
          </div>
        )}
      </div>

      {isActive && (
        <div className="grid grid-cols-3 gap-2 text-center text-xs rounded-xl bg-panel2 p-2">
          <div>
            <div className="text-subtext">Entry</div>
            <div className="font-semibold numeric-safe">{s.entryPrice?.toPrecision(6)}</div>
          </div>
          <div>
            <div className="text-subtext">SL</div>
            <div className="font-semibold numeric-safe text-bear">{s.stopLoss?.toPrecision(6)}</div>
          </div>
          <div>
            <div className="text-subtext">TP（1R）</div>
            <div className="font-semibold numeric-safe text-bull">{s.takeProfit?.toPrecision(6)}</div>
          </div>
        </div>
      )}

      <div className="text-[10px] text-subtext mt-2">
        更新於 {new Date(s.updatedAt).toLocaleTimeString("zh-TW")}
      </div>
    </div>
  );
}

export default function OpportunitiesPage() {
  const [signals, setSignals] = useState<LiveSignal[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    setLoading(true);
    setError(null);
    const results: LiveSignal[] = [];
    let successCount = 0;
    for (const symbol of AUDIT_SYMBOLS) {
      try {
        const candles = await fetchKlines(symbol, "5m", 288);
        successCount++;
        const signal = evaluateLiveSignal(symbol, candles, ENGINE_WINDOW, ENGINE_TP, 0.3);
        results.push(signal);
        upsertFromLiveSignal(signal, ENGINE_TP);
      } catch {
        // 這個幣種這次抓取失敗，跳過，不假造資料
      }
    }
    setLoading(false);
    if (successCount === 0) {
      setError("所有幣種的即時資料都抓取失敗，請檢查網路連線後再試一次");
      return;
    }
    setSignals(results);
  };

  useEffect(() => {
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCount = signals ? signals.filter((s) => s.state === "RETEST_CONFIRMED").length : 0;
  const staleCount = signals ? signals.filter((s) => s.state === "DATA_STALE").length : 0;

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-display font-bold tracking-tight">機會</h1>
        <button
          onClick={runCheck}
          disabled={loading}
          className="btn-primary px-3 text-xs text-subtext border border-border active:scale-95 transition"
        >
          {loading ? "檢查中" : "🔄 更新"}
        </button>
      </header>

      <div className="text-xs text-subtext mb-4 leading-relaxed">
        用回踩引擎（跟「交易」頁一鍵分析驗證過的同一套邏輯）即時檢查8個幣種現在的狀態。
      </div>

      {error && <div className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">⚠️ {error}</div>}

      {signals && (
        <div className="mb-3 text-xs text-subtext">
          {activeCount > 0 ? `${activeCount}個A級訊號` : "目前沒有A級訊號"}
          {staleCount > 0 && ` ・ ${staleCount}個幣種資料異常`}
        </div>
      )}

      {signals ? (
        signals.map((s) => <SignalDetailCard key={s.symbol} s={s} />)
      ) : (
        <div className="text-sm text-subtext text-center py-6">{loading ? "檢查中…" : "尚無資料"}</div>
      )}
    </main>
  );
}
