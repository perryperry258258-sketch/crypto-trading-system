"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMarketData } from "@/lib/useMarketData";
import { PHASES, calcPositionSize } from "@/lib/phases";
import { getNotificationPermission, requestNotificationPermission, NotificationPermissionStatus } from "@/lib/notifications";
import { StatusDot } from "@/components/ui";

// UI/UX改版：重新分組（交易設定/通知設定/其他），拿掉大量emoji，
// 所有既有功能（本金、匯率、倉位計算器、資金階段表、資料健康檢查、通知）都保留，
// 只是收進「進階工具」讓首屏更乾淨。沒有新增/修改任何交易邏輯。
//
// 「交易設定」目前是唯讀：觀察窗口/回踩容忍度/TP倍數這些數值是跟已經驗證過的
// 2年樣本外回測綁在一起的（改一個數字，先前的驗證結果就不再適用），所以先不開放
// 使用者直接修改，只顯示「目前使用中」的值，避免使用者以為改了設定、驗證結果卻沒跟著變。

const wsStatusLabel: Record<string, { label: string; color: "green" | "yellow" | "red" }> = {
  LIVE: { label: "即時連線中", color: "green" },
  CONNECTING: { label: "連線中", color: "yellow" },
  DELAYED: { label: "延遲", color: "yellow" },
  ERROR: { label: "資料異常", color: "red" },
};

const RATE_KEY = "cts_usdtwd_v1";
const DEFAULT_RATE = 31.5;

