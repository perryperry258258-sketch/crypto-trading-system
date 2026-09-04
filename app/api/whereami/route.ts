import { NextResponse } from "next/server";

// 診斷工具：查詢這個Vercel serverless function實際是從哪個IP、哪個地區發出請求的。
// 用來確認上一步指定的hkg1機房設定到底有沒有生效，還是Vercel免費方案不支援自訂地區、
// 依然跑在預設機房——不用猜，直接問一個公開的IP查詢服務就知道。
export const preferredRegion = "hkg1";

export async function GET() {
  try {
    // ipapi.co 對雲端主機IP常常會擋（跟這次要診斷的Binance問題本質類似），
    // 換成 ip-api.com（不同公司，限制規則不同），並且把原始回應整包印出來，
    // 這樣萬一這個也失敗，至少看得到真正的錯誤內容，不會又是一片空白。
    const res = await fetch("http://ip-api.com/json/", { cache: "no-store" });
    const raw = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(raw);
    } catch {
      // 不是合法JSON，raw會被原樣回傳
    }
    return NextResponse.json({
      httpStatus: res.status,
      rawResponse: raw.slice(0, 500),
      parsed: data,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
