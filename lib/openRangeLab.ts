// 美東時區工具（America/New_York，含DST自動切換）。
//
// 這是「回踩策略」整套系統（retestCore.ts / retestEngine.ts / retestStrategyLab.ts /
// volumeBreakoutLab.ts）共用的時區換算工具，用瀏覽器原生 Intl.DateTimeFormat，
// 夏令時間(DST)由系統時區資料庫自動處理，沒有寫死偏移量。
//
// 【清理紀錄】這個檔案原本是「美股開盤區間突破 Lab」的完整實作（30/60分鐘開盤區間、
// TP/SL模擬），後來被「回踩策略」取代，該部分已於全站清理沒有用到的程式碼時移除，
// 只留下仍在使用中的 getETInfo()。

export interface ETInfo {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string; // "Mon".."Sun"
}

export function getETInfo(unixSeconds: number): ETInfo {
  const d = new Date(unixSeconds * 1000);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // en-US的 hour12:false 有時會給 "24" 代表午夜
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}
