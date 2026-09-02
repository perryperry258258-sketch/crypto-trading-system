"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useMarketData } from "@/lib/useMarketData";
import { fetchKlines } from "@/lib/binance";
import { evaluateLiveSignal, STATE_INFO, LiveSignal } from "@/lib/retestEngine";
import { upsertFromLiveSignal, loadSignalRecords, loadOosSummary, OosSummary } from "@/lib/signalLog";
import {
  getNotificationPermission,
  requestNotificationPermission,
  showNotification,
  NotificationPermissionStatus,
} from "@/lib/notifications";

function fmt(n: number) {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

const statusBadge: Record<string, { label: string; className: string }> = {
  LIVE: { label: "🟢 即時（Live）", className: "text-bull" },
  CONNECTING: { label: "🟡 連線中", className: "text-warn" },
  DELAYED: { label: "🟡 延遲（Delayed）", className: "text-warn" },
  ERROR: { label: "🔴 資料異常（Data Error）", className: "text-bear" },
};

const AUDIT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT"];
const ENGINE_WINDOW = 60; // 沿用「交易」頁一鍵分析預設的觀察窗口
const ENGINE_TP = 1; // 暫定正式版本 TP=1R

const OOS_VERDICT_INFO: Record<OosSummary["verdict"], { emoji: string; label: string }> = {
  PASSED: { emoji: "🟢", label: "已通過樣本外驗證" },
  INSUFFICIENT: { emoji: "🟡", label: "樣本不足" },
  FAILED: { emoji: "🔴", label: "未通過樣本外驗證" },
};

// 今日結論：完全依回踩引擎的即時狀態判斷，不再用舊Opportunity Score系統的燈號邏輯。
function computeVerdict(
  signals: LiveSignal[] | null,
  loading: boolean
): { label: string; headline: string; className: string } {
  if (loading && !signals) {
    return { label: "檢查中…", headline: "正在檢查8個幣種的即時訊號狀態。", className: "bg-panel border-border" };
  }
  if (!signals) {
    return { label: "⚪ 尚未檢查", headline: "還沒有即時訊號資料。", className: "bg-panel border-border" };
  }
  const staleCount = signals.filter((s) => s.state === "DATA_STALE").length;
  if (staleCount === signals.length) {
    return {
      label: "🔴 資料異常",
      headline: "所有幣種的資料都延遲或異常，暫停訊號判斷，不要交易。",
      className: "bg-bear/10 border-bear/30",
    };
  }
  const active = signals.filter((s) => s.state === "RETEST_CONFIRMED");
  if (active.length > 0) {
    return {
      label: "🟢 有A級機會",
      headline: `${active.length}個幣種出現符合完整條件的回踩進場訊號，往下看詳細內容。`,
      className: "bg-bull/10 border-bull/30",
    };
  }
  return {
    label: "⚪ 目前沒有機會",
    headline: "目前沒有符合條件的交易，不交易，繼續觀察。",
    className: "bg-panel border-border",
  };
}

export default function Home() {
  const { capital, capitalState, btc, eth, errors, loading, reload, lastUpdated, connectionStatus } = useMarketData();

  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const status = statusBadge[connectionStatus];

  // 回踩策略即時訊號（Part 14）：跟「交易」頁的即時訊號監控用完全相同的引擎（retestEngine.ts），
  // 首頁進來時自動檢查一次，不用手動按按鈕。
  const [engineSignals, setEngineSignals] = useState<LiveSignal[] | null>(null);
  const [engineLoading, setEngineLoading] = useState(false);
  const [oosSummary, setOosSummary] = useState<OosSummary | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermissionStatus>("default");

  useEffect(() => {
    setOosSummary(loadOosSummary());
    setNotifPermission(getNotificationPermission());

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

      // Part 11 推播：只在「第一次」看到某個訊號進入 RETEST_CONFIRMED 時通知一次，
      // 不會每次刷新都重複通知同一個訊號。
      const afterRecords = loadSignalRecords();
      const newlyOpen = afterRecords.filter((r) => r.status === "OPEN" && !beforeOpenIds.has(r.id));
      newlyOpen.forEach((r) => {
        showNotification(
          `🟢 A級進場訊號：${r.symbol.replace("USDT", "")} ${r.direction === "LONG" ? "做多" : "做空"}`,
          `進場 ${r.entryPrice.toPrecision(6)} ・ SL ${r.stopLoss.toPrecision(6)} ・ TP ${r.takeProfit.toPrecision(6)}`,
          r.id
        );
      });
    };
    checkEngine();
  }, []);

  const activeSignals = engineSignals ? engineSignals.filter((s) => s.state === "RETEST_CONFIRMED") : [];
  const verdict = computeVerdict(engineSignals, engineLoading);

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    setNotifPermission(result);
  };

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

      {/* 1. 今日要不要交易 — 最優先，由回踩引擎即時狀態決定 */}
      <section className={`rounded-2xl border p-4 mb-3 ${verdict.className}`}>
        <div className="text-xs text-subtext mb-1">今日結論</div>
        <div className="text-2xl font-display font-bold mb-1">{verdict.label}</div>
        <div className="text-sm leading-relaxed break-words">{verdict.headline}</div>
      </section>

      {/* 2. BTC / ETH 即時價格 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-xs text-subtext mb-2">即時價格</div>
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

      {/* 3. A級機會（回踩策略即時訊號，Part 14） */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-subtext">🎯 A級機會</div>
          {engineLoading && <div className="text-[10px] text-subtext">檢查中…</div>}
        </div>
        {activeSignals.length > 0 ? (
          <div className="space-y-2">
            {activeSignals.map((s) => (
              <div key={s.symbol} className="rounded-xl bg-bull/10 border border-bull/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg font-display font-bold">
                    {s.symbol.replace("USDT", "")} {s.direction === "LONG" ? "做多" : "做空"}
                  </span>
                  <span className="text-sm font-semibold text-bull">現在可以進場</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
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
                <div className="text-[10px] text-subtext mt-2">
                  訊號時間：{s.signalTime ? new Date(s.signalTime * 1000).toLocaleString("zh-TW") : "—"}
                </div>
              </div>
            ))}
          </div>
        ) : !engineLoading ? (
          <div className="text-sm text-subtext text-center py-3">目前沒有A級交易，不交易。</div>
        ) : null}
        <Link href="/opportunities" className="btn-primary w-full border border-border bg-panel2 text-sm mt-3">
          查看全部8個幣種狀態
        </Link>
      </section>

      {/* 3b. 策略驗證狀態（Part 15） */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-xs text-subtext mb-2">策略驗證狀態</div>
        {oosSummary ? (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{OOS_VERDICT_INFO[oosSummary.verdict].emoji}</span>
              <span className="text-sm font-semibold">{OOS_VERDICT_INFO[oosSummary.verdict].label}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <div className="text-subtext">OOS樣本數</div>
                <div className="font-semibold numeric-safe">{oosSummary.sampleCount}</div>
              </div>
              <div>
                <div className="text-subtext">OOS勝率</div>
                <div className="font-semibold numeric-safe">{oosSummary.winRate.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-subtext">OOS期望值</div>
                <div className={`font-semibold numeric-safe ${oosSummary.expectancy >= 0 ? "text-bull" : "text-bear"}`}>
                  {oosSummary.expectancy >= 0 ? "+" : ""}
                  {oosSummary.expectancy.toFixed(2)}R
                </div>
              </div>
              <div>
                <div className="text-subtext">OOS PF</div>
                <div className="font-semibold numeric-safe">
                  {oosSummary.profitFactor === Infinity ? "∞" : oosSummary.profitFactor.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-subtext">OOS最大回撤</div>
                <div className="font-semibold numeric-safe text-bear">-{oosSummary.maxDrawdownR.toFixed(2)}R</div>
              </div>
              <div>
                <div className="text-subtext">驗證時間</div>
                <div className="font-semibold text-[10px] pt-1">
                  {new Date(oosSummary.computedAt).toLocaleDateString("zh-TW")}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-subtext">
            🔴 尚未驗證——去「交易」頁跑一次「一鍵執行完整分析」才會有樣本外驗證結果。
          </div>
        )}
        {notifPermission !== "granted" && notifPermission !== "unsupported" && (
          <button
            onClick={handleEnableNotifications}
            className="btn-primary w-full border border-border bg-panel2 text-xs mt-3"
          >
            🔔 開啟A級訊號推播通知
          </button>
        )}
      </section>

      {/* 4. 我的資金 */}
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

      {/* 5. 詳細資料 */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Link href="/market" className="btn-primary border border-border bg-panel text-sm">
          市場與訊號紀錄
        </Link>
        <Link href="/opportunities" className="btn-primary border border-border bg-panel text-sm">
          全部即時狀態
        </Link>
      </div>

      <footer className="text-center text-[11px] text-subtext pb-4">
        {lastUpdated ? `更新時間：${lastUpdated.toLocaleString()}` : "尚未更新"}
        <div className="mt-2 leading-relaxed opacity-70">本系統僅供決策參考，不構成投資建議，不保證獲利。</div>
      </footer>
    </main>
  );
}
