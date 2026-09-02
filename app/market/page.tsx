"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMarketData } from "@/lib/useMarketData";
import { fetchKlines } from "@/lib/binance";
import { evaluateLiveSignal, LiveSignal } from "@/lib/retestEngine";
import { getETInfo } from "@/lib/openRangeLab";
import { upsertFromLiveSignal } from "@/lib/signalLog";
import { StatusDot } from "@/components/ui";
import { SIGNAL_STATE_THEME } from "@/components/statusTheme";

// UI/UX改版：市場頁改成乾淨的8幣種表格，大盤數據收進可折疊區塊，
// 訊號紀錄移到新的「歷史」頁。抓取/判斷邏輯完全不變。

function fmt(n: number) {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

const AUDIT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT"];
const ENGINE_WINDOW = 60;
const ENGINE_TP = 1;

type SessionState = "WEEKEND" | "BEFORE_OPEN" | "MARKET_HOURS" | "AFTER_CLOSE";

function getSessionStatus(): { state: SessionState; label: string; color: "green" | "yellow" | "grey"; note: string } {
  const info = getETInfo(Date.now() / 1000);
  const weekday = info.weekday;
  const minutesNow = info.hour * 60 + info.minute;
  const openMinutes = 9 * 60 + 30;
  const closeMinutes = 16 * 60;

  if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday)) {
    return { state: "WEEKEND", label: "非交易日", color: "grey", note: "美股週末休市，回踩引擎不會產生新訊號。" };
  }
  if (minutesNow < openMinutes) {
    return {
      state: "BEFORE_OPEN",
      label: "尚未開盤",
      color: "yellow",
      note: `美東時間現在 ${String(info.hour).padStart(2, "0")}:${String(info.minute).padStart(2, "0")}，等待09:30開盤。`,
    };
  }
  if (minutesNow < closeMinutes) {
    return { state: "MARKET_HOURS", label: "交易時段中", color: "green", note: "美股盤中，回踩引擎正在運作。" };
  }
  return { state: "AFTER_CLOSE", label: "已收盤", color: "grey", note: "美股已收盤，等待下一個交易日09:30開盤。" };
}

export default function MarketPage() {
  const { coins, global, fearGreed, loading, reload, errors } = useMarketData();
  const [session, setSession] = useState(getSessionStatus());
  const [signals, setSignals] = useState<Record<string, LiveSignal>>({});
  const [signalsLoading, setSignalsLoading] = useState(false);

  const runCheck = async () => {
    setSignalsLoading(true);
    const map: Record<string, LiveSignal> = {};
    for (const symbol of AUDIT_SYMBOLS) {
      try {
        const candles = await fetchKlines(symbol, "5m", 288);
        const signal = evaluateLiveSignal(symbol, candles, ENGINE_WINDOW, ENGINE_TP, 0.3);
        map[symbol] = signal;
        upsertFromLiveSignal(signal, ENGINE_TP);
      } catch {
        // 跳過失敗的幣種
      }
    }
    setSignalsLoading(false);
    setSignals(map);
  };

  useEffect(() => {
    setSession(getSessionStatus());
    const id = setInterval(() => setSession(getSessionStatus()), 30_000);
    runCheck();
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = () => {
    reload();
    runCheck();
  };

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-display font-bold tracking-tight">市場監控</h1>
        <button
          onClick={handleRefresh}
          className="w-9 h-9 rounded-full flex items-center justify-center border border-border active:scale-90 transition text-subtext"
          aria-label="更新"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading || signalsLoading ? "animate-spin" : ""}>
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </header>

      {errors.length > 0 && (
        <div className="mb-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn space-y-0.5">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      {/* 美股開盤時段狀態 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-xs text-subtext mb-2">美股開盤時段</div>
        <StatusDot color={session.color} label={session.label} size="md" />
        <div className="text-xs text-subtext mt-2 break-words">{session.note}</div>
      </section>

      {/* 8幣種表格 */}
      <section className="rounded-2xl border border-border bg-panel overflow-hidden mb-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-subtext border-b border-border">
              <th className="text-left font-normal py-2.5 px-3">幣種</th>
              <th className="text-right font-normal py-2.5 px-3">價格</th>
              <th className="text-right font-normal py-2.5 px-3">24H</th>
              <th className="text-right font-normal py-2.5 px-3">狀態</th>
            </tr>
          </thead>
          <tbody>
            {AUDIT_SYMBOLS.map((symbol) => {
              const coin = coins.find((c) => c.id === symbol);
              const signal = signals[symbol];
              const theme = signal ? SIGNAL_STATE_THEME[signal.state] : null;
              return (
                <tr key={symbol} className="border-b border-border last:border-0">
                  <td className="py-2.5 px-3 font-medium">{symbol.replace("USDT", "")}</td>
                  <td className="text-right py-2.5 px-3 numeric-safe">{coin ? fmt(coin.price) : "—"}</td>
                  <td className={`text-right py-2.5 px-3 numeric-safe ${coin && coin.change24h >= 0 ? "text-bull" : "text-bear"}`}>
                    {coin ? `${coin.change24h >= 0 ? "+" : ""}${coin.change24h.toFixed(1)}%` : "—"}
                  </td>
                  <td className="text-right py-2.5 px-3">
                    {theme ? <StatusDot color={theme.color} label={theme.label} /> : <span className="text-subtext text-xs">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* 大盤數據（折疊，中性參考資料） */}
      <details className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <summary className="text-xs text-subtext cursor-pointer select-none">大盤數據 ▾</summary>
        {global && (
          <div className="grid grid-cols-2 gap-2 text-sm mt-3">
            <div className="rounded-xl bg-panel2 p-3">
              <div className="text-xs text-subtext mb-0.5">BTC 市占率</div>
              <div className="font-semibold numeric-safe">{global.btcDominance.toFixed(1)}%</div>
            </div>
            <div className="rounded-xl bg-panel2 p-3">
              <div className="text-xs text-subtext mb-0.5">總市值 24H</div>
              <div className={`font-semibold numeric-safe ${global.marketCapChange24h >= 0 ? "text-bull" : "text-bear"}`}>
                {global.marketCapChange24h >= 0 ? "+" : ""}
                {global.marketCapChange24h.toFixed(1)}%
              </div>
            </div>
            <div className="rounded-xl bg-panel2 p-3 col-span-2">
              <div className="text-xs text-subtext mb-0.5">恐慌貪婪指數</div>
              <div className="font-semibold numeric-safe">{fearGreed ? `${fearGreed.value}（${fearGreed.classification}）` : "—"}</div>
            </div>
          </div>
        )}
      </details>

      <Link href="/history" className="text-xs text-bull inline-block px-1">
        查看歷史訊號紀錄 →
      </Link>
    </main>
  );
}
