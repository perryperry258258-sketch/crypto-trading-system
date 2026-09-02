import type { SignalState } from "@/lib/retestEngine";

// 視覺呈現用的狀態對照表。純UI層，只用 type-only import 拿 SignalState 的型別，
// 完全不碰 lib/retestEngine.ts 的判斷邏輯（那是交易引擎，這次改版禁止修改）。
//
// 顏色語意（UI/UX改版規格）：
// 綠 = 可以進場／已確認／獲利／正向
// 藍 = 等待回踩／進行中
// 黃 = 等待突破／注意
// 灰 = 觀察中／非交易時間／尚未開始／已過期
// 紅 = 止損／失效／風險／異常

export type StatusColor = "green" | "blue" | "yellow" | "grey" | "red";

export interface StatusTheme {
  color: StatusColor;
  label: string;
}

export const SIGNAL_STATE_THEME: Record<SignalState, StatusTheme> = {
  DATA_STALE: { color: "red", label: "資料異常" },
  NO_SESSION_TODAY: { color: "grey", label: "非交易時間" },
  BEFORE_WINDOW: { color: "grey", label: "尚未開始" },
  SETUP: { color: "grey", label: "觀察窗口中" },
  WATCHING: { color: "yellow", label: "等待突破" },
  WAIT_RETEST: { color: "blue", label: "等待回踩" },
  RETEST_CONFIRMED: { color: "green", label: "可以進場" },
  TP_HIT: { color: "green", label: "已獲利" },
  SL_HIT: { color: "red", label: "已止損" },
  EXPIRED: { color: "grey", label: "已過期" },
};

export const COLOR_CLASS: Record<
  StatusColor,
  { dot: string; text: string; bg: string; border: string }
> = {
  green: { dot: "bg-bull", text: "text-bull", bg: "bg-bull/10", border: "border-bull/30" },
  blue: { dot: "bg-info", text: "text-info", bg: "bg-info/10", border: "border-info/30" },
  yellow: { dot: "bg-warn", text: "text-warn", bg: "bg-warn/10", border: "border-warn/30" },
  grey: { dot: "bg-subtext", text: "text-subtext", bg: "bg-panel2", border: "border-border" },
  red: { dot: "bg-bear", text: "text-bear", bg: "bg-bear/10", border: "border-bear/30" },
};
