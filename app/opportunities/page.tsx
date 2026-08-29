"use client";

import { useMarketData } from "@/lib/useMarketData";
import OpportunityCard from "@/components/OpportunityCard";

export default function OpportunitiesPage() {
  const { candidates, top3, dangerous, loading, reload, errors } = useMarketData();

  return (
    <main className="max-w-md mx-auto px-4 pt-5">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-display font-bold tracking-tight">機會</h1>
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

      <section className="mb-5">
        <h2 className="text-sm font-display font-semibold mb-2">🔥 今日高品質機會</h2>
        {top3.length === 0 ? (
          <div className="rounded-xl border border-border bg-panel p-4 text-center text-subtext text-sm">
            💤 目前沒有符合系統條件的高品質交易
          </div>
        ) : (
          <div className="space-y-2">
            {top3.map((c) => (
              <OpportunityCard key={c.coin.id} c={c} />
            ))}
          </div>
        )}
      </section>

      {dangerous.length > 0 && (
        <section className="mb-5">
          <h2 className="text-sm font-display font-semibold mb-2 text-bear">⚠️ 今日最危險標的</h2>
          <div className="space-y-2">
            {dangerous.map((c) => (
              <OpportunityCard key={c.coin.id} c={c} />
            ))}
          </div>
        </section>
      )}

      <section className="mb-5">
        <h2 className="text-sm font-display font-semibold mb-2 text-subtext">全部掃描標的</h2>
        <div className="space-y-2">
          {candidates.map((c) => (
            <OpportunityCard key={c.coin.id} c={c} />
          ))}
        </div>
      </section>
    </main>
  );
}
