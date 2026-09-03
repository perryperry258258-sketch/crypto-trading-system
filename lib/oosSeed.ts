import type { OosSummary, OosTradeRecord } from "./signalLog";

// 內建預設樣本外資料（永久保存用）。
//
// 目的：localStorage 換裝置/換瀏覽器/清資料就會不見，這裡放一份寫死在程式碼裡的備用資料，
// 當 localStorage 讀不到東西時自動 fallback 用這份，不用每次都重跑一次2年回測。
//
// 目前還是空的（null），等使用者跑完「一鍵執行完整分析」→「匯出樣本外資料」→
// 把產生的文字貼過來，就把下面的 OOS_SEED 換成那份真實資料。
export const OOS_SEED: { summary: OosSummary; trades: OosTradeRecord[] } | null = null;
