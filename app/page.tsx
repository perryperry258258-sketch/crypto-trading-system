"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useMarketData } from "@/lib/useMarketData";
import { fetchKlines } from "@/lib/binance";
import { evaluateLiveSignal, LiveSignal } from "@/lib/retestEngine";
import { upsertFromLiveSignal, loadSignalRecords, loadOosSummary, OosSummary } from "@/lib/signalLog";
import {
  getNotificationPermission,
  requestNotificationPermission,
  showNotification,
  NotificationPermissionStatus,
} from "@/lib/notifications";
import { Card, SignalCard, EmptyState, StatusDot } from "@/components/ui";

// ============================================================
// UI/UX 改版：這個檔案只改視覺呈現，資料來源、抓取邏輯、A級訊號判斷
// （evaluateLiveSignal）、Signal Record 寫入（upsertFromLiveSignal）全部
// 沿用不變，跟改版前完全一樣的函式呼叫。
// ============================================================

function fmt(n: number) {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

const statusBadge: Record<string, { label: string; color: "green" | "yellow" | "red" }> = {
  LIVE: { label: "即時", color: "green" },
  CONNECTING: { label: "連線中", color: "yellow" },
  DELAYED: { label: "延遲", color: "yellow" },
  ERROR: { label: "資料異常", color: "red" },
};

const AUDIT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT"];
const ENGINE_WINDOW = 60;
const ENGINE_TP = 1;

const OOS_VERDICT_INFO: Record<OosSummary["verdict"], { color: "green" | "yellow" | "red"; label: string }> = {
  PASSED: { color: "green", label: "已通過樣本外驗證" },
  INSUFFICIENT: { color: "yellow", label: "樣本不足" },
  FAILED: { color: "red", label: "未通過樣本外驗證" },
};

export default function Home() {
  const { capital, capitalState, btc, eth, errors, loading, reload, lastUpdated, connectionStatus } = useMarketData();

  const status = statusBadge[connectionStatus];

  const [engineSignals, setEngineSignals] = useState<LiveSignal[] | null>(null);
  const [engineLoading, setEngineLoading] = useState(false);
  const [oosSummary, setOosSummary] = useState<OosSummary | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermissionStatus>("default");

  const checkEngine = async () => {
    setEngineLoading(true);
    const beforeRecords = loadSignalRecords();
    const beforeOpenIds = new Set(beforeRecords.filter((r) => r.status === "OPEN").map((r) => r.id));

    const results: LiveSignal[] = [];
    for (const symbol of AUDIT_SYMBOLS) {
      try {
        const candles = await fetchKlines(symbol, "5m", 288);
        const signal = evaluateLiveSignal(symbol, candles, ENGINE_WINDOW, ENGINE_TP, 0.3);
        results.push(signal);
        upsertFromLiveSignal(signal, ENGINE_TP);
      } catch {
        // 這個幣種這次抓取失敗，跳過，不假造資料
      }
    }
    setEngineLoading(false);
    setEngineSignals(results);

    const afterRecords = loadSignalRecords();
    const newlyOpen = afterRecords.filter((r) => r.status === "OPEN" && !beforeOpenIds.has(r.id));
    newlyOpen.forEach((r) => {
      showNotification(
        `A級進場訊號：${r.symbol.replace("USDT", "")} ${r.direction === "LONG" ? "做多" : "做空"}`,
        `進場 ${r.entryPrice.toPrecision(6)} ・ 止損 ${r.stopLoss.toPrecision(6)} ・ 止盈 ${r.takeProfit.toPrecision(6)}`,
        r.id
      );
    });
  };

  useEffect(() => {
    setOosSummary(loadOosSummary());
    setNotifPermission(getNotificationPermission());
    checkEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSignals = engineSignals ? engineSignals.filter((s) => s.state === "RETEST_CONFIRMED") : [];

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    setNotifPermission(result);
  };

  const handleRefresh = () => {
    reload();
    checkEngine();
    setOosSummary(loadOosSummary());
  };

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      {/* 頂部品牌列 */}
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl font-display font-bold tracking-tight">A Signal</span>
          <StatusDot color={status.color} label={status.label} />
        </div>
        <button
          onClick={handleRefresh}
          aria-label="更新"
          className="w-9 h-9 rounded-full flex items-center justify-center border border-border active:scale-90 transition text-subtext"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading || engineLoading ? "animate-spin" : ""}>
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </header>

      {errors.length > 0 && (
        <div className="mb-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn space-y-0.5">
          {errors.map((e, i) => (
            <div key={i} className="break-words">
              {e}
            </div>
          ))}
        </div>
      )}

      {/* 1. A級機會 — 最重要的視覺焦點 */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold">A級機會</span>
          {engineLoading && <span className="text-[10px] text-subtext">檢查中…</span>}
        </div>
        {activeSignals.length > 0 ? (
          activeSignals.map((s) => <SignalCard key={s.symbol} s={s} />)
        ) : (
          <EmptyState text="目前沒有A級機會" sub="系統持續監控中" />
        )}
      </Card>

      {/* 2. 即時價格 */}
      <Card>
        <div className="text-xs text-subtext mb-2">即時價格</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-panel2 p-3 min-w-0">
            <div className="text-xs text-subtext mb-0.5">BTC</div>
            <div className="text-base font-semibold numeric-safe truncate">{btc ? `$${fmt(btc.price)}` : "—"}</div>
            {btc && (
              <div className={`text-xs ${btc.change24h >= 0 ? "text-bull" : "text-bear"}`}>
                {btc.change24h >= 0 ? "+" : ""}
                {btc.change24h.toFixed(1)}%
              </div>
            )}
          </div>
          <div className="rounded-xl bg-panel2 p-3 min-w-0">
            <div className="text-xs text-subtext mb-0.5">ETH</div>
            <div className="text-base font-semibold numeric-safe truncate">{eth ? `$${fmt(eth.price)}` : "—"}</div>
            {eth && (
              <div className={`text-xs ${eth.change24h >= 0 ? "text-bull" : "text-bear"}`}>
                {eth.change24h >= 0 ? "+" : ""}
                {eth.change24h.toFixed(1)}%
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* 3. 策略狀態 */}
      <Card>
        <div className="text-xs text-subtext mb-2">策略狀態</div>
        {oosSummary ? (
          <div>
            <div className="mb-3">
              <StatusDot color={OOS_VERDICT_INFO[oosSummary.verdict].color} label={OOS_VERDICT_INFO[oosSummary.verdict].label} size="md" />
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div>
                <div className="text-subtext">樣本</div>
                <div className="font-semibold numeric-safe">{oosSummary.sampleCount}</div>
              </div>
              <div>
                <div className="text-subtext">勝率</div>
                <div className="font-semibold numeric-safe">{oosSummary.winRate.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-subtext">期望值</div>
                <div className={`font-semibold numeric-safe ${oosSummary.expectancy >= 0 ? "text-bull" : "text-bear"}`}>
                  {oosSummary.expectancy >= 0 ? "+" : ""}
                  {oosSummary.expectancy.toFixed(2)}R
                </div>
              </div>
              <div>
                <div className="text-subtext">最大回撤</div>
                <div className="font-semibold numeric-safe text-bear">-{oosSummary.maxDrawdownR.toFixed(2)}R</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-subtext">尚未驗證，去「查看完整驗證數據」跑一次分析。</div>
        )}
        <Link href="/journal" className="text-xs text-bull mt-3 inline-block">
          查看完整驗證數據 →
        </Link>
        {notifPermission !== "granted" && notifPermission !== "unsupported" && (
          <button onClick={handleEnableNotifications} className="btn-primary w-full border border-border bg-panel2 text-xs mt-3">
            開啟A級訊號通知
          </button>
        )}
      </Card>

      {/* 4. 我的資金 */}
      <Card>
        <div className="text-xs text-subtext mb-2">我的資金</div>
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
          <div className="h-full bg-brand" style={{ width: `${capitalState.progressPct}%` }} />
        </div>
      </Card>

      <footer className="text-center text-[11px] text-subtext pb-4">
        {lastUpdated ? `更新時間：${lastUpdated.toLocaleString()}` : "尚未更新"}
        <div className="mt-2 leading-relaxed opacity-70">本系統僅供決策參考，不構成投資建議，不保證獲利。</div>
      </footer>
    </main>
  );
}
