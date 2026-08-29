"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "首頁", icon: "🏠" },
  { href: "/opportunities", label: "機會", icon: "🔥" },
  { href: "/market", label: "市場", icon: "📊" },
  { href: "/journal", label: "交易", icon: "📖" },
  { href: "/settings", label: "設定", icon: "⚙️" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-panel"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-md mx-auto grid grid-cols-5">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center gap-0.5 py-2 min-h-[52px] active:scale-95 transition"
            >
              <span className={`text-lg leading-none ${active ? "" : "opacity-60"}`}>{item.icon}</span>
              <span className={`text-[11px] leading-none ${active ? "text-accent font-semibold" : "text-subtext"}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
