"use client";

import { useState } from "react";

// Binance Testnet 連線測試頁——只查詢模擬帳戶餘額，不下單、不牽涉真實資金。
// 這是走向自動下單的第一步：先確認API金鑰能不能連上。

export default function TestnetPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const runCheck = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/binance-test");
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  };

  return (
    <main className="max-w-md mx-auto px-4 pt-8 pb-10">
      <header className="mb-4">
        <h1 className="text-xl font-display font-bold tracking-tight">Binance Testnet 連線測試</h1>
        <div className="text-xs text-warn mt-2 leading-relaxed">
          ⚠️ 這只查詢模擬帳戶餘額，不會下單，不牽涉真實資金。要先在Vercel環境變數設定好
          BINANCE_TESTNET_API_KEY 跟 BINANCE_TESTNET_API_SECRET。
        </div>
      </header>

      <button
        onClick={runCheck}
        disabled={loading}
        className="btn-primary w-full bg-accent/20 text-accent border border-accent/40 text-sm mb-4"
      >
        {loading ? "連線中…" : "測試連線"}
      </button>

      {error && (
        <div className="rounded-xl border border-bear/40 bg-bear/10 p-3 mb-4 text-xs text-bear leading-relaxed break-all">
          ❌ {error}
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-border bg-panel p-4 mb-4">
          <div className="text-sm text-bull font-semibold mb-3">✅ 連線成功</div>
          <div className="text-xs text-subtext mb-1">帳戶類型：{result.accountType}</div>
          <div className="text-xs text-subtext mb-3">可以交易：{result.canTrade ? "是" : "否"}</div>
          <div className="text-xs text-subtext mb-2">模擬資產餘額：</div>
          <div className="space-y-1">
            {result.balances?.length > 0 ? (
              result.balances.map((b: { asset: string; free: string; locked: string }) => (
                <div key={b.asset} className="flex items-center justify-between text-xs rounded-lg bg-panel2 px-3 py-2">
                  <span className="font-medium">{b.asset}</span>
                  <span className="numeric-safe">{b.free}</span>
                </div>
              ))
            ) : (
              <div className="text-xs text-subtext">沒有非零餘額</div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
