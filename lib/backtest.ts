// 交易成本常數，跨多個回測/即時引擎共用。
//
// 【清理紀錄】這個檔案原本是A級策略（Opportunity Score系統）的完整歷史回測引擎
// （runBacktest/auditTrades/gradeStrategy等），後來被「回踩策略」整套系統取代，
// 該部分已於全站清理沒有用到的程式碼時移除，只留下仍在使用中的手續費/滑價常數
// （lib/openRangeLab.ts、lib/volumeBreakoutLab.ts、lib/retestStrategyLab.ts 都會用到）。

export const FEE_PCT = 0.1;
export const SLIPPAGE_PCT = 0.05;