export default function SettingsPage() {
  const { capital, setCapital, capitalState, connectionStatus, lastTickAt, lastUpdated, coins, global } =
    useMarketData();
  const [input, setInput] = useState(String(capital));
  const [now, setNow] = useState(Date.now());
  const [calcEntry, setCalcEntry] = useState("");
  const [calcStop, setCalcStop] = useState("");
  const [calcRisk, setCalcRisk] = useState(String(capitalState.phase.maxRiskPct.toFixed(2)));
  const [usdRate, setUsdRate] = useState(DEFAULT_RATE);
  const [usdRateInput, setUsdRateInput] = useState(String(DEFAULT_RATE));
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionStatus>("default");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    setNotificationPermission(getNotificationPermission());
    return () => clearInterval(id);
  }, []);

  const requestNotifications = async () => {
    const result = await requestNotificationPermission();
    setNotificationPermission(result);
  };

  useEffect(() => {
    const saved = Number(localStorage.getItem(RATE_KEY));
    if (saved > 0) {
      setUsdRate(saved);
      setUsdRateInput(String(saved));
    }
  }, []);

  const saveRate = () => {
    const v = Number(usdRateInput);
    if (v > 0) {
      setUsdRate(v);
      localStorage.setItem(RATE_KEY, String(v));
    }
  };

  const tickAgeMs = lastTickAt ? now - lastTickAt.getTime() : null;
  const ws = wsStatusLabel[connectionStatus];
  const restOk = coins.length > 0;
  const coingeckoOk = global !== null;

  const capitalUsd = capital / usdRate;
  const entryNum = Number(calcEntry);
  const stopNum = Number(calcStop);
  const riskNum = Number(calcRisk);
  const calcValid = entryNum > 0 && stopNum > 0 && stopNum !== entryNum && riskNum > 0;
  const calcResult = calcValid
    ? calcPositionSize({ capital: capitalUsd, riskPct: riskNum, entryPrice: entryNum, stopLossPrice: stopNum })
    : null;

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-4">
        <h1 className="text-xl font-display font-bold tracking-tight">設定</h1>
      </header>

      {/* 交易設定 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">交易設定</div>
        <div className="text-xs text-subtext mb-3 leading-relaxed">
          目前使用中的參數，跟已經完成樣本外驗證的回測綁定，暫不開放調整。
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-subtext">觀察窗口</span>
            <span className="numeric-safe font-medium">60 分鐘</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">回踩容忍度</span>
            <span className="numeric-safe font-medium">±0.3%</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">止盈設定</span>
            <span className="numeric-safe font-medium">1R</span>
          </div>
        </div>
        <Link href="/journal" className="text-xs text-bull mt-3 inline-block">
          查看完整回測與驗證工具 →
        </Link>
      </section>

      {/* 通知設定 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-2">通知設定</div>
        <div className="text-xs text-subtext mb-3 leading-relaxed">
          A級訊號通知：出現可以進場的訊號時提醒。限制：只有這個網站分頁還開著（可在背景）才會運作，完全關閉分頁不會收到。
        </div>
        {notificationPermission === "granted" && <StatusDot color="green" label="已啟用" size="md" />}
        {notificationPermission === "denied" && <StatusDot color="red" label="已被封鎖，請到手機瀏覽器的網站權限設定裡手動開啟" size="md" />}
        {notificationPermission === "unsupported" && <StatusDot color="grey" label="此瀏覽器不支援通知功能" size="md" />}
        {notificationPermission === "default" && (
          <button onClick={requestNotifications} className="btn-primary w-full bg-brand/15 text-brand border border-brand/40 text-sm">
            啟用A級訊號通知
          </button>
        )}
      </section>

      {/* 其他：資料健康度 */}
      <details className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <summary className="text-sm font-semibold cursor-pointer select-none">資料健康度 ▾</summary>
        <div className="space-y-2 text-xs mt-3">
          <div className="flex items-center justify-between">
            <span className="text-subtext">即時連線（WebSocket）</span>
            <StatusDot color={ws.color} label={ws.label} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">Binance 資料查詢</span>
            <StatusDot color={restOk ? "green" : "red"} label={restOk ? "正常" : "無資料"} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">CoinGecko（市值/大盤）</span>
            <StatusDot color={coingeckoOk ? "green" : "red"} label={coingeckoOk ? "正常" : "異常"} />
          </div>
          <div className="h-px bg-border my-2" />
          <div className="flex items-center justify-between">
            <span className="text-subtext">最後收到報價時間</span>
            <span className="numeric-safe">{lastTickAt ? lastTickAt.toLocaleTimeString() : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">資料延遲</span>
            <span className="numeric-safe">{tickAgeMs !== null ? `${tickAgeMs.toLocaleString()} ms` : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">CoinGecko 最後更新</span>
            <span className="numeric-safe">{lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}</span>
          </div>
        </div>
      </details>

      {/* 進階工具（既有功能全部保留，收進折疊區） */}
      <details className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <summary className="text-sm font-semibold cursor-pointer select-none">進階工具 ▾</summary>

        <div className="mt-4">
          <div className="text-xs text-subtext mb-2">目前本金</div>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              value={input}
              onChange={(e) => setInput(e.target.value.replace(/[^0-9]/g, ""))}
              className="flex-1 min-w-0 bg-panel2 border border-border rounded-xl px-3 text-lg numeric-safe"
              style={{ minHeight: 44 }}
            />
            <button onClick={() => setCapital(Number(input) || capital)} className="btn-primary px-4 bg-brand/15 text-brand border border-brand/40 text-sm">
              儲存
            </button>
          </div>
          <div className="text-xs text-subtext mt-2">
            目前 {capitalState.phase.label} ・ 單筆最大風險 {capitalState.phase.maxRiskPct.toFixed(2)}%
          </div>
        </div>

        <div className="h-px bg-border my-4" />

        <div>
          <div className="text-xs font-semibold mb-1">美金/台幣匯率</div>
          <div className="text-xs text-subtext mb-3 leading-relaxed">
            本金是台幣，幣價是美金，這個匯率用來自動換算，讓下面的倉位計算器數字對得起來。
          </div>
          <div className="flex gap-2">
            <input
              inputMode="decimal"
              value={usdRateInput}
              onChange={(e) => setUsdRateInput(e.target.value.replace(/[^0-9.]/g, ""))}
              className="flex-1 min-w-0 bg-panel2 border border-border rounded-xl px-3 text-lg numeric-safe"
              style={{ minHeight: 44 }}
            />
            <button onClick={saveRate} className="btn-primary px-4 bg-brand/15 text-brand border border-brand/40 text-sm">
              儲存
            </button>
          </div>
          <div className="text-xs text-subtext mt-2">
            目前：1 美金 = {usdRate} 台幣 ・ 本金換算約 ${capitalUsd.toFixed(2)} USD
          </div>
        </div>

        <div className="h-px bg-border my-4" />

        <div>
          <div className="text-xs font-semibold mb-1">倉位計算器</div>
          <div className="text-xs text-subtext mb-3 leading-relaxed">進場價、停損價請填美金，本金會用上面的匯率自動換算。</div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="text-[11px] text-subtext mb-1 block">進場價（USD）</label>
              <input
                inputMode="decimal"
                value={calcEntry}
                onChange={(e) => setCalcEntry(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="例如 102000"
                className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm numeric-safe"
                style={{ minHeight: 44 }}
              />
            </div>
            <div>
              <label className="text-[11px] text-subtext mb-1 block">停損價（USD）</label>
              <input
                inputMode="decimal"
                value={calcStop}
                onChange={(e) => setCalcStop(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="例如 98500"
                className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm numeric-safe"
                style={{ minHeight: 44 }}
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="text-[11px] text-subtext mb-1 block">單筆風險 %（預設為目前階段上限）</label>
            <input
              inputMode="decimal"
              value={calcRisk}
              onChange={(e) => setCalcRisk(e.target.value.replace(/[^0-9.]/g, ""))}
              className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm numeric-safe"
              style={{ minHeight: 44 }}
            />
          </div>
          {calcResult ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-panel2 p-3">
                <div className="text-[11px] text-subtext">建議倉位（USD）</div>
                <div className="font-semibold numeric-safe text-brand">${calcResult.positionSize.toFixed(2)}</div>
              </div>
              <div className="rounded-xl bg-panel2 p-3">
                <div className="text-[11px] text-subtext">最大虧損（USD）</div>
                <div className="font-semibold numeric-safe text-bear">${calcResult.maxLossAmount.toFixed(2)}</div>
              </div>
              <div className="rounded-xl bg-panel2 p-3">
                <div className="text-[11px] text-subtext">停損距離</div>
                <div className="font-semibold numeric-safe">{calcResult.stopDistancePct.toFixed(2)}%</div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-subtext text-center py-2">填入進場價和停損價（不能相同）就會自動算</div>
          )}
        </div>

        <div className="h-px bg-border my-4" />

        <div>
          <div className="text-xs font-semibold mb-2">資金階段與風控對照表</div>
          <div className="space-y-2">
            {PHASES.map((p) => (
              <div
                key={p.index}
                className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 ${
                  p.index === capitalState.phase.index ? "bg-brand/15 border border-brand/40" : "bg-panel2"
                }`}
              >
                <span className="font-medium">{p.label}</span>
                <span className="text-subtext numeric-safe truncate mx-2">
                  NT${p.from.toLocaleString()}
                  {p.to ? ` ~ ${p.to.toLocaleString()}` : "+"}
                </span>
                <span className="font-semibold numeric-safe">{p.maxRiskPct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      </details>

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-2">關於本系統</div>
        <div className="text-sm text-subtext leading-relaxed break-words">
          本系統僅供交易決策參考，所有評分、訊號與回測結果都可能出錯或失效，不構成投資建議，不保證獲利。請自行承擔交易風險。
        </div>
      </section>
    </main>
  );
}
