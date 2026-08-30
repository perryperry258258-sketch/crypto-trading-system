"use client";

import { useState } from "react";
import { useMarketData } from "@/lib/useMarketData";
import { fetchKlinesHistory } from "@/lib/binance";
import { runBacktest, BacktestResult } from "@/lib/backtest";
import EquityCurve from "@/components/EquityCurve";

const lockLabel: Record<string, { label: string; note: string; className: string }> = {
  NORMAL: { label: "正常", note: "尚未觸發保護機制。", className: "bg-bull/10 text-bull border-bull/30" },
  REDUCE_RISK: {
    label: "降低風險",
    note: "回撤達 10%，單筆風險已自動調降。",
    className: "bg-warn/10 text-warn border-warn/30",
  },
  HIGH_RISK_BAN: {
    label: "禁止高風險交易",
    note: "回撤達 15%，僅允許最保守的小倉位交易。",
    className: "bg-warn/10 text-warn border-warn/30",
  },
  PROTECT_MODE: {
    label: "保護模式",
    note: "回撤達 20%，禁止開新倉，僅可管理既有部位。",
    className: "bg-bear/10 text-bear border-bear/30",
  },
};

const BACKTEST_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

function fmt(n: number) {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

function getVerdict(r: BacktestResult) {
  if (r.totalTrades < 5) {
    return {
      emoji: "🤷",
      label: "交易次數太少",
      sentence: "測試期間出現的訊號太少，這個結果還不夠可靠，先不下結論。",
      className: "text-subtext",
    };
  }
  if (r.profitFactor >= 1.3 && r.avgR > 0) {
    return {
      emoji: "🙂",
      label: "過去表現：有優勢",
      sentence: "這段期間如果照這套邏輯交易，賺的時候賺得比賠的時候賠得多，整體是正的。",
      className: "text-bull",
    };
  }
  if (r.profitFactor >= 1.0) {
    return {
      emoji: "😐",
      label: "過去表現：大致打平",
      sentence: "賺賠差不多，還看不出明顯優勢，不算穩定可靠。",
      className: "text-warn",
    };
  }
  return {
    emoji: "😕",
    label: "過去表現：偏虧",
    sentence: "這段期間如果照這套邏輯交易，長期是虧錢的。",
    className: "text-bear",
  };
}

// 簡單試算：假設每筆只冒 1% 風險，把一連串 R 倍數換算成本金變化百分比
function simpleReturnPct(trades: BacktestResult["trades"], riskPct: number = 1) {
  const multiplier = trades.reduce((acc, t) => acc * (1 + (t.rMultiple * riskPct) / 100), 1);
  return (multiplier - 1) * 100;
}

export default function JournalPage() {
  const { capitalState, paperOpen, paperClosed, paperStats, coins } = useMarketData();
  const [btSymbol, setBtSymbol] = useState("BTCUSDT");
  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);
  const [btResult, setBtResult] = useState<BacktestResult | null>(null);

  const lock = lockLabel[capitalState.profitLockLevel];

  const runTest = async () => {
    setBtLoading(true);
    setBtError(null);
    setBtResult(null);
    try {
      const candles = await fetchKlinesHistory(btSymbol, "1h", 1500);
      if (candles.length < 100) throw new Error("歷史資料不足");
      const result = runBacktest(btSymbol, "1h", candles);
      setBtResult(result);
    } catch (e) {
      setBtError("回測資料取得失敗，請稍後再試");
    } finally {
      setBtLoading(false);
    }
  };

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-4">
        <h1 className="text-xl font-display font-bold tracking-tight">交易</h1>
      </header>

      <section className={`rounded-2xl border p-4 mb-3 ${lock.className}`}>
        <div className="text-xs text-subtext mb-1">獲利保護狀態</div>
        <div className="text-lg font-display font-bold mb-1">{lock.label}</div>
        <div className="text-sm break-words">{lock.note}</div>
        <div className="text-xs text-subtext mt-2">
          目前回撤：{capitalState.drawdownPct.toFixed(1)}%（峰值 NT${Math.round(capitalState.peakCapital).toLocaleString()}）
        </div>
      </section>

      {/* 模擬交易績效 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">📈 模擬交易（Paper Trading）績效</div>
        <div className="text-xs text-subtext mb-3 leading-relaxed">
          系統偵測到 S/A 級機會會自動開立模擬部位，不動用真錢。只認「碰到 TP1」或「碰到停損」兩種結果。
        </div>
        {paperStats.totalTrades === 0 ? (
          <div className="text-sm text-subtext text-center py-2">尚無已平倉的模擬交易紀錄</div>
        ) : (
          <>
            <div className="mb-3">
              <EquityCurve rMultiples={paperClosed.map((t) => t.rMultiple)} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-center text-sm">
              <div className="rounded-xl bg-panel2 p-3">
                <div className="text-xs text-subtext">勝率</div>
                <div className="font-semibold numeric-safe">{paperStats.winRate.toFixed(1)}%</div>
              </div>
              <div className="rounded-xl bg-panel2 p-3">
                <div className="text-xs text-subtext">總交易數</div>
                <div className="font-semibold numeric-safe">{paperStats.totalTrades}</div>
              </div>
              <div className="rounded-xl bg-panel2 p-3">
                <div className="text-xs text-subtext">平均 R</div>
                <div className={`font-semibold numeric-safe ${paperStats.avgR >= 0 ? "text-bull" : "text-bear"}`}>
                  {paperStats.avgR.toFixed(2)}
                </div>
              </div>
              <div className="rounded-xl bg-panel2 p-3">
                <div className="text-xs text-subtext">Profit Factor</div>
                <div className="font-semibold numeric-safe">
                  {paperStats.profitFactor === Infinity ? "∞" : paperStats.profitFactor.toFixed(2)}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* 未平倉模擬部位 */}
      {paperOpen.length > 0 && (
        <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
          <div className="text-sm font-semibold mb-2">未平倉模擬部位（{paperOpen.length}）</div>
          <div className="space-y-2">
            {paperOpen.map((p) => {
              const live = coins.find((c) => c.symbol === p.symbol);
              return (
                <div key={p.id} className="rounded-xl bg-panel2 p-3 text-xs">
                  <div className="flex justify-between mb-1">
                    <span className="font-semibold">{p.symbol}</span>
                    <span className="text-subtext">{p.grade}級</span>
                  </div>
                  <div className="flex justify-between text-subtext">
                    <span>進場 {fmt(p.entryPrice)}</span>
                    <span>現價 {live ? fmt(live.price) : "—"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 已平倉紀錄 */}
      {paperClosed.length > 0 && (
        <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
          <div className="text-sm font-semibold mb-2">最近平倉紀錄</div>
          <div className="space-y-2">
            {[...paperClosed]
              .reverse()
              .slice(0, 10)
              .map((t) => (
                <div key={t.id} className="flex justify-between items-center text-xs rounded-lg bg-panel2 px-3 py-2">
                  <span className="font-medium">{t.symbol}</span>
                  <span className={t.result === "WIN" ? "text-bull" : "text-bear"}>
                    {t.result === "WIN" ? "✅ WIN" : "🛑 LOSS"}
                  </span>
                  <span className="numeric-safe">{t.rMultiple.toFixed(2)}R</span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* 回測 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">🔬 歷史回測（Backtest）</div>
        <div className="text-xs text-subtext mb-3 leading-relaxed">
          用過去約 60 天的 1小時K線，測試「趨勢+動能」這組技術面核心進場邏輯。不含市場面／情緒面／量能面（那些只有現在才有資料，歷史上補不回去，不會硬湊假資料）。已扣除假設 0.15% 的手續費/滑價。
        </div>
        <div className="flex gap-2 mb-3">
          <select
            value={btSymbol}
            onChange={(e) => setBtSymbol(e.target.value)}
            className="flex-1 min-w-0 bg-panel2 border border-border rounded-xl px-3 text-sm"
            style={{ minHeight: 44 }}
          >
            {BACKTEST_SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s.replace("USDT", "")}
              </option>
            ))}
          </select>
          <button
            onClick={runTest}
            disabled={btLoading}
            className="btn-primary px-4 bg-accent/20 text-accent border border-accent/40 text-sm shrink-0"
          >
            {btLoading ? "執行中…" : "執行回測"}
          </button>
        </div>

        {btError && <div className="text-xs text-warn mb-2">⚠️ {btError}</div>}

        {btResult && (
          <div>
            {(() => {
              const verdict = getVerdict(btResult);
              const simpleReturn = simpleReturnPct(btResult.trades, 1);
              return (
                <>
                  <div className={`rounded-xl bg-panel2 p-3 mb-3`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{verdict.emoji}</span>
                      <span className={`text-sm font-semibold ${verdict.className}`}>{verdict.label}</span>
                    </div>
                    <div className="text-sm text-text leading-relaxed">{verdict.sentence}</div>
                  </div>

                  <div className="rounded-xl bg-panel2 p-4 mb-3 text-center">
                    <div className="text-xs text-subtext mb-1">簡單試算（假設每筆只冒 1% 風險）</div>
                    <div
                      className={`text-2xl font-display font-bold numeric-safe ${
                        simpleReturn >= 0 ? "text-bull" : "text-bear"
                      }`}
                    >
                      {simpleReturn >= 0 ? "+" : ""}
                      {simpleReturn.toFixed(1)}%
                    </div>
                    <div className="text-xs text-subtext mt-1">
                      約 {Math.round(btResult.totalBars / 24)} 天期間，本金大概會變成這樣
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="text-xs text-subtext mb-2">資金曲線（累積 R）</div>
                    <EquityCurve rMultiples={btResult.trades.map((t) => t.rMultiple)} />
                  </div>

                  <details className="text-xs">
                    <summary className="text-subtext cursor-pointer mb-3 select-none">查看詳細數字 ▾</summary>
                    <div className="grid grid-cols-2 gap-2 text-center text-sm mb-1">
                      <div className="rounded-xl bg-panel2 p-3">
                        <div className="text-xs text-subtext">勝率</div>
                        <div className="font-semibold numeric-safe">{btResult.winRate.toFixed(1)}%</div>
                        <div className="text-[10px] text-subtext mt-1">贏的次數比例</div>
                      </div>
                      <div className="rounded-xl bg-panel2 p-3">
                        <div className="text-xs text-subtext">交易次數</div>
                        <div className="font-semibold numeric-safe">{btResult.totalTrades}</div>
                        <div className="text-[10px] text-subtext mt-1">測試期間總共進場幾次</div>
                      </div>
                      <div className="rounded-xl bg-panel2 p-3">
                        <div className="text-xs text-subtext">平均 R</div>
                        <div
                          className={`font-semibold numeric-safe ${btResult.avgR >= 0 ? "text-bull" : "text-bear"}`}
                        >
                          {btResult.avgR.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-subtext mt-1">平均每筆賺賠幾倍風險</div>
                      </div>
                      <div className="rounded-xl bg-panel2 p-3">
                        <div className="text-xs text-subtext">Profit Factor</div>
                        <div className="font-semibold numeric-safe">
                          {btResult.profitFactor === Infinity ? "∞" : btResult.profitFactor.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-subtext mt-1">大於 1 代表長期是賺的</div>
                      </div>
                      <div className="rounded-xl bg-panel2 p-3 col-span-2">
                        <div className="text-xs text-subtext">最慘連續虧損</div>
                        <div className="font-semibold numeric-safe text-bear">-{btResult.maxDrawdownR.toFixed(2)}R</div>
                        <div className="text-[10px] text-subtext mt-1">代表這段期間最難熬的時候虧了幾倍風險</div>
                      </div>
                    </div>
                    <div className="text-[11px] text-subtext mt-2">
                      測試範圍：{btResult.totalBars} 根 1小時K棒（約 {Math.round(btResult.totalBars / 24)} 天）
                    </div>
                  </details>
                </>
              );
            })()}
          </div>
        )}
      </section>
    </main>
  );
}
 
