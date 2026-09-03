"use client";

import { useState } from "react";
import { useMarketData } from "@/lib/useMarketData";
import { fetchKlinesHistory, fetchKlines, Candle } from "@/lib/binance";
import { runMonteCarlo, MonteCarloResult } from "@/lib/monteCarlo";
import {
  runVolumeBreakoutEventStudy,
  auditVolumeBreakout,
  toRetestReport,
  VolumeBreakoutEvent,
  VolumeBreakoutReport,
  VOLUME_RATIO_BINS,
  CLV_BINS,
  RETEST_ZONE_OPTIONS,
} from "@/lib/volumeBreakoutLab";
import {
  runRetestStrategyBacktest,
  auditRetestStrategy,
  splitTrainValOOS,
  RetestTrade,
  RetestStrategyReport,
} from "@/lib/retestStrategyLab";
import { evaluateLiveSignal, STATE_INFO, LiveSignal } from "@/lib/retestEngine";
import {
  upsertFromLiveSignal,
  loadSignalRecords,
  auditSignalRecords,
  saveOosSummary,
  loadOosSummary,
  saveOosTrades,
  loadOosTrades,
  SignalRecord,
  PaperReport,
} from "@/lib/signalLog";
import { runGrowthSimulation, GrowthSimResult } from "@/lib/growthSimulator";
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
const CB_DURATION_OPTIONS = [
  { label: "90天", days: 90 },
  { label: "180天（半年）", days: 180 },
  { label: "365天（1年）", days: 365 },
  { label: "730天（2年，非常久，務必保持螢幕開啟）", days: 730 },
];
const CB_WINDOW_OPTIONS: { label: string; value: 30 | 60 | 90 | 120 }[] = [
  { label: "30分鐘", value: 30 },
  { label: "60分鐘", value: 60 },
  { label: "90分鐘", value: 90 },
  { label: "120分鐘", value: 120 },
];
const OOS_TP = 1; // 暫定正式交易版本：TP=1R，風險調整後最合理（詳見對話紀錄）

