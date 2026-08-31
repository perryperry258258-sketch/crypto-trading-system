"use client";

import { useState } from "react";
import { useMarketData } from "@/lib/useMarketData";
import { fetchKlinesHistory } from "@/lib/binance";
import {
  runBacktest,
  auditTrades,
  stopLossVerdict,
  gradeStrategy,
  BacktestTrade,
  SignalAuditReport,
  FEE_PCT,
  SLIPPAGE_PCT,
} from "@/lib/backtest";
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
const DURATION_OPTIONS = [
  { label: "90天", days: 90 },
  { label: "180天", days: 180 },
  { label: "365天（較久，建議保持螢幕開啟）", days: 365 },
];

function fmt(n: number) {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

function MiniRow({ label, report }: { label: string; report: SignalAuditReport }) {
  return (
    <div className="flex items-center justify-between text-xs rounded-lg bg-panel px-3 py-2">
      <span className="font-medium w-14 shrink-0">{label}</span>
      <span className="text-subtext">{report.totalSignals}筆</span>
      <span className="numeric-safe">{report.winRate.toFixed(0)}%勝率</span>
      <span className="numeric-safe">
        PF {report.profitFactor === Infinity ? "∞" : report.profitFactor.toFixed(2)}
      </span>
    </div>
  );
}

function AuditReportCard({ report }: { report: SignalAuditReport }) {
  return (
    <div className="rounded-xl bg-panel2 p-3 mb-3">
      <div className="text-xs font-semibold mb-2">{report.label}</div>

      <div className="rounded-lg bg-panel p-2 mb-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-subtext">已完成交易勝率</span>
          <span className="font-semibold numeric-safe text-base">{report.winRate.toFixed(1)}%</span>
        </div>
        <div className="text-[10px] text-subtext numeric-safe">
          {report.tpFirst} / {report.completedTrades}（達標 TP / 已完成交易）
        </div>
        <div className="text-[10px] text-subtext mt-1">未完成交易（尚未觸發）：{report.timeout} 筆</div>
        <div className="text-[10px] text-subtext mt-0.5">勝率只計算已完成交易，不包含尚未觸發的訊號。</div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs mb-2">
        <div>
          <div className="text-subtext">總訊號數</div>
          <div className="font-semibold numeric-safe">{report.totalSignals}</div>
        </div>
        <div>
          <div className="text-subtext">達標(TP)</div>
          <div className="font-semibold numeric-safe text-bull">{report.tpFirst}</div>
        </div>
        <div>
          <div className="text-subtext">停損(SL)</div>
          <div className="font-semibold numeric-safe text-bear">{report.slFirst}</div>
        </div>
        <div>
          <div className="text-subtext">期望值（Expectancy）</div>
          <div className={`font-semibold numeric-safe ${report.expectancy >= 0 ? "text-bull" : "text-bear"}`}>
            {report.expectancy >= 0 ? "+" : ""}
            {report.expectancy.toFixed(2)}R
          </div>
        </div>
        <div>
          <div className="text-subtext">獲利因子</div>
          <div className="font-semibold numeric-safe">
            {report.profitFactor === Infinity ? "∞" : report.profitFactor.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-subtext">最大回撤</div>
          <div className="font-semibold numeric-safe text-bear">-{report.maxDrawdownR.toFixed(2)}R</div>
        </div>
        <div>
          <div className="text-subtext">最大連續虧損</div>
          <div className="font-semibold numeric-safe text-bear">{report.maxConsecutiveLosses} 筆</div>
        </div>
        <div>
          <div className="text-subtext">平均到停損</div>
          <div className="font-semibold numeric-safe">{report.avgTimeToSLHours.toFixed(0)}h</div>
        </div>
        <div>
          <div className="text-subtext">平均到達標</div>
          <div className="font-semibold numeric-safe">{report.avgTimeToTPHours.toFixed(0)}h</div>
        </div>
      </div>
    </div>
  );
}

export default function JournalPage() {
  const { capitalState, paperOpen, paperClosed, paperStats, coins } = useMarketData();
  const [auditDays, setAuditDays] = useState(180);
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
        const candles = await fetchKlinesHistory(symbol, "1h", auditDays * 24);
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

  // 這份規格書定義的「A級」＝ Entry Quality≥75 且 R:R≥3（qualifiesAsA）。
  // Opportunity Score / Risk Score 的完整門檻無法在歷史回測中 100% 還原（即時系統那兩項
  // 依賴當下的市場面/情緒面/24H真實成交額，歷史上補不回去），這點誠實揭露在下面的說明區塊。
  const aGradeTrades = allTrades ? allTrades.filter((t) => t.qualifiesAsA) : null;
  const overall = aGradeTrades ? auditTrades(aGradeTrades, "全部A級訊號") : null;

  const perSymbol = aGradeTrades
    ? AUDIT_SYMBOLS.map((s) =>
        auditTrades(
          aGradeTrades.filter((t) => t.symbol === s),
          s.replace("USDT", "")
        )
      )
    : null;

  const perRegime = aGradeTrades
    ? (["BULL", "BEAR", "SIDEWAYS"] as const).map((r) =>
        auditTrades(
          aGradeTrades.filter((t) => t.regimeApprox === r),
          r
        )
      )
    : null;

  let inSample: SignalAuditReport | null = null;
  let outOfSample: SignalAuditReport | null = null;
  if (aGradeTrades && aGradeTrades.length > 0) {
    const sorted = [...aGradeTrades].sort((a, b) => a.entryTime - b.entryTime);
    const mid = Math.floor(sorted.length / 2);
    inSample = auditTrades(sorted.slice(0, mid), "樣本內（前半段）");
    outOfSample = auditTrades(sorted.slice(mid), "樣本外（後半段，Out-of-Sample）");
  }

  const grade = overall ? gradeStrategy(overall, outOfSample) : null;

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
          系統偵測到 S/A 級機會會自動開立模擬部位，不動用真錢。只認「碰到達標(TP1)」或「碰到停損」兩種結果。
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
                <div className="text-xs text-subtext">平均報酬（R）</div>
                <div className={`font-semibold numeric-safe ${paperStats.avgR >= 0 ? "text-bull" : "text-bear"}`}>
                  {paperStats.avgR.toFixed(2)}
                </div>
              </div>
              <div className="rounded-xl bg-panel2 p-3">
                <div className="text-xs text-subtext">獲利因子</div>
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
                    {t.result === "WIN" ? "✅ 達標" : "🛑 停損"}
                  </span>
                  <span className="numeric-safe">{t.rMultiple.toFixed(2)}R</span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* A級策略歷史驗證 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">🏆 A級策略歷史驗證</div>
        <div className="text-xs text-subtext mb-2 leading-relaxed">
          資料來源：Binance Historical Klines（不是 Mock/Sample/Demo/Static/Hardcoded）。用 {AUDIT_SYMBOLS.length}{" "}
          個主流幣種的 1小時K線，重新在「當時」計算指標與 A 級條件（Entry Quality≥75 且 R:R≥3），進場價用訊號下一根K棒的開盤價，手續費 {FEE_PCT}% + 滑價 {SLIPPAGE_PCT}%
          已扣除。
        </div>
        <details className="text-[11px] text-subtext mb-3">
          <summary className="cursor-pointer select-none">這份驗證沒做到什麼（誠實揭露）▾</summary>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>只抓最多 365 天（不是 2-5 年）——手機瀏覽器長時間連續請求容易中斷，這是誠實的上限</li>
            <li>沒有分 Setup（突破／回踩／拉回等）統計——系統目前只有一套統一規則，沒有具名策略分類器</li>
            <li>沒有 ADX、VWAP 指標——系統尚未實作，不假造</li>
            <li>沒有 Funding Rate、Open Interest 資料——歷史上不易取得，不假造，不列入評分</li>
            <li>市場環境（BULL/BEAR/SIDEWAYS）用當時的趨勢分數概略判斷，跟即時系統用恐慌貪婪指數的判斷方式不完全相同</li>
            <li>Walk-Forward 簡化為「前半段／後半段」比較，不是完整的三段訓練/驗證/樣本外切分</li>
            <li>Opportunity Score／Risk Score 無法完整還原（依賴即時才有的市場面資料），A級判定只用 Entry Quality 與 R:R 兩項近似</li>
          </ul>
        </details>

        <div className="mb-3">
          <label className="text-xs text-subtext mb-1 block">回測期間</label>
          <select
            value={auditDays}
            onChange={(e) => setAuditDays(Number(e.target.value))}
            className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm"
            style={{ minHeight: 44 }}
          >
            {DURATION_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={runAudit}
          disabled={auditLoading}
          className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-3"
        >
          {auditLoading ? auditProgress || "執行中…" : "執行完整驗證"}
        </button>

        {auditError && <div className="text-xs text-warn mb-2">⚠️ {auditError}</div>}

        {overall && grade && perSymbol && perRegime && inSample && outOfSample && (
          <div>
            {/* 最終判定 */}
            <div className="rounded-xl bg-panel2 p-3 mb-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{grade.emoji}</span>
                <span className="text-sm font-semibold">{grade.label}</span>
              </div>
              <div className="text-xs text-text leading-relaxed">{grade.desc}</div>
            </div>

            <div className="text-xs font-semibold mb-2 text-subtext">總覽</div>
            <AuditReportCard report={overall} />

            {/* 分幣種 */}
            <details className="mb-3">
              <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                分幣種結果（{AUDIT_SYMBOLS.length}個）▾
              </summary>
              <div className="space-y-1.5">
                {perSymbol.map((r) => (
                  <MiniRow key={r.label} label={r.label} report={r} />
                ))}
              </div>
            </details>

            {/* 分市場環境 */}
            <details className="mb-3">
              <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                分市場環境結果 ▾
              </summary>
              <div className="space-y-1.5">
                {perRegime.map((r) => (
                  <MiniRow key={r.label} label={r.label} report={r} />
                ))}
              </div>
            </details>

            {/* 樣本內 vs 樣本外 */}
            <div className="text-xs font-semibold mb-2 text-subtext">樣本內／樣本外比較</div>
            <MiniRow label="樣本內" report={inSample} />
            <div className="h-1.5" />
            <MiniRow label="樣本外" report={outOfSample} />

            {/* 停損分析 */}
            <div className="text-xs font-semibold mb-2 text-subtext mt-3">停損分析</div>
            <div className="rounded-xl bg-panel2 p-3 mb-3">
              <div className="grid grid-cols-2 gap-2 text-center text-xs mb-2">
                <div>
                  <div className="text-subtext">成功交易最大不利波動（MAE）</div>
                  <div className="font-semibold numeric-safe">{overall.avgMAEWinners.toFixed(2)}%</div>
                </div>
                <div>
                  <div className="text-subtext">失敗交易最大不利波動（MAE）</div>
                  <div className="font-semibold numeric-safe">{overall.avgMAELosers.toFixed(2)}%</div>
                </div>
                <div>
                  <div className="text-subtext">成功交易最大有利波動（MFE）</div>
                  <div className="font-semibold numeric-safe">{overall.avgMFEWinners.toFixed(2)}%</div>
                </div>
                <div>
                  <div className="text-subtext">目前平均停損距離</div>
                  <div className="font-semibold numeric-safe">{overall.avgStopDistancePct.toFixed(2)}%</div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <span className="text-lg">{stopLossVerdict(overall).emoji}</span>
                <span className="text-xs">{stopLossVerdict(overall).label}</span>
              </div>
            </div>

            <div className="mb-1">
              <div className="text-xs text-subtext mb-2">資金曲線（A級訊號，累積報酬 R）</div>
              <EquityCurve rMultiples={aGradeTrades!.map((t) => t.rMultiple)} />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
