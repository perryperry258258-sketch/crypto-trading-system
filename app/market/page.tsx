"use client";

import { useMarketData } from "@/lib/useMarketData";
import { regimeLabelFull } from "@/lib/labels";

const regimeNote: Record<string, string> = {
  BULL: "多頭格局，允許積極交易。",
  SIDEWAYS: "方向不明，降低交易頻率。",
  BEAR: "空頭格局，大幅降低風險。",
  EUPHORIA: "市場過熱，禁止追高。",
  PANIC: "市場恐慌，等待市場穩定。",
};

function fmt(n: number) {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}

export default function MarketPage() {
  const { coins, btc, eth, global, fearGreed, regime, loading, reload, errors, lastUpdated } = useMarketData();

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-display font-bold tracking-tight">市場</h1>
        <button
          onClick={reload}
          className="btn-primary px-3 text-xs text-subtext border border-border active:scale-95 transition"
        >
          {loading ? "更新中" : "🔄 更新"}
        </button>
      </header>

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

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-xs text-subtext mb-1">大盤狀態</div>
        <div className="text-xl font-display font-bold mb-1">{regimeLabelFull[regime]}</div>
        <div className="text-sm text-subtext break-words">{regimeNote[regime]}</div>
      </section>

      {[btc, eth].map(
        (c) =>
          c && (
            <section key={c.id} className="rounded-2xl border border-border bg-panel p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg font-display font-bold">{c.symbol}</span>
                <span className="text-lg font-semibold numeric-safe">${fmt(c.price)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <div className="text-subtext mb-0.5">24H</div>
                  <div className={`font-semibold numeric-safe ${c.change24h >= 0 ? "text-bull" : "text-bear"}`}>
                    {c.change24h >= 0 ? "+" : ""}
                    {c.change24h.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-subtext mb-0.5">24H高</div>
                  <div className="font-semibold numeric-safe">${fmt(c.high24h)}</div>
                </div>
                <div>
                  <div className="text-subtext mb-0.5">24H低</div>
                  <div className="font-semibold numeric-safe">${fmt(c.low24h)}</div>
                </div>
              </div>
            </section>
          )
      )}

      {global && (
        <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
          <div className="text-xs text-subtext mb-2">大盤數據</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-panel2 p-3">
              <div className="text-xs text-subtext mb-0.5">BTC Dominance</div>
              <div className="font-semibold numeric-safe">{global.btcDominance.toFixed(1)}%</div>
            </div>
            <div className="rounded-xl bg-panel2 p-3">
              <div className="text-xs text-subtext mb-0.5">總市值 24H</div>
              <div className={`font-semibold numeric-safe ${global.marketCapChange24h >= 0 ? "text-bull" : "text-bear"}`}>
                {global.marketCapChange24h >= 0 ? "+" : ""}
                {global.marketCapChange24h.toFixed(1)}%
              </div>
            </div>
            <div className="rounded-xl bg-panel2 p-3 col-span-2">
              <div className="text-xs text-subtext mb-0.5">恐慌貪婪指數</div>
              <div className="font-semibold numeric-safe">
                {fearGreed ? `${fearGreed.value} (${fearGreed.classification})` : "—"}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-panel p-4 mb-3">
        <div className="text-xs text-subtext mb-2">掃描標的一覽</div>
        <div className="space-y-2">
          {coins?.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm">
              <span className="font-medium">{c.symbol}</span>
              <span className="numeric-safe">${fmt(c.price)}</span>
              <span className={`numeric-safe ${c.change24h >= 0 ? "text-bull" : "text-bear"}`}>
                {c.change24h >= 0 ? "+" : ""}
                {c.change24h.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </section>

      <footer className="text-center text-[11px] text-subtext pb-6">
        {lastUpdated ? `Updated: ${lastUpdated.toLocaleString()}` : "尚未更新"}
      </footer>
    </main>
  );
}
