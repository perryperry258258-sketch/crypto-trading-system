"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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
import { Card, SignalCard, EmptyState, StatusDot, MarketMiniTable, sortByRecency } from "@/components/ui";

// ============================================================
// UI/UX 最終整理：這個檔案只改視覺呈現與版面結構，資料來源、抓取邏輯、
// A級訊號判斷（evaluateLiveSignal）、Signal Record 寫入（upsertFromLiveSignal）
// 全部沿用不變，跟改版前完全一樣的函式呼叫，沒有新增或修改任何交易邏輯。
// ============================================================

const AUDIT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT"];
const ENGINE_WINDOW = 60;
const ENGINE_TP = 1;

const OOS_VERDICT_INFO: Record<OosSummary["verdict"], { color: "green" | "yellow" | "red"; label: string }> = {
  PASSED: { color: "green", label: "已通過樣本外驗證" },
  INSUFFICIENT: { color: "yellow", label: "樣本不足" },
  FAILED: { color: "red", label: "未通過樣本外驗證" },
};

function computeSystemStatus(
  connectionStatus: string,
  signals: LiveSignal[] | null,
  stillLoading: boolean
): { color: "green" | "yellow" | "red"; label: string } {
  const staleCount = signals ? signals.filter((s) => s.state === "DATA_STALE").length : 0;
  if (connectionStatus === "ERROR" || (signals != null && signals.length > 0 && staleCount === signals.length)) {
    return { color: "red", label: "資料異常" };
  }
  if (stillLoading || connectionStatus !== "LIVE" || staleCount > 0) {
    return { color: "yellow", label: "等待訊號" };
  }
  return { color: "green", label: "即時監控中" };
}

export default function Home() {
  const { coins, connectionStatus, loading, reload } = useMarketData();

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
        `進場價 ${r.entryPrice.toPrecision(6)} ・ 止損 ${r.stopLoss.toPrecision(6)} ・ 止盈 ${r.takeProfit.toPrecision(6)}`,
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

  const activeSignals = sortByRecency(engineSignals ? engineSignals.filter((s) => s.state === "RETEST_CONFIRMED") : []);
  const signalsMap: Record<string, LiveSignal> = {};
  (engineSignals ?? []).forEach((s) => (signalsMap[s.symbol] = s));

  const systemStatus = computeSystemStatus(connectionStatus, engineSignals, engineLoading && !engineSignals);

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
      <header className="mb-3 flex items-center justify-between">
        <span className="text-xl font-display font-bold tracking-tight">A Signal</span>
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

      {/* 第一區：系統狀態 */}
      <Card className="!py-3">
        <StatusDot color={systemStatus.color} label={systemStatus.label} size="md" />
      </Card>

      {/* 第二區：目前交易機會 — 全App最重要的視覺焦點 */}
      <Card>
        <div className="text-xs text-subtext mb-2">目前交易機會</div>
        {activeSignals.length > 0 ? (
          activeSignals.map((s) => (
            <SignalCard
              key={s.symbol}
              s={s}
              stats={oosSummary ? { winRate: oosSummary.winRate, expectancy: oosSummary.expectancy } : undefined}
            />
          ))
        ) : (
          <EmptyState text="目前沒有符合條件的A級訊號" sub="系統持續監控中" />
        )}
      </Card>

      {/* 第三區：策略狀態 */}
      <Card>
        <div className="text-xs text-subtext mb-2">策略狀態</div>
        {oosSummary ? (
          <div>
            <div className="mb-3">
              <StatusDot color={OOS_VERDICT_INFO[oosSummary.verdict].color} label={OOS_VERDICT_INFO[oosSummary.verdict].label} size="md" />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <div className="text-subtext">勝率</div>
                <div className="font-semibold numeric-safe text-sm">{oosSummary.winRate.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-subtext">期望值</div>
                <div className={`font-semibold numeric-safe text-sm ${oosSummary.expectancy >= 0 ? "text-bull" : "text-bear"}`}>
                  {oosSummary.expectancy >= 0 ? "+" : ""}
                  {oosSummary.expectancy.toFixed(2)}R
                </div>
              </div>
              <div>
                <div className="text-subtext">最大回撤</div>
                <div className="font-semibold numeric-safe text-sm text-bear">-{oosSummary.maxDrawdownR.toFixed(2)}R</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-subtext">尚未驗證，前往「查看完整驗證」跑一次分析。</div>
        )}
        <Link href="/journal" className="text-xs text-bull mt-3 inline-block">
          查看完整驗證 →
        </Link>
      </Card>

      {/* 第四區：即時市場 */}
      <Card>
        <div className="text-xs text-subtext mb-2">即時市場</div>
        <MarketMiniTable symbols={AUDIT_SYMBOLS} coins={coins} signals={signalsMap} />
        <Link href="/market" className="text-xs text-bull mt-3 inline-block">
          查看市場詳細資料 →
        </Link>
      </Card>

      {notifPermission !== "granted" && notifPermission !== "unsupported" && (
        <button onClick={handleEnableNotifications} className="btn-primary w-full border border-border bg-panel2 text-xs mb-3">
          開啟A級訊號通知
        </button>
      )}

      <footer className="text-center text-[11px] text-subtext pb-4 opacity-70">
        本系統僅供決策參考，不構成投資建議，不保證獲利。
      </footer>
    </main>
  );
}
