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

// 顯示層細分：EXPIRED這個狀態底下其實有兩種不同情況——
// (a) 曾經確認回踩、可以進場，但4小時內沒等到停損或停利就到期了 → 這其實是「錯過進場」，
//     使用者如果那段時間沒看到，就真的錯過了這次機會，跟單純「這次沒有形成訊號」意義不同。
// (b) 從頭到尾沒有確認回踩就過期（突破後沒回踩，或回踩失敗）→ 維持原本的「已過期」。
// 這只是把 evaluateLiveSignal() 已經算出來的 state + retestTime 兩個既有欄位拿來組合判斷，
// 沒有新增或修改任何交易判斷邏輯，純粹是顯示文字的細分。
export function getSignalDisplayTheme(s: { state: SignalState; retestTime: number | null }): StatusTheme {
  if (s.state === "EXPIRED" && s.retestTime != null) {
    return { color: "yellow", label: "錯過進場" };
  }
  return SIGNAL_STATE_THEME[s.state];
}
