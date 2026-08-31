"use client";

import { useState } from "react";
import { useMarketData } from "@/lib/useMarketData";
import { fetchKlinesHistory } from "@/lib/binance";
import { runBacktest, auditTrades, stopLossVerdict, BacktestTrade, SignalAuditReport } from "@/lib/backtest";
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

const AUDIT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT"];
const AUDIT_BARS_PER_SYMBOL = 1200; // 約 50 天／幣種

function fmt(n: number) {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

function AuditReportCard({ report }: { report: SignalAuditReport }) {
  return (
    <div className="rounded-xl bg-panel2 p-3 mb-3">
      <div className="text-xs font-semibold mb-2">{report.label}</div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs mb-2">
        <div>
          <div className="text-subtext">總訊號數</div>
          <div className="font-semibold numeric-safe">{report.totalSignals}</div>
        </div>
        <div>
          <div className="text-subtext">TP先到</div>
          <div className="font-semibold numeric-safe text-bull">{report.tpFirst}</div>
        </div>
        <div>
          <div className="text-subtext">SL先到</div>
          <div className="font-semibold numeric-safe text-bear">{report.slFirst}</div>
        </div>
        <div>
          <div className="text-subtext">未觸發</div>
          <div className="font-semibold numeric-safe">{report.timeout}</div>
        </div>
        <div>
          <div className="text-subtext">勝率</div>
          <div className="font-semibold numeric-safe">{report.winRate.toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-subtext">平均R</div>
          <div className={`font-semibold numeric-safe ${report.avgR >= 0 ? "text-bull" : "text-bear"}`}>
            {report.avgR.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-subtext">Profit Factor</div>
          <div className="font-semibold numeric-safe">
            {report.profitFactor === Infinity ? "∞" : report.profitFactor.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-subtext">最大回撤</div>
          <div className="font-semibold numeric-safe text-bear">-{report.maxDrawdownR.toFixed(2)}R</div>
        </div>
        <div>
          <div className="text-subtext">平均到SL</div>
          <div className="font-semibold numeric-safe">{report.avgTimeToSLHours.toFixed(0)}h</div>
        </div>
      </div>
      <div className="text-[10px] text-subtext">平均到TP時間：{report.avgTimeToTPHours.toFixed(0)} 小時</div>
    </div>
  );
}

export default function JournalPage() {
  const { capitalState, paperOpen, paperClosed, paperStats, coins } = useMarketData();
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditProgress, setAuditProgress] = useState("");
  const [allTrades, setAllTrades] = useState<BacktestTrade[] | null>(null);

  const lock = lockLabel[capitalState.profitLockLevel];

  const runAudit = async () => {
    setAuditLoading(true);
    setAuditError(null);
    setAllTrades(null);
    const collected: BacktestTrade[] = [];
    try {
      for (const symbol of AUDIT_SYMBOLS) {
        setAuditProgress(`抓取 ${symbol.replace("USDT", "")} 歷史資料中…`);
        const candles = await fetchKlinesHistory(symbol, "1h", AUDIT_BARS_PER_SYMBOL);
        if (candles.length >= 100) {
          const result = runBacktest(symbol, "1h", candles);
          collected.push(...result.trades);
        }
      }
      if (collected.length === 0) throw new Error("no data");
      setAllTrades(collected);
    } catch (e) {
      setAuditError("稽核資料取得失敗，請稍後再試（可能是 Binance API 暫時不穩定）");
    } finally {
      setAuditLoading(false);
      setAuditProgress("");
    }
  };

  const auditAll = allTrades ? auditTrades(allTrades, "全部技術面訊號（趨勢+動能）") : null;
  const strictTrades = allTrades ? allTrades.filter((t) => t.qualifiesAsA) : null;
  const auditStrict = strictTrades ? auditTrades(strictTrades, "符合新版A級標準（Entry Quality≥75 且 R:R≥3）") : null;
  const slVerdict = auditAll ? stopLossVerdict(auditAll) : null;

  const noEdgeYet =
    auditStrict !== null && (auditStrict.totalSignals < 20 || auditStrict.profitFactor < 1);

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
          系統偵測到 S/A 級機會會自動開立模擬部位，不動用真錢。只認「碰到 TP1」或「碰到停損」兩種結果。停損公式已於
          Signal Failure Audit 後改為「Swing Low + 動態 ATR 緩衝」，此時間點之前的紀錄是用舊公式產生的，不能直接比較。
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

      {/* Signal Failure Audit */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">🔍 Signal Failure Audit</div>
        <div className="text-xs text-subtext mb-3 leading-relaxed">
          用 {AUDIT_SYMBOLS.length} 個主流幣種、每個約 {Math.round(AUDIT_BARS_PER_SYMBOL / 24)} 天的 1小時K線，一起跑技術面訊號，
          統計「先碰到停損」還是「先碰到TP1」（同根K棒兩者都觸及時，保守判定為停損優先），並比較「全部技術面訊號」跟「符合新版A級標準」兩組表現差異。
          市場面／情緒面因子歷史上補不回去，不列入回測。
        </div>
        <button
          onClick={runAudit}
          disabled={auditLoading}
          className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-3"
        >
          {auditLoading ? auditProgress || "執行中…" : "執行完整稽核（約需 30-60 秒）"}
        </button>

        {auditError && <div className="text-xs text-warn mb-2">⚠️ {auditError}</div>}

        {auditAll && auditStrict && slVerdict && (
          <div>
            {noEdgeYet && (
              <div className="rounded-xl bg-bear/10 border border-bear/30 p-3 mb-3">
                <div className="text-sm font-semibold text-bear mb-1">⚠️ 目前系統沒有足夠證據證明具有正期望值</div>
                <div className="text-xs text-text leading-relaxed">
                  {auditStrict.totalSignals < 20
                    ? `符合新版A級標準的訊號只有 ${auditStrict.totalSignals} 筆，樣本太少，還不能下結論。`
                    : `符合新版A級標準的訊號 Profit Factor 是 ${auditStrict.profitFactor.toFixed(2)}（小於1代表長期是虧的）。`}
                </div>
              </div>
            )}

            <div className="text-xs font-semibold mb-2 text-subtext">SIGNAL PERFORMANCE</div>
            <AuditReportCard report={auditAll} />
            <AuditReportCard report={auditStrict} />

            <div className="text-xs font-semibold mb-2 text-subtext mt-1">STOP LOSS ANALYSIS</div>
            <div className="rounded-xl bg-panel2 p-3 mb-3">
              <div className="grid grid-cols-2 gap-2 text-center text-xs mb-2">
                <div>
                  <div className="text-subtext">平均成功交易 MAE</div>
                  <div className="font-semibold numeric-safe">{auditAll.avgMAEWinners.toFixed(2)}%</div>
                </div>
                <div>
                  <div className="text-subtext">平均失敗交易 MAE</div>
                  <div className="font-semibold numeric-safe">{auditAll.avgMAELosers.toFixed(2)}%</div>
                </div>
                <div>
                  <div className="text-subtext">平均成功交易 MFE</div>
                  <div className="font-semibold numeric-safe">{auditAll.avgMFEWinners.toFixed(2)}%</div>
                </div>
                <div>
                  <div className="text-subtext">目前平均停損距離</div>
                  <div className="font-semibold numeric-safe">{auditAll.avgStopDistancePct.toFixed(2)}%</div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <span className="text-lg">{slVerdict.emoji}</span>
                <span className="text-xs">{slVerdict.label}</span>
              </div>
            </div>

            <div className="mb-1">
              <div className="text-xs text-subtext mb-2">資金曲線（全部技術面訊號，累積 R）</div>
              <EquityCurve rMultiples={allTrades!.map((t) => t.rMultiple)} />
            </div>

            <div className="text-[11px] text-subtext mt-2 leading-relaxed">
              TOP/WORST PERFORMING SETUPS：目前系統只有一套統一的技術面進場邏輯（趨勢+動能），還沒有拆分成多種具名策略（如突破、拉回、支撐反彈等），所以無法做策略間比較，這點誠實標註，之後如果要做可以再拆。
            </div>
          </div>
        )}
      </section>
    </main>
  );
      }
