import Link from "next/link";
import { LiveSignal } from "@/lib/retestEngine";
import { CoinSnapshot } from "@/lib/types";
import { SIGNAL_STATE_THEME, COLOR_CLASS, getSignalDisplayTheme } from "./statusTheme";

// 多個A級訊號同時出現時的排序：引擎本身沒有「品質/置信度」這種評分欄位（二元判斷系統，
// 符合條件就是符合），所以用「訊號確認時間，越新排越前面」當唯一、誠實的排序依據——
// 越新的訊號離4小時到期時間越遠，資訊也最新。這是顯示排序，不影響哪些訊號會顯示、
// 也不影響Entry/SL/TP怎麼算。
export function sortByRecency(signals: LiveSignal[]): LiveSignal[] {
  return [...signals].sort((a, b) => (b.signalTime ?? 0) - (a.signalTime ?? 0));
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-panel p-4 mb-3 ${className}`}>{children}</section>;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-subtext mb-2">{children}</div>;
}

// 小圓點狀態指示，取代大量emoji的用法（改版規格：不要使用太多Emoji）。
export function StatusDot({ color, label, size = "sm" }: { color: keyof typeof COLOR_CLASS; label?: string; size?: "sm" | "md" }) {
  const c = COLOR_CLASS[color];
  const dotSize = size === "md" ? "w-2.5 h-2.5" : "w-2 h-2";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`rounded-full ${dotSize} ${c.dot}`} />
      {label && <span className={`text-xs ${c.text}`}>{label}</span>}
    </span>
  );
}

export function StateBadge({ state }: { state: keyof typeof SIGNAL_STATE_THEME }) {
  const theme = SIGNAL_STATE_THEME[state];
  return <StatusDot color={theme.color} label={theme.label} />;
}

function fmtPrice(n: number | null) {
  if (n == null) return "—";
  return n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toPrecision(4);
}

// A級訊號卡（可進場中）— 首頁跟機會頁共用同一張卡片樣式。
// stats（策略勝率／期望值）是選填：來自樣本外驗證的整體數字，不是這一筆訊號專屬的預測值，
// 首頁會註明「策略歷史數據」避免使用者誤會成這筆訊號保證的結果。
export function SignalCard({
  s,
  linkToDetail = true,
  stats,
}: {
  s: LiveSignal;
  linkToDetail?: boolean;
  stats?: { winRate: number; expectancy: number };
}) {
  const theme = getSignalDisplayTheme(s);
  const c = COLOR_CLASS[theme.color];
  const isActive = s.state === "RETEST_CONFIRMED";
  const inner = (
    <div className={`rounded-2xl border p-4 mb-3 ${isActive ? `${c.bg} ${c.border}` : "bg-panel border-border"}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-lg font-display font-bold">
          {s.symbol.replace("USDT", "")}
          <span className="text-subtext text-sm font-normal"> / USDT</span>
        </span>
        {s.direction && (
          <span className={`text-sm font-semibold ${s.direction === "LONG" ? "text-bull" : "text-bear"}`}>
            {s.direction === "LONG" ? "做多" : "做空"}
          </span>
        )}
      </div>
      <div className="mb-3">
        <StatusDot color={theme.color} label={theme.label} size="md" />
      </div>
      {isActive ? (
        <div className="grid grid-cols-3 gap-2 text-center mb-2">
          <div>
            <div className="text-subtext text-xs mb-0.5">進場價</div>
            <div className="font-semibold numeric-safe text-base">{fmtPrice(s.entryPrice)}</div>
          </div>
          <div>
            <div className="text-subtext text-xs mb-0.5">止損</div>
            <div className="font-semibold numeric-safe text-base text-bear">{fmtPrice(s.stopLoss)}</div>
          </div>
          <div>
            <div className="text-subtext text-xs mb-0.5">止盈（TP）</div>
            <div className="font-semibold numeric-safe text-base text-bull">{fmtPrice(s.takeProfit)}</div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-subtext">現價 {fmtPrice(s.currentPrice)}</div>
      )}
      {isActive && stats && (
        <div className="flex items-center gap-4 text-xs text-subtext border-t border-border/60 pt-2 mt-1">
          <span>
            策略勝率 <span className="text-text font-medium numeric-safe">{stats.winRate.toFixed(0)}%</span>
          </span>
          <span>
            期望值{" "}
            <span className={`font-medium numeric-safe ${stats.expectancy >= 0 ? "text-bull" : "text-bear"}`}>
              {stats.expectancy >= 0 ? "+" : ""}
              {stats.expectancy.toFixed(2)}R
            </span>
          </span>
        </div>
      )}
      {s.signalTime && (
        <div className="text-[10px] text-subtext mt-2">訊號時間 {new Date(s.signalTime * 1000).toLocaleTimeString("zh-TW", { hour12: false })}</div>
      )}
      {linkToDetail && <div className="text-xs text-bull mt-2">查看完整訊號 →</div>}
    </div>
  );
  return linkToDetail ? <Link href={`/signal/${s.symbol}`}>{inner}</Link> : inner;
}

