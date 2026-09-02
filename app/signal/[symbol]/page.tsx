"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchKlines } from "@/lib/binance";
import { evaluateLiveSignal, LiveSignal } from "@/lib/retestEngine";
import { upsertFromLiveSignal } from "@/lib/signalLog";
import { StatusDot } from "@/components/ui";
import { SIGNAL_STATE_THEME } from "@/components/statusTheme";

// 新增頁面：訊號詳情（UI/UX改版規格要求）。用「進度流程」呈現目前走到哪一步，
// 取代大量文字。資料來源完全沿用 evaluateLiveSignal，沒有新增任何判斷邏輯，
// 這裡只是把同一個LiveSignal物件拆解成流程步驟來顯示。

const ENGINE_WINDOW = 60;
const ENGINE_TP = 1;

function fmtPrice(n: number | null) {
  if (n == null) return "—";
  return n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toPrecision(6);
}
function fmtTime(t: number | null) {
  if (!t) return "—";
  return new Date(t * 1000).toLocaleTimeString("zh-TW", { hour12: false });
}

type StepStatus = "done" | "current" | "pending";

function computeSteps(s: LiveSignal): { label: string; status: StepStatus; time: number | null }[] {
  const windowDone = s.refHigh != null;
  const breakoutDone = s.breakoutTime != null;
  const retestDone = s.retestTime != null;
  const entryReached = ["RETEST_CONFIRMED", "TP_HIT", "SL_HIT"].includes(s.state);

  const step = (done: boolean, isCurrent: boolean, label: string, time: number | null): { label: string; status: StepStatus; time: number | null } => ({
    label,
    status: done ? "done" : isCurrent ? "current" : "pending",
    time,
  });

  return [
    step(windowDone, s.state === "SETUP", "觀察窗口完成", windowDone ? s.refTime : null),
    step(windowDone, false, "最大成交量K確定", windowDone ? s.refTime : null),
    step(breakoutDone, s.state === "WATCHING", "突破", s.breakoutTime),
    step(breakoutDone, s.state === "WAIT_RETEST", "等待回踩", null),
    step(retestDone, false, "回踩確認", s.retestTime),
    step(entryReached, s.state === "RETEST_CONFIRMED", "可以進場", s.signalTime),
  ];
}

export default function SignalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const symbol = String(params.symbol ?? "");

  const [signal, setSignal] = useState<LiveSignal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const candles = await fetchKlines(symbol, "5m", 288);
      const result = evaluateLiveSignal(symbol, candles, ENGINE_WINDOW, ENGINE_TP, 0.3);
      setSignal(result);
      upsertFromLiveSignal(result, ENGINE_TP);
    } catch {
      setError("資料抓取失敗，請重新整理");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (symbol) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const theme = signal ? SIGNAL_STATE_THEME[signal.state] : null;

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-4 flex items-center gap-3">
        <button onClick={() => router.back()} aria-label="返回" className="w-9 h-9 rounded-full flex items-center justify-center border border-border text-subtext active:scale-90 transition">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-lg font-display font-bold tracking-tight">
          {symbol.replace("USDT", "")} <span className="text-subtext text-sm font-normal">/ USDT</span>
        </h1>
      </header>

      {error && <div className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{error}</div>}

      {loading && !signal ? (
        <div className="text-sm text-subtext text-center py-8">載入中…</div>
      ) : signal ? (
        <div>
          <div className="rounded-2xl border border-border bg-panel p-4 mb-3">
            <div className="flex items-center justify-between mb-1">
              {signal.direction && (
                <span className={`text-sm font-semibold ${signal.direction === "LONG" ? "text-bull" : "text-bear"}`}>
                  {signal.direction === "LONG" ? "做多" : "做空"}
                </span>
              )}
              {theme && <StatusDot color={theme.color} label={theme.label} size="md" />}
            </div>
          </div>

          {/* 進度流程 */}
          <div className="rounded-2xl border border-border bg-panel p-4 mb-3">
            <div className="text-xs text-subtext mb-3">進度流程</div>
            <div className="space-y-3">
              {computeSteps(signal).map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                      step.status === "done" ? "bg-bull" : step.status === "current" ? "bg-info" : "bg-panel2 border border-border"
                    }`}
                  >
                    {step.status === "done" && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0A0E14" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                  <span className={`text-sm flex-1 ${step.status === "pending" ? "text-subtext" : ""}`}>{step.label}</span>
                  {step.status === "current" ? (
                    <span className="text-xs text-info">進行中</span>
                  ) : step.time ? (
                    <span className="text-xs text-subtext numeric-safe">{fmtTime(step.time)}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* 數值明細 */}
          <div className="rounded-2xl border border-border bg-panel p-4 mb-3">
            <div className="text-xs text-subtext mb-3">數值明細</div>
            <div className="space-y-2 text-sm">
              <Row label="基準K線時間" value={signal.refTime ? new Date(signal.refTime * 1000).toLocaleString("zh-TW", { hour12: false }) : "—"} />
              <Row label="基準最高價" value={fmtPrice(signal.refHigh)} />
              <Row label="基準最低價" value={fmtPrice(signal.refLow)} />
              <Row label="目前價格" value={fmtPrice(signal.currentPrice)} />
              {signal.distanceToBreakoutPct != null && <Row label="距突破幅度" value={`${signal.distanceToBreakoutPct.toFixed(2)}%`} />}
              {signal.entryPrice != null && <Row label="進場價" value={fmtPrice(signal.entryPrice)} highlight />}
              {signal.stopLoss != null && <Row label="止損價" value={fmtPrice(signal.stopLoss)} color="text-bear" />}
              {signal.takeProfit != null && <Row label="止盈價" value={fmtPrice(signal.takeProfit)} color="text-bull" />}
              <Row label="資料延遲" value={signal.dataAgeMinutes != null ? `${signal.dataAgeMinutes.toFixed(1)} 分鐘` : "—"} />
            </div>
          </div>

          <button onClick={load} disabled={loading} className="btn-primary w-full border border-border bg-panel2 text-sm">
            {loading ? "更新中…" : "重新整理"}
          </button>
        </div>
      ) : null}
    </main>
  );
}

function Row({ label, value, color, highlight }: { label: string; value: string; color?: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-subtext">{label}</span>
      <span className={`numeric-safe font-medium ${color ?? ""} ${highlight ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
