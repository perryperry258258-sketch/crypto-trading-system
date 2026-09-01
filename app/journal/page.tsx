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
  DebugStats,
  FEE_PCT,
  SLIPPAGE_PCT,
} from "@/lib/backtest";
import {
  runTpComparisonBacktest,
  auditVariant,
  TpMode,
  TpVariantTrade,
  VariantAuditReport,
  PARTIAL_EXIT_SPLIT,
} from "@/lib/tpComparison";
import { runStrategyBacktest, buildStrategyLabResult, StrategyId, StrategyLabResult, STRATEGY_INFO } from "@/lib/strategyLab";
import {
  buildParamGrid,
  precomputeIndicators,
  runComboBacktest,
  rankCombos,
  ComboResult,
  TREND_GRID,
  MOMENTUM_GRID,
} from "@/lib/paramSearch";
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

const INTERVAL_OPTIONS: { label: string; value: "1h" | "4h" | "1d" }[] = [
  { label: "1小時線", value: "1h" },
  { label: "4小時線", value: "4h" },
  { label: "日線", value: "1d" },
];
const BARS_PER_DAY: Record<"1h" | "4h" | "1d", number> = { "1h": 24, "4h": 6, "1d": 1 };
const SEARCH_DURATION_OPTIONS: Record<"1h" | "4h" | "1d", { label: string; days: number }[]> = {
  "1h": [
    { label: "180天", days: 180 },
    { label: "365天（較久）", days: 365 },
  ],
  "4h": [
    { label: "365天", days: 365 },
    { label: "730天（約2年）", days: 730 },
  ],
  "1d": [
    { label: "730天（約2年）", days: 730 },
    { label: "1095天（約3年）", days: 1095 },
  ],
};

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

