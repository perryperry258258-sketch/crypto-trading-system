"use client";

import { useEffect, useState } from "react";
import { useMarketData } from "@/lib/useMarketData";
import { PHASES, calcPositionSize } from "@/lib/phases";

const wsStatusLabel: Record<string, { label: string; className: string }> = {
  LIVE: { label: "🟢 Connected", className: "text-bull" },
  CONNECTING: { label: "🟡 Connecting", className: "text-warn" },
  DELAYED: { label: "🟡 Delayed", className: "text-warn" },
  ERROR: { label: "🔴 Error", className: "text-bear" },
};

export default function SettingsPage() {
  const {
    capital,
    setCapital,
    capitalState,
    connectionStatus,
    lastTickAt,
    lastUpdated,
    scanUpdatedAt,
    coins,
    candidates,
    global,
    notificationPermission,
    requestNotifications,
  } = useMarketData();
  const [input, setInput] = useState(String(capital));
  const [now, setNow] = useState(Date.now());
  const [calcEntry, setCalcEntry] = useState("");
  const [calcStop, setCalcStop] = useState("");
  const [calcRisk, setCalcRisk] = useState(String(capitalState.phase.maxRiskPct.toFixed(2)));

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const tickAgeMs = lastTickAt ? now - lastTickAt.getTime() : null;
  const ws = wsStatusLabel[connectionStatus];
  const restOk = coins.length > 0;
  const coingeckoOk = global !== null;
  const chartOk = candidates.length > 0 || coins.length > 0; // 圖表與 dashboard 共用同一個 Binance K線來源

  const entryNum = Number(calcEntry);
  const stopNum = Number(calcStop);
  const riskNum = Number(calcRisk);
  const calcValid = entryNum > 0 && stopNum > 0 && stopNum !== entryNum && riskNum > 0;
  const calcResult = calcValid
    ? calcPositionSize({ capital, riskPct: riskNum, entryPrice: entryNum, stopLossPrice: stopNum })
    : null;

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-4">
        <h1 className="text-xl font-display font-bold tracking-tight">設定</h1>
      </header>

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-3">DATA HEALTH</div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-subtext">Binance WebSocket</span>
            <span className={ws.className}>{ws.label}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">Binance REST（初始快照）</span>
            <span className={restOk ? "text-bull" : "text-bear"}>{restOk ? "🟢 Working" : "🔴 No data"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">CoinGecko（市值/大盤）</span>
            <span className={coingeckoOk ? "text-bull" : "text-bear"}>{coingeckoOk ? "🟢 Working" : "🔴 Error"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">TradingView Chart（Binance K線）</span>
            <span className={chartOk ? "text-bull" : "text-bear"}>{chartOk ? "🟢 Working" : "⚪ 尚無資料"}</span>
          </div>
          <div className="h-px bg-border my-2" />
          <div className="flex items-center justify-between">
            <span className="text-subtext">Last Tick（Binance WS）</span>
            <span className="numeric-safe">{lastTickAt ? lastTickAt.toLocaleTimeString() : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">Data Latency</span>
            <span className="numeric-safe">{tickAgeMs !== null ? `${tickAgeMs.toLocaleString()} ms` : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">CoinGecko 最後更新</span>
            <span className="numeric-safe">{lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-subtext">技術指標最後掃描</span>
            <span className="numeric-safe">{scanUpdatedAt ? scanUpdatedAt.toLocaleTimeString() : "—"}</span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-2">🔔 瀏覽器通知</div>
        <div className="text-xs text-subtext mb-3 leading-relaxed">
          出現 S/A 級機會、模擬交易平倉時會跳通知。限制：只有這個網站分頁還開著（可在背景）才會運作，完全關閉分頁不會收到。
        </div>
        {notificationPermission === "granted" && (
          <div className="text-sm text-bull">🟢 已啟用</div>
        )}
        {notificationPermission === "denied" && (
          <div className="text-sm text-bear">🔴 已被封鎖，請到手機瀏覽器的網站權限設定裡手動開啟</div>
        )}
        {notificationPermission === "unsupported" && (
          <div className="text-sm text-subtext">此瀏覽器不支援通知功能</div>
        )}
        {notificationPermission === "default" && (
          <button
            onClick={requestNotifications}
            className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm"
          >
            啟用通知
          </button>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">🧮 倉位計算器</div>
        <div className="text-xs text-subtext mb-3 leading-relaxed">
          進場價、停損價請用同一種幣別填（例如都用美金/USDT），本金預設抓你的資金，也可以自己改。
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className="text-[11px] text-subtext mb-1 block">進場價</label>
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
            <label className="text-[11px] text-subtext mb-1 block">停損價</label>
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
              <div className="text-[11px] text-subtext">建議倉位金額</div>
              <div className="font-semibold numeric-safe text-accent">{calcResult.positionSize.toFixed(2)}</div>
            </div>
            <div className="rounded-xl bg-panel2 p-3">
              <div className="text-[11px] text-subtext">最大虧損金額</div>
              <div className="font-semibold numeric-safe text-bear">{calcResult.maxLossAmount.toFixed(2)}</div>
            </div>
            <div className="rounded-xl bg-panel2 p-3">
              <div className="text-[11px] text-subtext">停損距離</div>
              <div className="font-semibold numeric-safe">{calcResult.stopDistancePct.toFixed(2)}%</div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-subtext text-center py-2">填入進場價和停損價（不能相同）就會自動算</div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-xs text-subtext mb-2">目前本金</div>
        <div className="flex gap-2">
          <input
            inputMode="numeric"
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/[^0-9]/g, ""))}
            className="flex-1 min-w-0 bg-panel2 border border-border rounded-xl px-3 text-lg numeric-safe"
            style={{ minHeight: 44 }}
          />
          <button
            onClick={() => setCapital(Number(input) || capital)}
            className="btn-primary px-4 bg-accent/20 text-accent border border-accent/40 text-sm"
          >
            儲存
          </button>
        </div>
        <div className="text-xs text-subtext mt-2">
          目前 {capitalState.phase.label} ・ 單筆最大風險 {capitalState.phase.maxRiskPct.toFixed(2)}%
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-3">資金階段與風控對照表</div>
        <div className="space-y-2">
          {PHASES.map((p) => (
            <div
              key={p.index}
              className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 ${
                p.index === capitalState.phase.index ? "bg-accent/15 border border-accent/40" : "bg-panel2"
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
      </section>

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-2">關於本系統</div>
        <div className="text-sm text-subtext leading-relaxed break-words">
          本系統僅供交易決策參考，所有評分、訊號與回測結果都可能出錯或失效，不構成投資建議，不保證獲利。請自行承擔交易風險。
        </div>
      </section>
    </main>
  );
}
