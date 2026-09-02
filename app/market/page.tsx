"use client";

import { useEffect, useState } from "react";
import { useMarketData } from "@/lib/useMarketData";
import { getETInfo } from "@/lib/openRangeLab";
import { loadSignalRecords, auditSignalRecords, SignalRecord } from "@/lib/signalLog";

// 市場頁：中性市場資料（BTC/ETH/大盤/恐慌貪婪）＋美股開盤時段狀態＋回踩引擎歷史訊號紀錄。
// 舊系統的技術指標大盤判斷（regime）已經整套移除。

function fmt(n: number) {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

type SessionState = "WEEKEND" | "BEFORE_OPEN" | "MARKET_HOURS" | "AFTER_CLOSE";

function getSessionStatus(): { state: SessionState; label: string; note: string } {
  const info = getETInfo(Date.now() / 1000);
  const weekday = info.weekday;
  const minutesNow = info.hour * 60 + info.minute;
  const openMinutes = 9 * 60 + 30;
  const closeMinutes = 16 * 60;

  if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday)) {
    return { state: "WEEKEND", label: "⚪ 非交易日", note: "美股週末休市，回踩引擎不會產生新訊號。" };
  }
  if (minutesNow < openMinutes) {
    return {
      state: "BEFORE_OPEN",
      label: "🟡 尚未開盤",
      note: `美東時間現在 ${String(info.hour).padStart(2, "0")}:${String(info.minute).padStart(2, "0")}，等待09:30開盤。`,
    };
  }
  if (minutesNow < closeMinutes) {
    return { state: "MARKET_HOURS", label: "🟢 交易時段中", note: "美股盤中，回踩引擎正在運作。" };
  }
  return { state: "AFTER_CLOSE", label: "⚪ 已收盤", note: "美股已收盤，等待下一個交易日09:30開盤。" };
}

export default function MarketPage() {
  const { btc, eth, global, fearGreed, loading, reload, errors, lastUpdated } = useMarketData();
  const [session, setSession] = useState(getSessionStatus());
  const [records, setRecords] = useState<SignalRecord[]>([]);

  useEffect(() => {
    setSession(getSessionStatus());
    const id = setInterval(() => setSession(getSessionStatus()), 30_000);
    setRecords(loadSignalRecords());
    return () => clearInterval(id);
  }, []);

  const report = records.length ? auditSignalRecords(records) : null;
  const winCount = records.filter((r) => r.status === "WIN").length;
  const lossCount = records.filter((r) => r.status === "LOSS").length;
  const expiredCount = records.filter((r) => r.status === "EXPIRED").length;
  const openCount = records.filter((r) => r.status === "OPEN").length;

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-display font-bold tracking-tight">市場</h1>
        <button
          onClick={reload}
          className="btn-primary px-3 text-xs text-subtext border border-border active:scale-95 transition"
        >
          {loading ? "更新中" : "🔄 更新"}
        </button>
      </header>

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

      {/* 美股開盤時段狀態 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-xs text-subtext mb-1">美股開盤時段</div>
        <div className="text-xl font-display font-bold mb-1">{session.label}</div>
        <div className="text-sm text-subtext break-words">{session.note}</div>
      </section>

      {/* BTC/ETH 即時價格 */}
      {[btc, eth].map(
        (c) =>
          c && (
            <section key={c.id} className="rounded-2xl border border-border bg-panel p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg font-display font-bold">{c.symbol}</span>
                <span className="text-lg font-semibold numeric-safe">${fmt(c.price)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <div className="text-subtext mb-0.5">24H</div>
                  <div className={`font-semibold numeric-safe ${c.change24h >= 0 ? "text-bull" : "text-bear"}`}>
                    {c.change24h >= 0 ? "+" : ""}
                    {c.change24h.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-subtext mb-0.5">24H高</div>
                  <div className="font-semibold numeric-safe">${fmt(c.high24h)}</div>
                </div>
                <div>
                  <div className="text-subtext mb-0.5">24H低</div>
                  <div className="font-semibold numeric-safe">${fmt(c.low24h)}</div>
                </div>
              </div>
            </section>
          )
      )}

      {/* 大盤數據（中性參考資料） */}
      {global && (
        <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
          <div className="text-xs text-subtext mb-2">大盤數據</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-panel2 p-3">
              <div className="text-xs text-subtext mb-0.5">BTC 市占率（Dominance）</div>
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
              <div className="font-semibold numeric-safe">
                {fearGreed ? `${fearGreed.value} (${fearGreed.classification})` : "—"}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 回踩引擎歷史訊號紀錄總覽 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-xs text-subtext mb-2">回踩引擎歷史訊號（本機紀錄）</div>
        {records.length === 0 ? (
          <div className="text-sm text-subtext text-center py-3">尚無訊號紀錄，去「機會」頁或首頁檢查一次即時狀態就會開始累積。</div>
        ) : (
          <div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs mb-3">
              <div>
                <div className="text-subtext">進行中</div>
                <div className="font-semibold numeric-safe">{openCount}</div>
              </div>
              <div>
                <div className="text-subtext">達標</div>
                <div className="font-semibold numeric-safe text-bull">{winCount}</div>
              </div>
              <div>
                <div className="text-subtext">停損</div>
                <div className="font-semibold numeric-safe text-bear">{lossCount}</div>
              </div>
              <div>
                <div className="text-subtext">過期</div>
                <div className="font-semibold numeric-safe">{expiredCount}</div>
              </div>
            </div>
            {report && report.sampleCount > 0 && (
              <div className="grid grid-cols-2 gap-2 text-center text-xs mb-3">
                <div className="rounded-xl bg-panel2 p-2">
                  <div className="text-subtext">勝率</div>
                  <div className="font-semibold numeric-safe">{report.winRate.toFixed(1)}%</div>
                </div>
                <div className="rounded-xl bg-panel2 p-2">
                  <div className="text-subtext">期望值</div>
                  <div className={`font-semibold numeric-safe ${report.expectancy >= 0 ? "text-bull" : "text-bear"}`}>
                    {report.expectancy >= 0 ? "+" : ""}
                    {report.expectancy.toFixed(2)}R
                  </div>
                </div>
              </div>
            )}
            <details>
              <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                最近紀錄（共{records.length}筆）▾
              </summary>
              <div className="space-y-1.5">
                {[...records]
                  .reverse()
                  .slice(0, 20)
                  .map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-xs rounded-lg bg-panel2 px-3 py-2">
                      <span className="font-medium w-14 shrink-0">{r.symbol.replace("USDT", "")}</span>
                      <span
                        className={
                          r.status === "WIN" ? "text-bull" : r.status === "LOSS" ? "text-bear" : "text-subtext"
                        }
                      >
                        {r.status}
                      </span>
                      <span className="numeric-safe">
                        {r.rMultiple != null ? `${r.rMultiple >= 0 ? "+" : ""}${r.rMultiple.toFixed(2)}R` : "—"}
                      </span>
                      <span className="text-subtext">{new Date(r.refTime * 1000).toLocaleDateString("zh-TW")}</span>
                    </div>
                  ))}
              </div>
            </details>
          </div>
        )}
      </section>

      <footer className="text-center text-[11px] text-subtext pb-6">
        {lastUpdated ? `更新時間：${lastUpdated.toLocaleString()}` : "尚未更新"}
      </footer>
    </main>
  );
}