function VolumeBreakoutCard({ r }: { r: VolumeBreakoutReport }) {
  return (
    <div className="rounded-xl bg-panel2 p-3 mb-3">
      <div className="text-xs font-semibold mb-2">
        {r.label}（{r.eventCount}個事件，平均量比 {r.avgVolumeRatio.toFixed(2)}x）
      </div>
      <div className="text-[10px] text-subtext mb-1">假突破率</div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs mb-2">
        <div>
          <div className="text-subtext">15分內</div>
          <div className="font-semibold numeric-safe">{r.falseBreakoutRate15.toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-subtext">30分內</div>
          <div className="font-semibold numeric-safe">{r.falseBreakoutRate30.toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-subtext">1H內</div>
          <div className="font-semibold numeric-safe">{r.falseBreakoutRate60.toFixed(1)}%</div>
        </div>
      </div>
      <div className="text-[10px] text-subtext mb-1">4小時內達到指定幅度的機率（1%機率附95%信賴區間）</div>
      <div className="grid grid-cols-5 gap-1 text-center text-[11px] mb-2">
        <div>
          <div className="text-subtext">0.25%</div>
          <div className="font-semibold numeric-safe">{r.achieved025Rate.toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-subtext">0.5%</div>
          <div className="font-semibold numeric-safe">{r.achieved05Rate.toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-subtext">1%</div>
          <div className="font-semibold numeric-safe">{r.achieved1Rate.toFixed(0)}%</div>
          <div className="text-[9px] text-subtext">
            [{r.achieved1RateCI[0].toFixed(0)}~{r.achieved1RateCI[1].toFixed(0)}]
          </div>
        </div>
        <div>
          <div className="text-subtext">2%</div>
          <div className="font-semibold numeric-safe">{r.achieved2Rate.toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-subtext">3%</div>
          <div className="font-semibold numeric-safe">{r.achieved3Rate.toFixed(0)}%</div>
        </div>
      </div>
      <div className="text-[10px] text-subtext mb-1">最大有利波動MFE／最大不利波動MAE（平均，%）</div>
      <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
        <div>
          <div className="text-subtext">30分</div>
          <div className="numeric-safe text-bull">{r.avgMfe30.toFixed(2)}</div>
          <div className="numeric-safe text-bear">{r.avgMae30.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-subtext">1H</div>
          <div className="numeric-safe text-bull">{r.avgMfe60.toFixed(2)}</div>
          <div className="numeric-safe text-bear">{r.avgMae60.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-subtext">2H</div>
          <div className="numeric-safe text-bull">{r.avgMfe120.toFixed(2)}</div>
          <div className="numeric-safe text-bear">{r.avgMae120.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-subtext">4H</div>
          <div className="numeric-safe text-bull">{r.avgMfe240.toFixed(2)}</div>
          <div className="numeric-safe text-bear">{r.avgMae240.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}

function VolumeBreakoutMiniRow({ r }: { r: VolumeBreakoutReport }) {
  return (
    <div className="flex items-center justify-between text-xs rounded-lg bg-panel px-3 py-2">
      <span className="font-medium w-20 shrink-0">{r.label}</span>
      <span className="text-subtext">{r.eventCount}個</span>
      <span className="numeric-safe">假突破{r.falseBreakoutRate30.toFixed(0)}%</span>
      <span className="numeric-safe">達1% {r.achieved1Rate.toFixed(0)}%</span>
    </div>
  );
}

function MonteCarloCard({ m }: { m: MonteCarloResult }) {
  return (
    <div className="rounded-xl bg-panel2 p-3 mb-3">
      <div className="text-xs font-semibold mb-1">
        蒙地卡羅重排（{m.simulations.toLocaleString()}次，{m.tradeCount}筆交易重新洗牌順序）
      </div>
      <div className="text-[10px] text-subtext mb-2 leading-relaxed">
        歷史剛好發生的順序只是眾多可能之一。這裡把同一批交易的順序重排很多次，看最大回撤的分布範圍——不會改變策略本身有沒有效，只回答「回撤風險大概多大」。
      </div>
      <div className="grid grid-cols-2 gap-2 text-center text-xs">
        <div>
          <div className="text-subtext">歷史實際回撤</div>
          <div className="font-semibold numeric-safe text-bear">-{m.historicalDrawdownR.toFixed(2)}R</div>
        </div>
        <div>
          <div className="text-subtext">中位數回撤(50%)</div>
          <div className="font-semibold numeric-safe text-bear">-{m.p50DrawdownR.toFixed(2)}R</div>
        </div>
        <div>
          <div className="text-subtext">樂觀情境(5%)</div>
          <div className="font-semibold numeric-safe text-bear">-{m.p5DrawdownR.toFixed(2)}R</div>
        </div>
        <div>
          <div className="text-subtext">悲觀情境(95%)</div>
          <div className="font-semibold numeric-safe text-bear">-{m.p95DrawdownR.toFixed(2)}R</div>
        </div>
      </div>
      <div className="text-[10px] text-subtext mt-2">
        最壞情況（{m.simulations.toLocaleString()}次裡最差的一次）：-{m.worstDrawdownR.toFixed(2)}R
      </div>
    </div>
  );
}

function RetestStrategyCard({ r }: { r: RetestStrategyReport }) {
  return (
    <div className="rounded-xl bg-panel2 p-3 mb-3">
      <div className="text-xs font-semibold mb-2">{r.label}</div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs mb-2">
        <div>
          <div className="text-subtext">訊號數</div>
          <div className="font-semibold numeric-safe">{r.tradeCount}</div>
        </div>
        <div>
          <div className="text-subtext">勝率</div>
          <div className="font-semibold numeric-safe">{r.winRate.toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-subtext">期望值</div>
          <div className={`font-semibold numeric-safe ${r.expectancy >= 0 ? "text-bull" : "text-bear"}`}>
            {r.expectancy >= 0 ? "+" : ""}
            {r.expectancy.toFixed(2)}R
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <div className="text-subtext">獲利因子</div>
          <div className="font-semibold numeric-safe">
            {r.profitFactor === Infinity ? "∞" : r.profitFactor.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-subtext">最大回撤</div>
          <div className="font-semibold numeric-safe text-bear">-{r.maxDrawdownR.toFixed(2)}R</div>
        </div>
        <div>
          <div className="text-subtext">最大連續虧損</div>
          <div className="font-semibold numeric-safe text-bear">{r.maxConsecutiveLosses}筆</div>
        </div>
      </div>
    </div>
  );
}

function OosVerdict(train: RetestStrategyReport, val: RetestStrategyReport, oos: RetestStrategyReport): {
  emoji: string;
  label: string;
  text: string;
} {
  if (oos.tradeCount < 30) {
    return { emoji: "🟡", label: "樣本不足", text: "樣本外樣本數不足30筆，還無法可靠判斷。" };
  }
  if (train.expectancy > 0 && val.expectancy > 0 && oos.expectancy > 0) {
    return {
      emoji: "🟢",
      label: "已通過樣本外驗證",
      text: "訓練段、驗證段、樣本外段三段都是正期望值，樣本外段完全沒被用來挑選或調整過任何條件。",
    };
  }
  return {
    emoji: "🔴",
    label: "樣本外驗證未通過",
    text: "訓練段/驗證段看起來正的部分，在完全沒看過的樣本外段沒有撐住，代表訓練段的正期望值可能只是矇到歷史雜訊。",
  };
}

function EngineStatusBanner({ signals }: { signals: LiveSignal[] }) {
  const staleCount = signals.filter((s) => s.state === "DATA_STALE").length;
  const activeCount = signals.filter((s) => s.state === "RETEST_CONFIRMED").length;
  if (staleCount > 0) {
    return (
      <div className="rounded-xl bg-bear/10 border border-bear/30 p-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔴</span>
          <span className="text-sm font-semibold">市場資料異常，暫停訊號判斷</span>
        </div>
        <div className="text-[11px] text-subtext mt-1">
          {staleCount} 個幣種的資料延遲超過15分鐘，這些幣種目前不會產生A級訊號，等資料恢復正常再重新檢查。
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-panel2 p-3 mb-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">🟢</span>
        <span className="text-sm font-semibold">資料正常</span>
      </div>
      <div className="text-[11px] text-subtext mt-1">
        {activeCount > 0 ? `${activeCount} 個A級訊號` : "目前沒有A級訊號"} ・ 8個幣種資料都在15分鐘內
      </div>
    </div>
  );
}

function LiveSignalRow({ s }: { s: LiveSignal }) {
  const info = STATE_INFO[s.state];
  return (
    <div className="flex items-center justify-between text-xs rounded-lg bg-panel px-3 py-2">
      <span className="font-medium w-16 shrink-0">{s.symbol.replace("USDT", "")}</span>
      <span>
        {info.emoji} {info.label}
      </span>
      <span className="text-subtext">{s.direction ?? "—"}</span>
      <span className="numeric-safe">{s.currentPrice != null ? s.currentPrice.toPrecision(6) : "—"}</span>
    </div>
  );
}

function LiveSignalDebugCard({ s }: { s: LiveSignal }) {
  const info = STATE_INFO[s.state];
  return (
    <div className="rounded-xl bg-panel2 p-3 mb-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold">{s.symbol.replace("USDT", "")}</span>
        <span className="text-[11px]">
          {info.emoji} {info.label}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        <div>
          <span className="text-subtext">方向：</span>
          {s.direction ?? "—"}
        </div>
        <div>
          <span className="text-subtext">現價：</span>
          <span className="numeric-safe">{s.currentPrice?.toPrecision(6) ?? "—"}</span>
        </div>
        <div>
          <span className="text-subtext">Ref High：</span>
          <span className="numeric-safe">{s.refHigh?.toPrecision(6) ?? "—"}</span>
        </div>
        <div>
          <span className="text-subtext">Ref Low：</span>
          <span className="numeric-safe">{s.refLow?.toPrecision(6) ?? "—"}</span>
        </div>
        <div>
          <span className="text-subtext">距突破：</span>
          {s.distanceToBreakoutPct != null ? `${s.distanceToBreakoutPct.toFixed(2)}%` : "—"}
        </div>
        <div>
          <span className="text-subtext">資料延遲：</span>
          {s.dataAgeMinutes != null ? `${s.dataAgeMinutes.toFixed(1)}分` : "—"}
        </div>
      </div>
      <div className="text-[10px] text-subtext mt-1">
        更新於 {new Date(s.updatedAt).toLocaleTimeString("zh-TW")}
      </div>
    </div>
  );
}

function LiveSignalDetailCard({ s }: { s: LiveSignal }) {
  const info = STATE_INFO[s.state];
  return (
    <div className="rounded-xl bg-bull/10 border border-bull/30 p-3 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{info.emoji}</span>
        <span className="text-sm font-semibold">
          {s.symbol.replace("USDT", "")} {s.direction === "LONG" ? "做多" : "做空"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-subtext">建議進場價</div>
          <div className="font-semibold numeric-safe">{s.entryPrice?.toPrecision(6)}</div>
        </div>
        <div>
          <div className="text-subtext">現價</div>
          <div className="font-semibold numeric-safe">{s.currentPrice?.toPrecision(6)}</div>
        </div>
        <div>
          <div className="text-subtext">停損</div>
          <div className="font-semibold numeric-safe text-bear">{s.stopLoss?.toPrecision(6)}</div>
        </div>
        <div>
          <div className="text-subtext">停利(1R)</div>
          <div className="font-semibold numeric-safe text-bull">{s.takeProfit?.toPrecision(6)}</div>
        </div>
      </div>
      <div className="text-[10px] text-subtext mt-2">
        訊號時間：{s.signalTime ? new Date(s.signalTime * 1000).toLocaleString("zh-TW") : "—"}
      </div>
    </div>
  );
}

function PaperComparisonCard({ backtest, paper }: { backtest: RetestStrategyReport; paper: PaperReport }) {
  return (
    <div className="rounded-xl bg-panel2 p-3 mb-3">
      <div className="text-xs font-semibold mb-2">回測 vs 模擬交易（TP=1R）</div>
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr>
            <th className="text-left text-subtext font-normal px-1 py-1"></th>
            <th className="text-right text-subtext font-normal px-1 py-1">回測(樣本外)</th>
            <th className="text-right text-subtext font-normal px-1 py-1">Paper</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border">
            <td className="text-subtext px-1 py-1.5">樣本數</td>
            <td className="text-right numeric-safe px-1 py-1.5">{backtest.tradeCount}</td>
            <td className="text-right numeric-safe px-1 py-1.5">{paper.sampleCount}</td>
          </tr>
          <tr className="border-t border-border">
            <td className="text-subtext px-1 py-1.5">勝率</td>
            <td className="text-right numeric-safe px-1 py-1.5">{backtest.winRate.toFixed(1)}%</td>
            <td className="text-right numeric-safe px-1 py-1.5">{paper.winRate.toFixed(1)}%</td>
          </tr>
          <tr className="border-t border-border">
            <td className="text-subtext px-1 py-1.5">期望值</td>
            <td className="text-right numeric-safe px-1 py-1.5">
              {backtest.expectancy >= 0 ? "+" : ""}
              {backtest.expectancy.toFixed(2)}R
            </td>
            <td className="text-right numeric-safe px-1 py-1.5">
              {paper.expectancy >= 0 ? "+" : ""}
              {paper.expectancy.toFixed(2)}R
            </td>
          </tr>
          <tr className="border-t border-border">
            <td className="text-subtext px-1 py-1.5">獲利因子</td>
            <td className="text-right numeric-safe px-1 py-1.5">
              {backtest.profitFactor === Infinity ? "∞" : backtest.profitFactor.toFixed(2)}
            </td>
            <td className="text-right numeric-safe px-1 py-1.5">
              {paper.profitFactor === Infinity ? "∞" : paper.profitFactor.toFixed(2)}
            </td>
          </tr>
          <tr className="border-t border-border">
            <td className="text-subtext px-1 py-1.5">最大回撤</td>
            <td className="text-right numeric-safe px-1 py-1.5">-{backtest.maxDrawdownR.toFixed(2)}R</td>
            <td className="text-right numeric-safe px-1 py-1.5">-{paper.maxDrawdownR.toFixed(2)}R</td>
          </tr>
        </tbody>
      </table>
      <div className="text-[10px] text-subtext mt-2 leading-relaxed">
        Paper樣本數還很少時（少於30筆）這個比較沒有統計意義，只是先把數字擺在一起，隨著時間累積才會有參考價值。Paper的期望值沒有扣手續費/滑價，會比回測系統性地好看一點點。
      </div>
    </div>
  );
}

export default function JournalPage() {
  const { capital, capitalState } = useMarketData();

  const [cbDays, setCbDays] = useState(365);
  const [cbWindow, setCbWindow] = useState<30 | 60 | 90 | 120>(60);
  const [cbLoading, setCbLoading] = useState(false);
  const [cbError, setCbError] = useState<string | null>(null);
  const [cbWarning, setCbWarning] = useState<string | null>(null);
  const [cbProgress, setCbProgress] = useState("");
  const [cbEvents, setCbEvents] = useState<VolumeBreakoutEvent[] | null>(null);
  const [cbTrades, setCbTrades] = useState<RetestTrade[] | null>(null);
  const [cbCandles, setCbCandles] = useState<Record<string, Candle[]> | null>(null);

  const [vzLoading, setVzLoading] = useState(false);
  const [vzError, setVzError] = useState<string | null>(null);
  const [vzResults, setVzResults] = useState<{ zone: number; direct: VolumeBreakoutReport; retest: VolumeBreakoutReport }[] | null>(
    null
  );

  const [liveSignals, setLiveSignals] = useState<LiveSignal[] | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveLastUpdate, setLiveLastUpdate] = useState<number | null>(null);
  const [signalRecords, setSignalRecords] = useState<SignalRecord[]>([]);

  const [simResult, setSimResult] = useState<GrowthSimResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const TARGET_CAPITAL = 1_000_000_000;

  const runGrowthSim = () => {
    setSimError(null);
    const trades = loadOosTrades();
    if (trades.length < 30) {
      setSimError("樣本外交易紀錄不足（少於30筆），請先去上面跑一次「一鍵執行完整分析」。");
      setSimResult(null);
      return;
    }
    setSimLoading(true);
    // 用 setTimeout 讓 loading 狀態先畫出來，模擬計算量不小（1000次×最多2萬筆交易）
    setTimeout(() => {
      const result = runGrowthSimulation(trades, capital, TARGET_CAPITAL, 1000, 20000);
      setSimResult(result);
      setSimLoading(false);
    }, 50);
  };

  const [exportText, setExportText] = useState<string | null>(null);
  const [exportCopied, setExportCopied] = useState(false);

  const buildExportText = () => {
    const summary = loadOosSummary();
    const trades = loadOosTrades();
    if (!summary || trades.length === 0) {
      setExportText(null);
      return;
    }
    setExportText(JSON.stringify({ summary, trades }));
    setExportCopied(false);
  };

  const copyExportText = async () => {
    if (!exportText) return;
    try {
      await navigator.clipboard.writeText(exportText);
      setExportCopied(true);
    } catch {
      // 部分瀏覽器可能不支援clipboard API，這時使用者可以自己長按選取文字複製
    }
  };

  const lock = lockLabel[capitalState.profitLockLevel];

  // 一鍵執行：抓一次5分鐘資料，同時做事件研究 + 回踩策略TP=1R的訓練/驗證/樣本外驗證。
  // 資料只抓一次、共用給兩邊分析，不會重複抓取。
  const runCombinedAnalysis = async () => {
    setCbLoading(true);
    setCbError(null);
    setCbWarning(null);
    setCbEvents(null);
    setCbTrades(null);
    setCbCandles(null);
    setVzResults(null);
    const candlesBySymbol: Record<string, Candle[]> = {};
    const events: VolumeBreakoutEvent[] = [];
    const trades: RetestTrade[] = [];
    const failedSymbols: string[] = [];
    let successCount = 0;
    for (const symbol of AUDIT_SYMBOLS) {
      setCbProgress(`抓取 ${symbol.replace("USDT", "")} 5分鐘資料中…`);
      let candles: Candle[] | null = null;
      // 抓失敗重試一次（2年長時間抓取偶爾會遇到暫時性網路問題），還是失敗才真的算這個幣種失敗
      for (let attempt = 0; attempt < 2 && !candles; attempt++) {
        try {
          const c = await fetchKlinesHistory(symbol, "5m", cbDays * 288);
          if (c.length >= 500) candles = c;
        } catch {
          // 繼續重試或標記失敗
        }
      }
      if (candles) {
        successCount++;
        candlesBySymbol[symbol] = candles;
        events.push(...runVolumeBreakoutEventStudy(symbol, candles, cbWindow));
        trades.push(...runRetestStrategyBacktest(symbol, candles, cbWindow, OOS_TP));
      } else {
        failedSymbols.push(symbol.replace("USDT", ""));
      }
    }
    setCbLoading(false);
    setCbProgress("");
    if (successCount === 0) {
      setCbError("所有幣種的歷史資料都抓取失敗，請檢查網路連線後再試一次");
      return;
    }
    if (failedSymbols.length > 0) {
      setCbWarning(
        `⚠️ ${failedSymbols.join("、")} 這 ${failedSymbols.length} 個幣種抓取失敗（重試過一次仍失敗），下面所有數字都不包含它們，不是「這個幣種沒有訊號」——建議稍後單獨重跑一次確認。`
      );
    }
    setCbCandles(candlesBySymbol);
    setCbEvents(events);
    setCbTrades(trades);

    // 存一份摘要給首頁讀，首頁不會自己重跑一次2年回測（跑不動），只讀這裡最後一次算出來的結果。
    if (trades.length > 0) {
      const split = splitTrainValOOS(trades);
      const tr = auditRetestStrategy(split.train, "train");
      const va = auditRetestStrategy(split.validation, "val");
      const oo = auditRetestStrategy(split.oos, "oos");
      const verdict: "PASSED" | "INSUFFICIENT" | "FAILED" =
        oo.tradeCount < 30 ? "INSUFFICIENT" : tr.expectancy > 0 && va.expectancy > 0 && oo.expectancy > 0 ? "PASSED" : "FAILED";
      saveOosSummary({
        verdict,
        sampleCount: oo.tradeCount,
        winRate: oo.winRate,
        expectancy: oo.expectancy,
        profitFactor: oo.profitFactor,
        maxDrawdownR: oo.maxDrawdownR,
        windowMinutes: cbWindow,
        tpMultiple: OOS_TP,
        computedAt: Date.now(),
      });
      // 存一份原始交易清單（R值+時間）給資金成長模擬器用，不是每次都要重跑2年回測才能模擬。
      saveOosTrades(split.oos.map((t) => ({ rMultiple: t.rMultiple, entryTime: t.entryTime })));
    }
  };

  const vbOverall = cbEvents ? auditVolumeBreakout(cbEvents, "全部事件") : null;
  const vbLongs = cbEvents ? auditVolumeBreakout(cbEvents.filter((e) => e.direction === "LONG"), "多方事件") : null;
  const vbShorts = cbEvents ? auditVolumeBreakout(cbEvents.filter((e) => e.direction === "SHORT"), "空方事件") : null;
  const vbPerSymbol = cbEvents
    ? AUDIT_SYMBOLS.map((s) => auditVolumeBreakout(cbEvents.filter((e) => e.symbol === s), s.replace("USDT", "")))
    : null;
  const vbByVolumeRatio = cbEvents
    ? VOLUME_RATIO_BINS.map((bin) =>
        auditVolumeBreakout(cbEvents.filter((e) => e.volumeRatio >= bin.min && e.volumeRatio < bin.max), bin.label)
      )
    : null;
  const vbByCLV = cbEvents
    ? CLV_BINS.map((bin) => auditVolumeBreakout(cbEvents.filter((e) => e.clv >= bin.min && e.clv < bin.max), bin.label))
    : null;
  const vbDirectReport = cbEvents ? auditVolumeBreakout(cbEvents, "直接進場（全部事件）") : null;
  const vbRetestReport = cbEvents ? toRetestReport(cbEvents, "等回踩才進場") : null;
  const vbRetestFoundRate =
    cbEvents && cbEvents.length ? (cbEvents.filter((e) => e.retestFound).length / cbEvents.length) * 100 : 0;

  const oosSplit = cbTrades ? splitTrainValOOS(cbTrades) : null;
  const trainReport = oosSplit ? auditRetestStrategy(oosSplit.train, "訓練段（前60%）") : null;
  const valReport = oosSplit ? auditRetestStrategy(oosSplit.validation, "驗證段（中間20%）") : null;
  const oosReport = oosSplit ? auditRetestStrategy(oosSplit.oos, "樣本外段（最後20%，完全沒被看過）") : null;
  const oosVerdict = trainReport && valReport && oosReport ? OosVerdict(trainReport, valReport, oosReport) : null;
  const oosMonteCarlo =
    oosSplit && oosSplit.oos.length >= 20 ? runMonteCarlo(oosSplit.oos.map((t) => t.rMultiple), 2000) : null;

  const runRetestStabilityTest = async () => {
    if (!cbCandles) return;
    setVzLoading(true);
    setVzError(null);
    setVzResults(null);
    const results = RETEST_ZONE_OPTIONS.map((zone) => {
      const zoneEvents: VolumeBreakoutEvent[] = [];
      Object.keys(cbCandles).forEach((symbol) => {
        zoneEvents.push(...runVolumeBreakoutEventStudy(symbol, cbCandles[symbol], cbWindow, zone));
      });
      return {
        zone,
        direct: auditVolumeBreakout(zoneEvents, `直接進場`),
        retest: toRetestReport(zoneEvents, `等回踩(±${zone}%)`),
      };
    });
    setVzLoading(false);
    setVzResults(results);
  };

  // 即時訊號監控：用固定的、已驗證過的公式（觀察窗口=cbWindow、TP=1R、回踩容忍度=0.3%），
  // 抓每個幣種最近一天的5分鐘K線，評估現在處在哪個狀態。跟回測用完全相同的偵測邏輯
  // （驗收第1項：兩邊都呼叫 lib/retestCore.ts 的 detectFromOpen）。
  const runLiveSignalCheck = async () => {
    setLiveLoading(true);
    setLiveError(null);
    const results: LiveSignal[] = [];
    const failedSymbols: string[] = [];
    let successCount = 0;
    for (const symbol of AUDIT_SYMBOLS) {
      try {
        const candles = await fetchKlines(symbol, "5m", 288);
        successCount++;
        const signal = evaluateLiveSignal(symbol, candles, cbWindow, OOS_TP, 0.3);
        results.push(signal);
        upsertFromLiveSignal(signal, OOS_TP);
      } catch {
        failedSymbols.push(symbol.replace("USDT", ""));
      }
    }
    setLiveLoading(false);
    if (successCount === 0) {
      setLiveError("所有幣種的即時資料都抓取失敗，請檢查網路連線後再試一次");
      return;
    }
    if (failedSymbols.length > 0) {
      setLiveError(`⚠️ ${failedSymbols.join("、")} 這次抓取失敗，沒有包含在下面的結果裡，重新按一次應該就會恢復。`);
    }
    setLiveSignals(results);
    setLiveLastUpdate(Date.now());
    setSignalRecords(loadSignalRecords());
  };

  const activeSignals = liveSignals ? liveSignals.filter((s) => s.state === "RETEST_CONFIRMED") : [];
  const paperReport = signalRecords.length ? auditSignalRecords(signalRecords) : null;

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

      {/* 即時訊號監控 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">🔴 即時訊號監控</div>
        <div className="text-xs text-subtext mb-2 leading-relaxed">
          用跟2958筆回測完全相同的公式（觀察窗口={cbWindow}分鐘、預設60分鐘、TP=1R、回踩容忍度=±0.3%），檢查現在8個幣種各自處在哪個階段。只有🟢「A級進場訊號」代表現在符合完整條件，其他狀態都只是「正在觀察」，不是進場訊號。
        </div>
        <div className="text-[11px] text-warn mb-3 leading-relaxed">
          ⚠️ 這只提供即時訊號，不會自動下單。可以直接按下面按鈕檢查，不需要先跑下面的完整分析。
        </div>

        <button
          onClick={runLiveSignalCheck}
          disabled={liveLoading}
          className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-3"
        >
          {liveLoading ? "檢查中…" : "檢查現在的訊號狀態"}
        </button>

        {liveError && <div className="text-xs text-warn mb-2">⚠️ {liveError}</div>}

        {liveLastUpdate && (
          <div className="text-[10px] text-subtext mb-2">
            上次更新：{new Date(liveLastUpdate).toLocaleTimeString("zh-TW")}（要看最新狀態請重新按一次）
          </div>
        )}

        {liveSignals && (
          <div>
            <EngineStatusBanner signals={liveSignals} />

            {activeSignals.length > 0 ? (
              <div>
                <div className="text-xs font-semibold mb-2 text-bull">
                  {activeSignals.length} 個 A級進場訊號
                </div>
                {activeSignals.map((s) => (
                  <LiveSignalDetailCard key={s.symbol} s={s} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-panel2 p-4 text-center text-sm text-subtext mb-3">
                目前沒有符合條件的交易，不交易。
              </div>
            )}

            {paperReport && (
              <PaperComparisonCard
                backtest={
                  oosReport ?? {
                    label: "",
                    tradeCount: 0,
                    winRate: 0,
                    completedTrades: 0,
                    expectancy: 0,
                    profitFactor: 0,
                    maxDrawdownR: 0,
                    maxConsecutiveLosses: 0,
                  }
                }
                paper={paperReport}
              />
            )}

            <details className="mb-1">
              <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                詳細資料：8個幣種完整狀態 ▾
              </summary>
              <div>
                {liveSignals.map((s) => (
                  <LiveSignalDebugCard key={s.symbol} s={s} />
                ))}
              </div>
            </details>

            {signalRecords.length > 0 && (
              <details className="mt-3 mb-1">
                <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                  訊號紀錄（本機儲存，共{signalRecords.length}筆）▾
                </summary>
                <div className="space-y-1.5">
                  {[...signalRecords]
                    .reverse()
                    .slice(0, 20)
                    .map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-xs rounded-lg bg-panel px-3 py-2">
                        <span className="font-medium w-14 shrink-0">{r.symbol.replace("USDT", "")}</span>
                        <span
                          className={
                            r.status === "WIN" ? "text-bull" : r.status === "LOSS" ? "text-bear" : "text-subtext"
                          }
                        >
                          {r.status}
                        </span>
                        <span className="numeric-safe">
                          {r.rMultiple != null ? `${r.rMultiple >= 0 ? "+" : ""}${r.rMultiple.toFixed(2)}R` : "—"}
                        </span>
                        <span className="text-subtext">{new Date(r.refTime * 1000).toLocaleDateString("zh-TW")}</span>
                      </div>
                    ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {/* 一鍵：事件研究 + 回踩策略樣本外驗證 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">🎯 回踩策略完整分析（事件研究＋樣本外驗證）</div>
        <div className="text-xs text-subtext mb-2 leading-relaxed">
          一鍵抓一次5分鐘資料，同時做「美股高成交量K突破事件研究」跟「回踩策略TP=1R的訓練/驗證/樣本外驗證」，不用分開跑、不會重複抓資料。TP=1R
          是目前暫定的正式版本（風險調整後最合理，詳見先前的四檔TP比較）。
        </div>
        <details className="text-[11px] text-subtext mb-3">
          <summary className="cursor-pointer select-none">這次沒做到什麼（誠實揭露）▾</summary>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>只驗證TP=1R這個暫定版本，其他TP檔位沒有重跑樣本外驗證</li>
            <li>樣本外切分是依時間排序後照60/20/20比例切，不是正式的Walk-Forward（每個訓練窗重新尋找條件、下一段獨立測試）</li>
            <li>停損只用Reference區間對側，沒有測ATR停損或其他倍數</li>
            <li>沒有BTC市場環境交叉分析</li>
            <li>回踩容忍度固定用±0.3%（已驗證0.2~0.5%範圍內方向一致，這裡用中間值代表）</li>
          </ul>
        </details>

        <div className="mb-3">
          <label className="text-xs text-subtext mb-1 block">觀察窗口</label>
          <select
            value={cbWindow}
            onChange={(e) => setCbWindow(Number(e.target.value) as 30 | 60 | 90 | 120)}
            className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm"
            style={{ minHeight: 44 }}
          >
            {CB_WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3">
          <label className="text-xs text-subtext mb-1 block">回測期間</label>
          <select
            value={cbDays}
            onChange={(e) => setCbDays(Number(e.target.value))}
            className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm"
            style={{ minHeight: 44 }}
          >
            {CB_DURATION_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={runCombinedAnalysis}
          disabled={cbLoading}
          className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-3"
        >
          {cbLoading ? cbProgress || "執行中…" : "一鍵執行完整分析"}
        </button>

        {cbError && <div className="text-xs text-warn mb-2">⚠️ {cbError}</div>}
        {cbWarning && <div className="text-xs text-warn mb-2 leading-relaxed">{cbWarning}</div>}

        {trainReport && valReport && oosReport && oosVerdict && (
          <div>
            <div className="text-xs font-semibold mb-2 text-subtext">
              樣本外驗證（TP=1R，{cbTrades?.length ?? 0}筆訊號依時間切60/20/20）
            </div>
            <div className="rounded-xl bg-panel2 p-3 mb-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{oosVerdict.emoji}</span>
                <span className="text-sm font-semibold">{oosVerdict.label}</span>
              </div>
              <div className="text-xs text-text leading-relaxed">{oosVerdict.text}</div>
            </div>
            <RetestStrategyCard r={trainReport} />
            <RetestStrategyCard r={valReport} />
            <RetestStrategyCard r={oosReport} />
            {oosMonteCarlo && <MonteCarloCard m={oosMonteCarlo} />}
            {oosSplit && oosSplit.oos.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-subtext mb-2">樣本外段資金曲線（累積報酬 R）</div>
                <EquityCurve rMultiples={oosSplit.oos.map((t) => t.rMultiple)} />
              </div>
            )}
          </div>
        )}

        {vbOverall && vbLongs && vbShorts && vbPerSymbol && vbByVolumeRatio && vbByCLV && vbDirectReport && vbRetestReport && (
          <div className="mt-3">
            <details className="mb-3">
              <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                事件研究總覽 ▾
              </summary>
              <VolumeBreakoutCard r={vbOverall} />
              <div className="text-xs font-semibold mb-2 text-subtext">
                直接進場 vs 等回踩才進場（{vbRetestFoundRate.toFixed(0)}%的事件有出現回踩）
              </div>
              <VolumeBreakoutMiniRow r={vbDirectReport} />
              <div className="h-1.5" />
              <VolumeBreakoutMiniRow r={vbRetestReport} />
              <div className="text-xs font-semibold mb-2 text-subtext mt-3">多方事件 vs 空方事件</div>
              <VolumeBreakoutMiniRow r={vbLongs} />
              <div className="h-1.5" />
              <VolumeBreakoutMiniRow r={vbShorts} />
            </details>

            <details className="mb-3">
              <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                分幣種結果（{AUDIT_SYMBOLS.length}個）▾
              </summary>
              <div className="space-y-1.5">
                {vbPerSymbol.map((r) => (
                  <VolumeBreakoutMiniRow key={r.label} r={r} />
                ))}
              </div>
            </details>

            <details className="mb-3">
              <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                分成交量倍率結果 ▾
              </summary>
              <div className="space-y-1.5">
                {vbByVolumeRatio.map((r) => (
                  <VolumeBreakoutMiniRow key={r.label} r={r} />
                ))}
              </div>
            </details>

            <details className="mb-3">
              <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                分 CLV（Reference Candle收盤位置）結果 ▾
              </summary>
              <div className="space-y-1.5">
                {vbByCLV.map((r) => (
                  <VolumeBreakoutMiniRow key={r.label} r={r} />
                ))}
              </div>
            </details>

            <details className="mb-1">
              <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                回踩容忍度穩定性測試（用同一批資料，不用重抓）▾
              </summary>
              <button
                onClick={runRetestStabilityTest}
                disabled={vzLoading}
                className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-3"
              >
                {vzLoading ? "執行中…" : "執行穩定性測試"}
              </button>
              {vzError && <div className="text-xs text-warn mb-2">⚠️ {vzError}</div>}
              {vzResults && (
                <div className="space-y-1.5">
                  {vzResults.map((r) => (
                    <div key={r.zone}>
                      <div className="text-[11px] text-subtext mb-1">±{r.zone}%</div>
                      <VolumeBreakoutMiniRow r={r.direct} />
                      <div className="h-1" />
                      <VolumeBreakoutMiniRow r={r.retest} />
                      <div className="h-2" />
                    </div>
                  ))}
                </div>
              )}
            </details>
          </div>
        )}
      </section>

      {/* 資金成長機率模擬器 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">📈 資金成長機率模擬器</div>
        <div className="text-xs text-subtext mb-2 leading-relaxed">
          用樣本外段真實的{loadOosTrades().length || "—"}筆交易（真實R值分布、真實進場間隔）蒙地卡羅重抽樣1000次，套用現有資金階段風控框架（`lib/phases.ts`，完全沒有修改），從目前本金 NT${capital.toLocaleString()} 模擬到 NT${TARGET_CAPITAL.toLocaleString()} 大概要多久。這是機率估計，不是預測。
        </div>
        <details className="text-[11px] text-subtext mb-3">
          <summary className="cursor-pointer select-none">這個模擬做了什麼簡化（誠實揭露）▾</summary>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>樣本只有500多筆，未來實際表現可能跟這批樣本的分布不一樣</li>
            <li>「交易間隔」是從歷史進場時間反推的統計間隔，不保證未來訊號頻率一樣</li>
            <li>PROTECT_MODE（回撤達20%）理論上禁止新交易，這裡為了不讓模擬卡死，簡化成仍以0.1%極小風險嘗試，這是模擬器內部假設，不代表系統實際允許</li>
            <li>沒有額外計算手續費/滑價以外的真實世界摩擦（訊號延遲、實際成交滑點），沿用回測本身已經扣過的R值</li>
          </ul>
        </details>

        <button
          onClick={runGrowthSim}
          disabled={simLoading}
          className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-3"
        >
          {simLoading ? "模擬中…" : "執行模擬"}
        </button>

        {simError && <div className="text-xs text-warn mb-2">⚠️ {simError}</div>}

        {simResult && (
          <div>
            <div className="text-xs text-subtext mb-2">
              {simResult.simulations.toLocaleString()}次模擬中，{simResult.reachedCount.toLocaleString()}次在2萬筆交易上限內達標（
              {simResult.reachedPct.toFixed(1)}%）
            </div>
            {simResult.tradesNeeded && simResult.daysNeeded ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <div className="text-subtext">樂觀（P10）</div>
                    <div className="font-semibold numeric-safe">{simResult.tradesNeeded.p10.toLocaleString()}筆</div>
                    <div className="text-subtext numeric-safe">{(simResult.daysNeeded.p10 / 365).toFixed(1)}年</div>
                  </div>
                  <div>
                    <div className="text-subtext">中位數（P50）</div>
                    <div className="font-semibold numeric-safe text-bull">{simResult.tradesNeeded.p50.toLocaleString()}筆</div>
                    <div className="text-subtext numeric-safe">{(simResult.daysNeeded.p50 / 365).toFixed(1)}年</div>
                  </div>
                  <div>
                    <div className="text-subtext">悲觀（P90）</div>
                    <div className="font-semibold numeric-safe">{simResult.tradesNeeded.p90.toLocaleString()}筆</div>
                    <div className="text-subtext numeric-safe">{(simResult.daysNeeded.p90 / 365).toFixed(1)}年</div>
                  </div>
                </div>
                {simResult.reachedPct < 50 && (
                  <div className="text-[11px] text-warn leading-relaxed">
                    ⚠️ 超過一半的模擬次數在2萬筆交易內都沒有達標，代表用目前的風控框架＋樣本外表現，達到目標的機率本身不高，時間數字只是「有達標的那些次」的估計，不是整體的保證。
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-subtext text-center py-2">
                1000次模擬全部沒有在2萬筆交易內達標——用目前的風險框架＋樣本外表現，這是一個誠實但不好聽的結果。
              </div>
            )}
          </div>
        )}
      </section>

      {/* 匯出樣本外資料（永久保存用） */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">💾 匯出樣本外資料</div>
        <div className="text-xs text-subtext mb-3 leading-relaxed">
          瀏覽器儲存（localStorage）換裝置、換瀏覽器、清資料就會不見。跑完上面「一鍵執行完整分析」後，按這裡產生一段文字，複製貼給我，我可以把這份資料寫進程式碼裡當內建預設值，之後就算清掉瀏覽器資料也不用重跑2年回測。
        </div>
        <button
          onClick={buildExportText}
          className="btn-primary w-full border border-border bg-panel2 text-sm mb-3"
        >
          產生匯出文字
        </button>
        {exportText ? (
          <div>
            <textarea
              readOnly
              value={exportText}
              className="w-full bg-panel2 border border-border rounded-xl px-3 py-2 text-[10px] numeric-safe"
              style={{ height: 100 }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              onClick={copyExportText}
              className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mt-2"
            >
              {exportCopied ? "已複製 ✓" : "複製到剪貼簿"}
            </button>
            <div className="text-[10px] text-subtext mt-2">
              如果「複製到剪貼簿」按了沒反應（少數瀏覽器不支援），點一下上面的文字框，它會自動全選，長按選單裡選「複製」也可以。
            </div>
          </div>
        ) : (
          <div className="text-xs text-subtext text-center py-2">
            還沒有資料可以匯出，先跑一次上面的「一鍵執行完整分析」。
          </div>
        )}
      </section>
    </main>
  );
            }
