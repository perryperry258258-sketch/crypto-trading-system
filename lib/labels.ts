export const lightStyle: Record<string, { label: string; className: string }> = {
  GO: { label: "🟢 可以交易", className: "bg-bull/15 text-bull border-bull/40" },
  CAUTION: { label: "🟡 謹慎交易", className: "bg-warn/15 text-warn border-warn/40" },
  NO_TRADE: { label: "🔴 今天不要交易", className: "bg-bear/15 text-bear border-bear/40" },
};

export const regimeLabel: Record<string, string> = {
  BULL: "🟢 上升",
  SIDEWAYS: "🟡 震盪",
  BEAR: "🔴 下降",
  EUPHORIA: "🔥 過熱",
  PANIC: "💀 恐慌",
};

export const regimeLabelFull: Record<string, string> = {
  BULL: "🟢 BULL 多頭",
  SIDEWAYS: "🟡 SIDEWAYS 盤整",
  BEAR: "🔴 BEAR 空頭",
  EUPHORIA: "🔥 EUPHORIA 過熱",
  PANIC: "💀 PANIC 恐慌",
};
