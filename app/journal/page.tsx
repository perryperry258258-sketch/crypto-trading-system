"use client";

import { useState } from "react";
import { useMarketData } from "@/lib/useMarketData";
import { fetchKlinesHistory, Candle } from "@/lib/binance";
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
  RetestTrade,
  RetestStrategyReport,
  RETEST_STRATEGY_TP_OPTIONS,
  RETEST_STRATEGY_DURATION_OPTIONS,
} from "@/lib/retestStrategyLab";
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
const VB_DURATION_OPTIONS = [
  { label: "30天", days: 30 },
  { label: "60天", days: 60 },
  { label: "90天（較久，5分鐘資料量大）", days: 90 },
];
const VB_WINDOW_OPTIONS: { label: string; value: 30 | 60 | 90 | 120 }[] = [
  { label: "30分鐘", value: 30 },
  { label: "60分鐘", value: 60 },
  { label: "90分鐘", value: 90 },
  { label: "120分鐘", value: 120 },
];

function fmt(n: number) {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

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
      <div className="text-[10px] text-subtext mb-1">MFE / MAE（平均，%）</div>
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

export default function JournalPage() {
  const { capitalState, paperOpen, paperClosed, paperStats, coins } = useMarketData();

  const [vbDays, setVbDays] = useState(90);
  const [vbWindow, setVbWindow] = useState<30 | 60 | 90 | 120>(60);
  const [vbLoading, setVbLoading] = useState(false);
  const [vbError, setVbError] = useState<string | null>(null);
  const [vbProgress, setVbProgress] = useState("");
  const [vbEvents, setVbEvents] = useState<VolumeBreakoutEvent[] | null>(null);

  const [vzLoading, setVzLoading] = useState(false);
  const [vzError, setVzError] = useState<string | null>(null);
  const [vzProgress, setVzProgress] = useState("");
  const [vzResults, setVzResults] = useState<{ zone: number; direct: VolumeBreakoutReport; retest: VolumeBreakoutReport }[] | null>(
    null
  );

  const [rsDays, setRsDays] = useState(180);
  const [rsLoading, setRsLoading] = useState(false);
  const [rsError, setRsError] = useState<string | null>(null);
  const [rsProgress, setRsProgress] = useState("");
  const [rsAllTrades, setRsAllTrades] = useState<Record<number, RetestTrade[]> | null>(null);
  const [rsActiveTp, setRsActiveTp] = useState<number>(2);

  const lock = lockLabel[capitalState.profitLockLevel];

  const runVolumeBreakoutLab = async () => {
    setVbLoading(true);
    setVbError(null);
    setVbEvents(null);
    const collected: VolumeBreakoutEvent[] = [];
    let successCount = 0;
    for (const symbol of AUDIT_SYMBOLS) {
      setVbProgress(`抓取 ${symbol.replace("USDT", "")} 5分鐘資料中…`);
      try {
        const candles = await fetchKlinesHistory(symbol, "5m", vbDays * 288);
        if (candles.length >= 500) {
          successCount++;
          collected.push(...runVolumeBreakoutEventStudy(symbol, candles, vbWindow));
        }
      } catch {
        // 跳過失敗的幣種
      }
    }
    setVbLoading(false);
    setVbProgress("");
    if (successCount === 0) {
      setVbError("所有幣種的歷史資料都抓取失敗，請檢查網路連線後再試一次");
      return;
    }
    setVbEvents(collected);
  };

  const vbOverall = vbEvents ? auditVolumeBreakout(vbEvents, "全部事件") : null;
  const vbLongs = vbEvents ? auditVolumeBreakout(vbEvents.filter((e) => e.direction === "LONG"), "多方事件") : null;
  const vbShorts = vbEvents ? auditVolumeBreakout(vbEvents.filter((e) => e.direction === "SHORT"), "空方事件") : null;
  const vbPerSymbol = vbEvents
    ? AUDIT_SYMBOLS.map((s) => auditVolumeBreakout(vbEvents.filter((e) => e.symbol === s), s.replace("USDT", "")))
    : null;
  const vbByVolumeRatio = vbEvents
    ? VOLUME_RATIO_BINS.map((bin) =>
        auditVolumeBreakout(
          vbEvents.filter((e) => e.volumeRatio >= bin.min && e.volumeRatio < bin.max),
          bin.label
        )
      )
    : null;
  const vbByCLV = vbEvents
    ? CLV_BINS.map((bin) => auditVolumeBreakout(vbEvents.filter((e) => e.clv >= bin.min && e.clv < bin.max), bin.label))
    : null;
  const vbDirectReport = vbEvents ? auditVolumeBreakout(vbEvents, "直接進場（全部事件）") : null;
  const vbRetestReport = vbEvents ? toRetestReport(vbEvents, "等回踩才進場") : null;
  const vbRetestFoundRate = vbEvents && vbEvents.length ? (vbEvents.filter((e) => e.retestFound).length / vbEvents.length) * 100 : 0;

  const runRetestStabilityTest = async () => {
    setVzLoading(true);
    setVzError(null);
    setVzResults(null);
    const candlesBySymbol: Record<string, Candle[]> = {};
    let successCount = 0;
    for (const symbol of AUDIT_SYMBOLS) {
      setVzProgress(`抓取 ${symbol.replace("USDT", "")} 5分鐘資料中…`);
      try {
        const candles = await fetchKlinesHistory(symbol, "5m", vbDays * 288);
        if (candles.length >= 500) {
          successCount++;
          candlesBySymbol[symbol] = candles;
        }
      } catch {
        // 跳過失敗的幣種
      }
    }
    setVzLoading(false);
    setVzProgress("");
    if (successCount === 0) {
      setVzError("所有幣種的歷史資料都抓取失敗，請檢查網路連線後再試一次");
      return;
    }
    const results = RETEST_ZONE_OPTIONS.map((zone) => {
      const zoneEvents: VolumeBreakoutEvent[] = [];
      Object.keys(candlesBySymbol).forEach((symbol) => {
        zoneEvents.push(...runVolumeBreakoutEventStudy(symbol, candlesBySymbol[symbol], vbWindow, zone));
      });
      return {
        zone,
        direct: auditVolumeBreakout(zoneEvents, `直接進場`),
        retest: toRetestReport(zoneEvents, `等回踩(±${zone}%)`),
      };
    });
    setVzResults(results);
  };

  const runRetestStrategy = async () => {
    setRsLoading(true);
    setRsError(null);
    setRsAllTrades(null);
    const perTp: Record<number, RetestTrade[]> = {};
    RETEST_STRATEGY_TP_OPTIONS.forEach((tp) => (perTp[tp] = []));
    let successCount = 0;
    for (const symbol of AUDIT_SYMBOLS) {
      setRsProgress(`抓取 ${symbol.replace("USDT", "")} 5分鐘資料中…`);
      try {
        const candles = await fetchKlinesHistory(symbol, "5m", rsDays * 288);
        if (candles.length >= 500) {
          successCount++;
          RETEST_STRATEGY_TP_OPTIONS.forEach((tp) => {
            perTp[tp].push(...runRetestStrategyBacktest(symbol, candles, vbWindow, tp));
          });
        }
      } catch {
        // 跳過失敗的幣種
      }
    }
    setRsLoading(false);
    setRsProgress("");
    if (successCount === 0) {
      setRsError("所有幣種的歷史資料都抓取失敗，請檢查網路連線後再試一次");
      return;
    }
    setRsAllTrades(perTp);
  };

  const rsTrades = rsAllTrades ? rsAllTrades[rsActiveTp] : null;
  const rsReport = rsTrades ? auditRetestStrategy(rsTrades, `TP=${rsActiveTp}R`) : null;
  const rsMonteCarlo = rsTrades && rsTrades.length >= 20 ? runMonteCarlo(rsTrades.map((t) => t.rMultiple), 2000) : null;
  const rsAllReports = rsAllTrades
    ? RETEST_STRATEGY_TP_OPTIONS.map((tp) => auditRetestStrategy(rsAllTrades[tp], `TP=${tp}R`))
    : null;

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

      {/* 美股高成交量K突破 — 事件研究 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">🔬 美股高成交量K突破（事件研究）</div>
        <div className="text-xs text-subtext mb-2 leading-relaxed">
          用5分鐘K線，開盤(09:30 ET)後的觀察窗口裡找出成交量最大的那根K線當Reference，之後5分鐘收盤價突破它的高/低點才算一個事件，統計突破後的價格路徑，包含「直接進場」vs「等回踩才進場」的比較。
        </div>

        <div className="mb-3">
          <label className="text-xs text-subtext mb-1 block">觀察窗口</label>
          <select
            value={vbWindow}
            onChange={(e) => setVbWindow(Number(e.target.value) as 30 | 60 | 90 | 120)}
            className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm"
            style={{ minHeight: 44 }}
          >
            {VB_WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3">
          <label className="text-xs text-subtext mb-1 block">回測期間</label>
          <select
            value={vbDays}
            onChange={(e) => setVbDays(Number(e.target.value))}
            className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm"
            style={{ minHeight: 44 }}
          >
            {VB_DURATION_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={runVolumeBreakoutLab}
          disabled={vbLoading}
          className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-3"
        >
          {vbLoading ? vbProgress || "執行中…" : "執行事件研究"}
        </button>

        {vbError && <div className="text-xs text-warn mb-2">⚠️ {vbError}</div>}

        {vbOverall && vbLongs && vbShorts && vbPerSymbol && vbByVolumeRatio && vbByCLV && vbDirectReport && vbRetestReport && (
          <div>
            <div className="text-xs font-semibold mb-2 text-subtext">總覽</div>
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

            <details className="mt-3 mb-3">
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

            <details className="mb-1">
              <summary className="text-xs font-semibold text-subtext cursor-pointer select-none mb-2">
                分 CLV（Reference Candle收盤位置）結果 ▾
              </summary>
              <div className="space-y-1.5">
                {vbByCLV.map((r) => (
                  <VolumeBreakoutMiniRow key={r.label} r={r} />
                ))}
              </div>
            </details>

            <div className="text-xs font-semibold mb-2 text-subtext mt-3">回踩容忍度穩定性測試</div>
            <div className="text-[11px] text-subtext mb-2 leading-relaxed">
              同時測 ±0.2% / ±0.3% / ±0.5% 三個回踩容忍度，看「等回踩比較好」是不是三個都成立。
            </div>
            <button
              onClick={runRetestStabilityTest}
              disabled={vzLoading}
              className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-3"
            >
              {vzLoading ? vzProgress || "執行中…" : "執行穩定性測試"}
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
          </div>
        )}
      </section>

      {/* Phase 3：回踩策略 TP/SL 交易模擬 */}
      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-sm font-semibold mb-1">🎯 回踩策略 TP/SL 交易模擬（Phase 3）</div>
        <div className="text-xs text-subtext mb-2 leading-relaxed">
          把已經驗證過、通過穩定性測試的「等回踩才進場」訊號接上真正的TP/SL：進場價=Reference水平、停損=Reference區間對側，分開測
          1R / 1.5R / 2R / 3R 四檔TP，找哪個最有利。使用上面設定的「觀察窗口」，回測期間可以拉長到半年～1年。
        </div>
        <details className="text-[11px] text-subtext mb-3">
          <summary className="cursor-pointer select-none">這次沒做到什麼（誠實揭露）▾</summary>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>只測「等回踩」這個進場方式，不重複測直接進場（已證實較差）</li>
            <li>停損只測Reference區間對側，沒有測ATR停損或其他倍數</li>
            <li>沒有正式訓練/驗證/樣本外切分、沒有分年份、沒有BTC市場環境交叉分析</li>
            <li>1-3年的5分鐘資料量太大，手機瀏覽器不易穩定抓取完成，最長只到365天</li>
          </ul>
        </details>

        <div className="mb-3">
          <label className="text-xs text-subtext mb-1 block">回測期間</label>
          <select
            value={rsDays}
            onChange={(e) => setRsDays(Number(e.target.value))}
            className="w-full bg-panel2 border border-border rounded-xl px-3 text-sm"
            style={{ minHeight: 44 }}
          >
            {RETEST_STRATEGY_DURATION_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={runRetestStrategy}
          disabled={rsLoading}
          className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-3"
        >
          {rsLoading ? rsProgress || "執行中…（4檔TP，會比較久）" : "執行TP/SL交易模擬"}
        </button>

        {rsError && <div className="text-xs text-warn mb-2">⚠️ {rsError}</div>}

        {rsAllReports && rsReport && (
          <div>
            <div className="flex gap-2 mb-3 flex-wrap">
              {RETEST_STRATEGY_TP_OPTIONS.map((tp) => (
                <button
                  key={tp}
                  onClick={() => setRsActiveTp(tp)}
                  className={`flex-1 rounded-xl text-sm py-2 border ${
                    rsActiveTp === tp
                      ? "bg-accent/20 text-accent border-accent/40"
                      : "bg-panel2 text-subtext border-border"
                  }`}
                >
                  {tp}R
                </button>
              ))}
            </div>

            <div className="text-xs font-semibold mb-2 text-subtext">四檔TP總覽比較</div>
            <div className="space-y-1.5 mb-3">
              {rsAllReports.map((r) => (
                <div key={r.label} className="flex items-center justify-between text-xs rounded-lg bg-panel px-3 py-2">
                  <span className="font-medium w-16 shrink-0">{r.label}</span>
                  <span className="text-subtext">{r.tradeCount}筆</span>
                  <span className="numeric-safe">{r.winRate.toFixed(0)}%勝率</span>
                  <span className={`numeric-safe ${r.expectancy >= 0 ? "text-bull" : "text-bear"}`}>
                    {r.expectancy >= 0 ? "+" : ""}
                    {r.expectancy.toFixed(2)}R
                  </span>
                  <span className="numeric-safe">PF {r.profitFactor === Infinity ? "∞" : r.profitFactor.toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="text-xs font-semibold mb-2 text-subtext">目前選擇：{rsActiveTp}R 詳細數字</div>
            <RetestStrategyCard r={rsReport} />

            {rsMonteCarlo && <MonteCarloCard m={rsMonteCarlo} />}

            {rsTrades && (
              <div className="mb-1">
                <div className="text-xs text-subtext mb-2">資金曲線（累積報酬 R）</div>
                <EquityCurve rMultiples={rsTrades.map((t) => t.rMultiple)} />
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
