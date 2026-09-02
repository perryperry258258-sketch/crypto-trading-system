import Link from "next/link";
import { LiveSignal } from "@/lib/retestEngine";
import { SIGNAL_STATE_THEME, COLOR_CLASS } from "./statusTheme";

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
export function SignalCard({ s, linkToDetail = true }: { s: LiveSignal; linkToDetail?: boolean }) {
  const theme = SIGNAL_STATE_THEME[s.state];
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
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="text-subtext mb-0.5">進場價</div>
            <div className="font-semibold numeric-safe">{fmtPrice(s.entryPrice)}</div>
          </div>
          <div>
            <div className="text-subtext mb-0.5">止損</div>
            <div className="font-semibold numeric-safe text-bear">{fmtPrice(s.stopLoss)}</div>
          </div>
          <div>
            <div className="text-subtext mb-0.5">止盈（1R）</div>
            <div className="font-semibold numeric-safe text-bull">{fmtPrice(s.takeProfit)}</div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-subtext">現價 {fmtPrice(s.currentPrice)}</div>
      )}
      {s.signalTime && (
        <div className="text-[10px] text-subtext mt-2">訊號時間 {new Date(s.signalTime * 1000).toLocaleTimeString("zh-TW", { hour12: false })}</div>
      )}
      {linkToDetail && <div className="text-xs text-bull mt-2">查看詳細資訊 →</div>}
    </div>
  );
  return linkToDetail ? <Link href={`/signal/${s.symbol}`}>{inner}</Link> : inner;
}

// 機會頁/市場頁用的精簡列表列。
export function SignalListRow({ s }: { s: LiveSignal }) {
  const theme = SIGNAL_STATE_THEME[s.state];
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