function DebugStatsPanel({ d }: { d: DebugStats }) {
  const rows: [string, number][] = [
    ["歷史K線總數", d.totalBars],
    ["有效可計算指標的K線", d.evaluatedBars],
    ["通過趨勢條件(≥65)", d.passedTrend],
    ["通過動能條件(≥65)", d.passedMomentum],
    ["通過 Opportunity ≥80", d.passedOpportunity80],
    ["通過 Entry Quality ≥75", d.passedEntryQuality75],
    ["通過 Risk ≤40", d.passedRiskLE40],
    ["通過 R:R ≥3", d.passedRR3],
    ["通過 Market Regime", d.passedRegimeOk],
    ["通過「不是追高」", d.passedNotChasing],
    ["最終A級訊號", d.finalASignals],
  ];
  return (
    <div className="space-y-1">
      {rows.map(([label, val]) => (
        <div key={label} className="flex items-center justify-between text-xs rounded-lg bg-panel px-3 py-1.5">
          <span className="text-subtext">{label}</span>
          <span className="numeric-safe font-semibold">{val.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

const TP_MODE_LABEL: Record<TpMode, string> = {
  TP1: "TP1 (1.5R)",
  TP2: "TP2 (3R)",
  TP3: "TP3 (5R)",
  PARTIAL: "分批止盈",
};

function ComparisonTable({ reports }: { reports: VariantAuditReport[] }) {
  const rows: [string, (r: VariantAuditReport) => string][] = [
    ["訊號數", (r) => r.signalCount.toString()],
    ["勝率", (r) => `${r.winRate.toFixed(1)}%`],
    ["SL先到", (r) => r.slFirst.toString()],
    ["TP1先到", (r) => r.tp1First.toString()],
    ["TP2先到", (r) => r.tp2First.toString()],
    ["TP3先到", (r) => r.tp3First.toString()],
    ["未觸發", (r) => r.timeout.toString()],
    ["平均R(期望值)", (r) => (r.expectancy >= 0 ? "+" : "") + r.expectancy.toFixed(2)],
    ["獲利因子", (r) => (r.profitFactor === Infinity ? "∞" : r.profitFactor.toFixed(2))],
    ["最大回撤", (r) => `-${r.maxDrawdownR.toFixed(2)}R`],
    ["最大連續虧損", (r) => `${r.maxConsecutiveLosses}筆`],
    ["平均持倉", (r) => `${r.avgHoldingBars.toFixed(0)}h`],
    ["平均MAE", (r) => `${r.avgMAE.toFixed(2)}%`],
    ["平均MFE", (r) => `${r.avgMFE.toFixed(2)}%`],
  ];
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[11px] border-collapse min-w-[420px]">
        <thead>
          <tr>
            <th className="text-left text-subtext font-normal px-1.5 py-1"></th>
            {reports.map((r) => (
              <th key={r.label} className="text-right font-semibold px-1.5 py-1 whitespace-nowrap">
                {r.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, fn]) => (
            <tr key={label} className="border-t border-border">
              <td className="text-subtext px-1.5 py-1.5 whitespace-nowrap">{label}</td>
              {reports.map((r) => (
                <td key={r.label} className="text-right numeric-safe px-1.5 py-1.5">
                  {fn(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CONSISTENCY_LABEL: Record<StrategyLabResult["consistent"], { emoji: string; text: string }> = {
  CONSISTENT: { emoji: "🟢", text: "前後半段方向一致（都是正的）" },
  INCONSISTENT: { emoji: "🟡", text: "前後半段方向不一致，可能是特定行情才有效，或過度配適" },
  BOTH_NEGATIVE: { emoji: "🔴", text: "前後半段一致，但都是負的" },
  TOO_FEW: { emoji: "🤷", text: "樣本太少，無法判斷是否一致" },
};

const STATUS_BADGE: Record<StrategyLabResult["status"], { emoji: string; label: string; className: string }> = {
  CANDIDATE: { emoji: "🟢", label: "候選", className: "text-bull" },
  NEED_MORE: { emoji: "🟡", label: "需要更多驗證", className: "text-warn" },
  FAILED: { emoji: "🔴", label: "淘汰", className: "text-bear" },
};

function StrategyResultCard({ r }: { r: StrategyLabResult }) {
  const c = CONSISTENCY_LABEL[r.consistent];
  const status = STATUS_BADGE[r.status];
  return (
    <div className="rounded-xl bg-panel2 p-3 mb-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-semibold">{STRATEGY_INFO[r.strategy].name}</div>
        <span className={`text-[11px] font-semibold ${status.className}`}>
          {status.emoji} {status.label}
        </span>
      </div>
      <div className="text-[10px] text-subtext mb-2">{STRATEGY_INFO[r.strategy].desc}</div>
      <div className="grid grid-cols-4 gap-2 text-center text-xs mb-2">
        <div>
          <div className="text-subtext">訊號數</div>
          <div className="font-semibold numeric-safe">{r.overall.signalCount}</div>
        </div>
        <div>
          <div className="text-subtext">平均R</div>
          <div className={`font-semibold numeric-safe ${r.overall.avgR >= 0 ? "text-bull" : "text-bear"}`}>
            {r.overall.avgR >= 0 ? "+" : ""}
            {r.overall.avgR.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-subtext">獲利因子</div>
          <div className="font-semibold numeric-safe">
            {r.overall.profitFactor === Infinity ? "∞" : r.overall.profitFactor.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-subtext">穩健度</div>
          <div className="font-semibold numeric-safe">{r.robustnessScore}/100</div>
        </div>
      </div>
      <div className="text-[10px] text-subtext mb-1">
        前半段 {r.firstHalf.signalCount}筆（{r.firstHalf.avgR >= 0 ? "+" : ""}
        {r.firstHalf.avgR.toFixed(2)}R） ・ 後半段 {r.secondHalf.signalCount}筆（{r.secondHalf.avgR >= 0 ? "+" : ""}
        {r.secondHalf.avgR.toFixed(2)}R）
      </div>
      <div className="flex items-center gap-2 pt-1.5 border-t border-border">
        <span>{c.emoji}</span>
        <span className="text-[11px]">{c.text}</span>
      </div>
    </div>
  );
}

function ComboVerdict(r: ComboResult): { emoji: string; label: string; text: string } {
  if (r.holdout.signalCount < 10) {
    return { emoji: "🤷", label: "驗證段樣本太少", text: "驗證段不足10筆，沒辦法判斷這組參數是否禁得起檢驗。" };
  }
  if (r.search.avgR > 0 && r.holdout.avgR > 0) {
    return { emoji: "🟢", label: "兩段都是正的", text: "搜尋段找到的優勢，在沒看過的驗證段依然成立，比較不像是矇到的。" };
  }
  return {
    emoji: "🔴",
    label: "驗證段沒有撐住",
    text: "搜尋段表現好，但驗證段（沒被用來挑選的資料）是負的——代表搜尋段那個「正期望值」很可能只是矇到歷史雜訊，不是真的優勢。",
  };
}

function WinnerCard({ r }: { r: ComboResult }) {
  const v = ComboVerdict(r);
  return (
    <div className="rounded-xl bg-panel2 p-3 mb-3">
      <div className="text-xs font-semibold mb-1">
        搜尋段表現最好的組合：趨勢≥{r.combo.trendMin} 且 動能≥{r.combo.momentumMin}
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="rounded-lg bg-panel p-2">
          <div className="text-[10px] text-subtext mb-1">搜尋段（前70%，挑選用）</div>
          <div className="text-xs numeric-safe">{r.search.signalCount}筆</div>
          <div className={`text-sm font-semibold numeric-safe ${r.search.avgR >= 0 ? "text-bull" : "text-bear"}`}>
            {r.search.avgR >= 0 ? "+" : ""}
            {r.search.avgR.toFixed(2)}R
          </div>
          <div className="text-[10px] text-subtext">
            PF {r.search.profitFactor === Infinity ? "∞" : r.search.profitFactor.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg bg-panel p-2">
          <div className="text-[10px] text-subtext mb-1">驗證段（後30%，沒被看過）</div>
          <div className="text-xs numeric-safe">{r.holdout.signalCount}筆</div>
          <div className={`text-sm font-semibold numeric-safe ${r.holdout.avgR >= 0 ? "text-bull" : "text-bear"}`}>
            {r.holdout.avgR >= 0 ? "+" : ""}
            {r.holdout.avgR.toFixed(2)}R
          </div>
          <div className="text-[10px] text-subtext">
            PF {r.holdout.profitFactor === Infinity ? "∞" : r.holdout.profitFactor.toFixed(2)}
          </div>
        </div>
      </div>
      <div className="flex items-start gap-2 pt-1.5 border-t border-border">
        <span className="text-base leading-none">{v.emoji}</span>
        <div>
          <div className="text-xs font-semibold">{v.label}</div>
          <div className="text-[11px] text-subtext leading-relaxed">{v.text}</div>
        </div>
      </div>
    </div>
  );
}

function LeaderboardTable({ results }: { results: ComboResult[] }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[11px] border-collapse min-w-[360px]">
        <thead>
          <tr>
            <th className="text-left text-subtext font-normal px-1.5 py-1">參數</th>
            <th className="text-right text-subtext font-normal px-1.5 py-1">搜尋段R</th>
            <th className="text-right text-subtext font-normal px-1.5 py-1">驗證段R</th>
            <th className="text-right text-subtext font-normal px-1.5 py-1">驗證段PF</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={`${r.combo.trendMin}-${r.combo.momentumMin}`} className="border-t border-border">
              <td className="px-1.5 py-1.5 whitespace-nowrap">
                T≥{r.combo.trendMin} M≥{r.combo.momentumMin}
              </td>
              <td className={`text-right numeric-safe px-1.5 py-1.5 ${r.search.avgR >= 0 ? "text-bull" : "text-bear"}`}>
                {r.search.avgR >= 0 ? "+" : ""}
                {r.search.avgR.toFixed(2)}
              </td>
              <td className={`text-right numeric-safe px-1.5 py-1.5 ${r.holdout.avgR >= 0 ? "text-bull" : "text-bear"}`}>
                {r.holdout.avgR >= 0 ? "+" : ""}
                {r.holdout.avgR.toFixed(2)}
              </td>
              <td className="text-right numeric-safe px-1.5 py-1.5">
                {r.holdout.profitFactor === Infinity ? "∞" : r.holdout.profitFactor.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const [debugTotals, setDebugTotals] = useState<DebugStats | null>(null);

  const [tpDays, setTpDays] = useState(90);
  const [tpLoading, setTpLoading] = useState(false);
  const [tpError, setTpError] = useState<string | null>(null);
  const [tpProgress, setTpProgress] = useState("");
  const [tpTrades, setTpTrades] = useState<Record<TpMode, TpVariantTrade[]> | null>(null);
  const [tpSignalCount, setTpSignalCount] = useState(0);

  const [labInterval, setLabInterval] = useState<"1h" | "4h" | "1d">("1h");
  const [labDays, setLabDays] = useState(180);
  const [labLoading, setLabLoading] = useState(false);
  const [labError, setLabError] = useState<string | null>(null);
  const [labProgress, setLabProgress] = useState("");
  const [labResults, setLabResults] = useState<StrategyLabResult[] | null>(null);

  const [searchInterval, setSearchInterval] = useState<"1h" | "4h" | "1d">("1h");
  const [searchDays, setSearchDays] = useState(365);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchProgress, setSearchProgress] = useState("");
  const [comboResults, setComboResults] = useState<ComboResult[] | null>(null);

  const lock = lockLabel[capitalState.profitLockLevel];

  const runAudit = async () => {
    setAuditLoading(true);
    setAuditError(null);
    setAllTrades(null);
    setDebugTotals(null);
    const collected: BacktestTrade[] = [];
    const debugSum: DebugStats = {
      totalBars: 0,
      evaluatedBars: 0,
      passedTrend: 0,
      passedMomentum: 0,
      passedOpportunity80: 0,
      passedEntryQuality75: 0,
      passedRiskLE40: 0,
      passedRR3: 0,
      passedRegimeOk: 0,
      passedNotChasing: 0,
      finalASignals: 0,
    };
    let successCount = 0;
    for (const symbol of AUDIT_SYMBOLS) {
      setAuditProgress(`抓取 ${symbol.replace("USDT", "")} 歷史資料中…`);
      try {
        const candles = await fetchKlinesHistory(symbol, "1h", auditDays * 24);
        if (candles.length >= 100) {
          successCount++;
          const result = runBacktest(symbol, "1h", candles);
          collected.push(...result.trades);
          (Object.keys(debugSum) as (keyof DebugStats)[]).forEach((k) => {
            debugSum[k] += result.debug[k];
          });
        }
      } catch {
        // 這個幣種抓取失敗，跳過繼續抓下一個，不要讓整個驗證中斷
      }
    }
    setAuditLoading(false);
    setAuditProgress("");
    if (successCount === 0) {
      setAuditError("所有幣種的歷史資料都抓取失敗，請檢查網路連線後再試一次");
      return;
    }
    // 即使 collected 是空陣列（這段期間剛好一筆訊號都沒有），也是誠實的結果，不當成錯誤
    setAllTrades(collected);
    setDebugTotals(debugSum);
  };

  // runBacktest() 內部已經直接呼叫跟 production 相同的 buildOpportunity()，
  // 回傳的 trades 陣列本身就只包含真正判定為 A/S 級的訊號，這裡不需要再另外篩選一次。
  const aGradeTrades = allTrades;
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
  if (aGradeTrades) {
    const sorted = [...aGradeTrades].sort((a, b) => a.entryTime - b.entryTime);
    const mid = Math.floor(sorted.length / 2);
    inSample = auditTrades(sorted.slice(0, mid), "樣本內（前半段）");
    outOfSample = auditTrades(sorted.slice(mid), "樣本外（後半段，Out-of-Sample）");
  }

  const grade = overall ? gradeStrategy(overall, outOfSample) : null;

  const runTpComparison = async () => {
    setTpLoading(true);
    setTpError(null);
    setTpTrades(null);
    setTpSignalCount(0);
    const merged: Record<TpMode, TpVariantTrade[]> = { TP1: [], TP2: [], TP3: [], PARTIAL: [] };
    let signalTotal = 0;
    let successCount = 0;
    for (const symbol of AUDIT_SYMBOLS) {
      setTpProgress(`抓取 ${symbol.replace("USDT", "")} 歷史資料中…`);
      try {
        const candles = await fetchKlinesHistory(symbol, "1h", tpDays * 24);
        if (candles.length >= 100) {
          successCount++;
          const result = runTpComparisonBacktest(symbol, "1h", candles);
          signalTotal += result.signalCount;
          (Object.keys(merged) as TpMode[]).forEach((m) => {
            merged[m].push(...result.variants[m]);
          });
        }
      } catch {
        // 這個幣種抓取失敗，跳過繼續抓下一個
      }
    }
    setTpLoading(false);
    setTpProgress("");
    if (successCount === 0) {
      setTpError("所有幣種的歷史資料都抓取失敗，請檢查網路連線後再試一次");
      return;
    }
    setTpTrades(merged);
    setTpSignalCount(signalTotal);
  };

  const tpReports: VariantAuditReport[] | null = tpTrades
    ? (["TP1", "TP2", "TP3", "PARTIAL"] as TpMode[]).map((m) => auditVariant(tpTrades[m], TP_MODE_LABEL[m]))
    : null;

  const STRATEGIES: StrategyId[] = ["MOMENTUM", "PULLBACK", "MEANREV", "BREAKOUT", "BREAKOUT_RETEST", "VOL_EXPANSION"];

  const runStrategyLab = async () => {
    setLabLoading(true);
    setLabError(null);
    setLabResults(null);
    const tradesByStrategy: Record<StrategyId, TpVariantTrade[]> = {
      MOMENTUM: [],
      PULLBACK: [],
      MEANREV: [],
      BREAKOUT: [],
      BREAKOUT_RETEST: [],
      VOL_EXPANSION: [],
    };
    let successCount = 0;
    for (const symbol of AUDIT_SYMBOLS) {
      setLabProgress(`抓取 ${symbol.replace("USDT", "")} 歷史資料中…`);
      try {
        const candles = await fetchKlinesHistory(symbol, labInterval, labDays * BARS_PER_DAY[labInterval]);
        if (candles.length >= 100) {
          successCount++;
          STRATEGIES.forEach((s) => {
            tradesByStrategy[s].push(...runStrategyBacktest(s, symbol, candles));
          });
        }
      } catch {
        // 跳過失敗的幣種
      }
    }
    setLabLoading(false);
    setLabProgress("");
    if (successCount === 0) {
      setLabError("所有幣種的歷史資料都抓取失敗，請檢查網路連線後再試一次");
      return;
    }
    const built = STRATEGIES.map((s) => buildStrategyLabResult(s, tradesByStrategy[s]));
    built.sort((a, b) => b.robustnessScore - a.robustnessScore);
    setLabResults(built);
  };

  const handleLabIntervalChange = (v: "1h" | "4h" | "1d") => {
    setLabInterval(v);
    setLabDays(SEARCH_DURATION_OPTIONS[v][0].days);
  };

  const runParamSearch = async () => {
    setSearchLoading(true);
    setSearchError(null);
    setComboResults(null);
    const grid = buildParamGrid();
    const perCombo: Record<string, { search: TpVariantTrade[]; holdout: TpVariantTrade[] }> = {};
    grid.forEach((c) => {
      perCombo[`${c.trendMin}-${c.momentumMin}`] = { search: [], holdout: [] };
    });
    let successCount = 0;
    for (const symbol of AUDIT_SYMBOLS) {
      setSearchProgress(`抓取 ${symbol.replace("USDT", "")} 歷史資料中…`);
      try {
        const candles = await fetchKlinesHistory(symbol, searchInterval, searchDays * BARS_PER_DAY[searchInterval]);
        if (candles.length >= 200) {
          successCount++;
          const closes = candles.map((c) => c.close);
          const barIndicators = precomputeIndicators(closes);
          const splitIdx = Math.floor(candles.length * 0.7);
          grid.forEach((combo) => {
            const key = `${combo.trendMin}-${combo.momentumMin}`;
            const searchTrades = runComboBacktest(combo, symbol, candles, closes, barIndicators, 0, splitIdx);
            const holdoutTrades = runComboBacktest(combo, symbol, candles, closes, barIndicators, splitIdx, candles.length);
            perCombo[key].search.push(...searchTrades);
            perCombo[key].holdout.push(...holdoutTrades);
          });
        }
      } catch {
        // 跳過失敗的幣種
      }
    }
    setSearchLoading(false);
    setSearchProgress("");
    if (successCount === 0) {
      setSearchError("所有幣種的歷史資料都抓取失敗，請檢查網路連線後再試一次");
      return;
    }
    const results: ComboResult[] = grid.map((combo) => {
      const key = `${combo.trendMin}-${combo.momentumMin}`;
      return {
        combo,
        search: auditVariant(perCombo[key].search, `T≥${combo.trendMin} M≥${combo.momentumMin}`),
        holdout: auditVariant(perCombo[key].holdout, "驗證段"),
      };
    });
    setComboResults(results);
  };

  const ranked = comboResults ? rankCombos(comboResults) : null;
  const winner = ranked && ranked.length > 0 ? ranked[0] : null;
  const top5 = ranked ? ranked.slice(0, 5) : null;

  const handleIntervalChange = (v: "1h" | "4h" | "1d") => {
    setSearchInterval(v);
    setSearchDays(SEARCH_DURATION_OPTIONS[v][0].days);
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
          個主流幣種的 1小時K線，在「當時」直接呼叫跟 production 完全相同的判斷函式（Opportunity Score≥80 且 Entry
          Quality≥75 且 Risk Score≤40 且 R:R≥3 且 Market Regime允許 且 不是追高），進場價用訊號下一根K棒的開盤價，手續費{" "}
          {FEE_PCT}% + 滑價 {SLIPPAGE_PCT}% 已扣除。
        </div>
        <details className="text-[11px] text-subtext mb-3">
          <summary className="cursor-pointer select-none">這份驗證沒做到什麼（誠實揭露）▾</summary>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>只抓最多 365 天（不是 2-5 年）——手機瀏覽器長時間連續請求容易中斷，這是誠實的上限</li>
            <li>沒有分 Setup（突破／回踩／拉回等）統計——系統目前只有一套統一規則，沒有具名策略分類器</li>
            <li>沒有 ADX、VWAP 指標——系統尚未實作，不假造</li>
            <li>沒有 Funding Rate、Open Interest 資料——歷史上不易取得，不假造，不列入評分</li>
            <li>恐慌貪婪指數歷史上無法還原，一律視為 null（跟 production 沒有情緒面資料時的行為一致）</li>
            <li>Walk-Forward 簡化為「前半段／後半段」比較，不是完整的三段訓練/驗證/樣本外切分</li>
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

            {/* Debug Statistics */}
            {debugTotals && (
              <details className="mb-3">
                <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                  Debug Statistics（逐關卡篩選數字）▾
                </summary>
                <DebugStatsPanel d={debugTotals} />
              </details>
            )}

            <div className="text-xs font-semibold mb-2 text-subtext">總覽</div>
            {overall.totalSignals === 0 ? (
              <div className="rounded-xl bg-panel2 p-4 text-center text-sm text-subtext mb-3">
                目前沒有產生足夠的A級歷史訊號，無法驗證策略。展開上面的 Debug Statistics 可以看到是哪一關卡把訊號篩掉的。
              </div>
            ) : (
              <AuditReportCard report={overall} />
            )}

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

      {/* TP結構比較回測 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">⚖️ TP結構比較回測</div>
        <div className="text-xs text-subtext mb-2 leading-relaxed">
          R:R稽核發現：TP1 固定 1.5R，跟「R:R≥3」代數上互斥，導致 A 級恆為 0 筆。這裡不套用 R:R≥3 這道門檻，直接對「Opportunity
          Score≥80」的訊號（Entry/Stop/訊號條件完全相同），平行比較四種出場方案：TP1(1.5R)、TP2(3R)、TP3(5R)、分批止盈（
          {(PARTIAL_EXIT_SPLIT.tp1 * 100).toFixed(0)}% / {(PARTIAL_EXIT_SPLIT.tp2 * 100).toFixed(0)}% /{" "}
          {(PARTIAL_EXIT_SPLIT.tp3 * 100).toFixed(0)}%，這組比例是參數，不是宣稱最佳）。
        </div>
        <div className="text-[11px] text-warn mb-3 leading-relaxed">
          ⚠️ 不要只看勝率選最好的方案——勝率高但賠得比賺得多，長期還是虧錢。請優先比較「平均R(期望值)」「獲利因子」「最大回撤」。
          結果出來後我不會自動幫你選一個當正式策略，要你自己決定。
        </div>

        <div className="mb-3">
          <label className="text-xs text-subtext mb-1 block">回測期間</label>
          <select
            value={tpDays}
            onChange={(e) => setTpDays(Number(e.target.value))}
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
          onClick={runTpComparison}
          disabled={tpLoading}
          className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-3"
        >
          {tpLoading ? tpProgress || "執行中…" : "執行TP結構比較回測"}
        </button>

        {tpError && <div className="text-xs text-warn mb-2">⚠️ {tpError}</div>}

        {tpReports && (
          <div>
            <div className="text-xs text-subtext mb-2">
              共 {tpSignalCount} 筆 Opportunity≥80 訊號（未套用 R:R 門檻），四個方案在同一組訊號上比較：
            </div>
            <ComparisonTable reports={tpReports} />
            <div className="text-[11px] text-subtext mt-3 leading-relaxed">
              SL先到／TP1先到／TP2先到／TP3先到 是分開計算的觸價統計，不是彼此互斥的百分比加總（分批止盈方案一筆交易可能同時計入TP1先到與TP2先到，因為兩個目標都有部分出場）。
            </div>
          </div>
        )}
      </section>

      {/* 進場邏輯比較實驗室 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">🧪 進場邏輯比較實驗室</div>
        <div className="text-xs text-subtext mb-2 leading-relaxed">
          比較六種邏輯上明顯不同的進場方式：動能追蹤、回踩確認、均值回歸、突破、突破+回踩確認、波動擴張。全部先固定用 TP2(3R)
          當出場基準（TP基準尚未定案，之後可以重測）。
        </div>
        <div className="text-[11px] text-warn mb-3 leading-relaxed">
          ⚠️ 測試好幾種策略、挑歷史表現最好的那個，本身就是統計陷阱（data
          snooping）。「穩健度分數」是把樣本數／獲利因子／期望值／前後半段一致性這幾項濃縮成一個排序參考，不是有效性認證——真正代表意義的是下面的完整數字，不是那個分數本身。
        </div>

        <div className="mb-3">
          <label className="text-xs text-subtext mb-1 block">K線週期</label>
          <select
            value={labInterval}
            onChange={(e) => handleLabIntervalChange(e.target.value as "1h" | "4h" | "1d")}
            className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm"
            style={{ minHeight: 44 }}
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3">
          <label className="text-xs text-subtext mb-1 block">回測期間</label>
          <select
            value={labDays}
            onChange={(e) => setLabDays(Number(e.target.value))}
            className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm"
            style={{ minHeight: 44 }}
          >
            {SEARCH_DURATION_OPTIONS[labInterval].map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={runStrategyLab}
          disabled={labLoading}
          className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-3"
        >
          {labLoading ? labProgress || "執行中…（6種策略，會比較久）" : "執行進場邏輯比較"}
        </button>

        {labError && <div className="text-xs text-warn mb-2">⚠️ {labError}</div>}

        {labResults && (
          <div>
            <div className="text-xs text-subtext mb-3">
              已測策略：{labResults.length} ・ 候選：
              <span className="text-bull">{labResults.filter((r) => r.status === "CANDIDATE").length}</span> ・ 需要更多驗證：
              <span className="text-warn">{labResults.filter((r) => r.status === "NEED_MORE").length}</span> ・ 淘汰：
              <span className="text-bear">{labResults.filter((r) => r.status === "FAILED").length}</span>
              （已依穩健度分數排序）
            </div>
            {labResults.map((r) => (
              <StrategyResultCard key={r.strategy} r={r} />
            ))}
            <div className="text-[11px] text-subtext leading-relaxed">
              「前後半段方向一致」不代表這個策略一定有效，只代表它不是單純運氣好——這是最低限度的健檢，不是及格證明。任何策略要真的拿來用，都建議先進到「模擬交易」跑一段時間，累積真正的即時資料再決定。
            </div>
          </div>
        )}
      </section>

      {/* 參數網格搜尋（訓練/測試分離） */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">🔬 參數搜尋（訓練/測試分離）</div>
        <div className="text-xs text-subtext mb-2 leading-relaxed">
          把每個幣種的資料切成「搜尋段」（前70%）跟「驗證段」（後30%，完全不參與挑選）。在搜尋段裡嘗試 {TREND_GRID.length}×
          {MOMENTUM_GRID.length} = {TREND_GRID.length * MOMENTUM_GRID.length}
          種趨勢／動能門檻組合，挑出搜尋段表現最好的一組，最後只用完全沒被看過的驗證段重新檢驗一次。TP固定用TP2(3R)。
        </div>
        <div className="text-[11px] text-warn mb-3 leading-relaxed">
          ⚠️ 只有「搜尋段」跟「驗證段」都是正的，才代表這組參數可能是真的優勢；如果驗證段是負的，代表搜尋段那個「正期望值」只是矇到歷史雜訊。建議至少選 365
          天，資料太少切完兩段會不夠用。
        </div>
        <details className="text-[11px] text-subtext mb-3">
          <summary className="cursor-pointer select-none">切換K線週期會改變什麼（誠實揭露）▾</summary>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>最大持倉時間固定是200根K棒——1小時線約8天，4小時線約33天，日線則是200天，週期越大代表允許抱越久，這是自動跟著變的，不是刻意調整</li>
            <li>4小時線／日線需要更長的天數才能累積到足夠的K棒數量，已經自動調整成對應天數的選項</li>
            <li>日線資料下載反而比1小時線快，因為總根數少很多</li>
          </ul>
        </details>

        <div className="mb-3">
          <label className="text-xs text-subtext mb-1 block">K線週期</label>
          <select
            value={searchInterval}
            onChange={(e) => handleIntervalChange(e.target.value as "1h" | "4h" | "1d")}
            className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm"
            style={{ minHeight: 44 }}
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3">
          <label className="text-xs text-subtext mb-1 block">回測期間</label>
          <select
            value={searchDays}
            onChange={(e) => setSearchDays(Number(e.target.value))}
            className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm"
            style={{ minHeight: 44 }}
          >
            {SEARCH_DURATION_OPTIONS[searchInterval].map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={runParamSearch}
          disabled={searchLoading}
          className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-3"
        >
          {searchLoading ? searchProgress || "執行中…（25組參數，會比較久）" : "執行參數搜尋"}
        </button>

        {searchError && <div className="text-xs text-warn mb-2">⚠️ {searchError}</div>}

        {winner && top5 && (
          <div>
            <div className="text-xs font-semibold mb-2 text-subtext">
              搜尋結果（{INTERVAL_OPTIONS.find((o) => o.value === searchInterval)?.label}・{searchDays}天）
            </div>
            <WinnerCard r={winner} />
            <details className="mb-1">
              <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                搜尋段前5名排行榜（含驗證段對照）▾
              </summary>
              <LeaderboardTable results={top5} />
            </details>
          </div>
        )}

        {comboResults && !winner && (
          <div className="rounded-xl bg-panel2 p-4 text-center text-sm text-subtext">
            沒有任何一組參數在搜尋段累積到 20 筆以上的訊號，樣本太少，這次搜尋沒有可靠結果。
          </div>
        )}
      </section>
    </main>
  );
}
