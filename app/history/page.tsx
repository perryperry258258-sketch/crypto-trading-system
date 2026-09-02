"use client";

import { useEffect, useState } from "react";
import { loadSignalRecords, auditSignalRecords, SignalRecord } from "@/lib/signalLog";
import { EmptyState } from "@/components/ui";

// 新增頁面（UI/UX改版規格要求的獨立「歷史」頁）。
// 純粹讀取 lib/signalLog.ts 已經存在的 Signal Record 資料來顯示，
// 沒有新增或修改任何交易判斷邏輯。

type Tab = "ALL" | "WIN" | "LOSS";

function fmtPrice(n: number) {
  return n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toPrecision(4);
}

export default function HistoryPage() {
  const [records, setRecords] = useState<SignalRecord[]>([]);
  const [tab, setTab] = useState<Tab>("ALL");

  useEffect(() => {
    setRecords(loadSignalRecords());
  }, []);

  const resolved = records.filter((r) => r.status !== "OPEN");
  const filtered =
    tab === "WIN" ? resolved.filter((r) => r.status === "WIN") : tab === "LOSS" ? resolved.filter((r) => r.status === "LOSS") : resolved;

  const report = resolved.length ? auditSignalRecords(records) : null;

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-4">
        <h1 className="text-xl font-display font-bold tracking-tight">歷史紀錄</h1>
      </header>

      {report && report.sampleCount > 0 && (
        <section className="rounded-2xl border border-border bg-panel p-4 mb-4">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <div className="text-subtext">樣本數</div>
              <div className="font-semibold numeric-safe">{report.sampleCount}</div>
            </div>
            <div>
              <div className="text-subtext">勝率</div>
              <div className="font-semibold numeric-safe">{report.winRate.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-subtext">期望值</div>
              <div className={`font-semibold numeric-safe ${report.expectancy >= 0 ? "text-bull" : "text-bear"}`}>
                {report.expectancy >= 0 ? "+" : ""}
                {report.expectancy.toFixed(2)}R
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 篩選分頁 */}
      <div className="flex gap-2 mb-4">
        {[
          { key: "ALL" as Tab, label: "全部" },
          { key: "WIN" as Tab, label: "獲利" },
          { key: "LOSS" as Tab, label: "虧損" },
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

      {filtered.length === 0 ? (
        <EmptyState text="尚無交易紀錄" sub="出現A級訊號並走完完整流程後會自動記錄在這裡" />
      ) : (
        <div className="space-y-2">
          {[...filtered]
            .sort((a, b) => b.refTime - a.refTime)
            .map((r) => (
              <div key={r.id} className="rounded-xl bg-panel2 p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-semibold">
                    {r.symbol.replace("USDT", "")} <span className="text-subtext text-xs font-normal">/ USDT</span>
                    <span className={`ml-2 text-xs ${r.direction === "LONG" ? "text-bull" : "text-bear"}`}>
                      {r.direction === "LONG" ? "做多" : "做空"}
                    </span>
                  </div>
                  <span className={`text-sm font-semibold numeric-safe ${(r.rMultiple ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                    {r.rMultiple != null ? `${r.rMultiple >= 0 ? "+" : ""}${r.rMultiple.toFixed(2)}R` : "—"}
                  </span>
                </div>
                <div className="text-xs text-subtext">
                  進場 {fmtPrice(r.entryPrice)} → 止盈 {fmtPrice(r.takeProfit)}
                </div>
                <div className="text-[10px] text-subtext mt-1">
                  {new Date(r.refTime * 1000).toLocaleString("zh-TW", { hour12: false })}
                </div>
              </div>
            ))}
        </div>
      )}
    </main>
  );
}