// 機會頁/市場頁用的精簡列表列。
export function SignalListRow({ s }: { s: LiveSignal }) {
  const theme = getSignalDisplayTheme(s);
  return (
    <Link
      href={`/signal/${s.symbol}`}
      className="flex items-center justify-between rounded-xl bg-panel2 px-4 py-3 mb-2 active:scale-[0.99] transition"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold">
          {s.symbol.replace("USDT", "")} <span className="text-subtext text-xs font-normal">/ USDT</span>
        </div>
        {s.direction && (
          <div className={`text-xs ${s.direction === "LONG" ? "text-bull" : "text-bear"}`}>
            {s.direction === "LONG" ? "做多" : "做空"}
          </div>
        )}
      </div>
      <StatusDot color={theme.color} label={theme.label} />
    </Link>
  );
}

export function EmptyState({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="text-center py-8">
      <StatusDot color="grey" />
      <div className="text-sm text-subtext mt-3">{text}</div>
      {sub && <div className="text-xs text-subtext mt-1 opacity-70">{sub}</div>}
    </div>
  );
}

function fmtCoinPrice(n: number) {
  return n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toPrecision(4);
}

// 8幣種即時市場精簡表格 — 首頁跟市場頁共用，避免同樣的表格寫兩次。
export function MarketMiniTable({
  symbols,
  coins,
  signals,
}: {
  symbols: string[];
  coins: CoinSnapshot[];
  signals: Record<string, LiveSignal>;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-subtext border-b border-border">
          <th className="text-left font-normal py-2 px-1">幣種</th>
          <th className="text-right font-normal py-2 px-1">價格</th>
          <th className="text-right font-normal py-2 px-1">24H</th>
          <th className="text-right font-normal py-2 px-1">狀態</th>
        </tr>
      </thead>
      <tbody>
        {symbols.map((symbol) => {
          const coin = coins.find((c) => c.id === symbol);
          const signal = signals[symbol];
          const theme = signal ? getSignalDisplayTheme(signal) : null;
          return (
            <tr key={symbol} className="border-b border-border/60 last:border-0">
              <td className="py-2 px-1 font-medium">{symbol.replace("USDT", "")}</td>
              <td className="text-right py-2 px-1 numeric-safe">{coin ? fmtCoinPrice(coin.price) : "—"}</td>
              <td className={`text-right py-2 px-1 numeric-safe ${coin && coin.change24h >= 0 ? "text-bull" : "text-bear"}`}>
                {coin ? `${coin.change24h >= 0 ? "+" : ""}${coin.change24h.toFixed(1)}%` : "—"}
              </td>
              <td className="text-right py-2 px-1">
                {theme ? <StatusDot color={theme.color} label={theme.label} /> : <span className="text-subtext text-xs">—</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
