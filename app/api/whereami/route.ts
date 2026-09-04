import { NextResponse } from "next/server";

// 診斷工具：查詢這個Vercel serverless function實際是從哪個IP、哪個地區發出請求的。
// 用來確認上一步指定的hkg1機房設定到底有沒有生效，還是Vercel免費方案不支援自訂地區、
// 依然跑在預設機房——不用猜，直接問一個公開的IP查詢服務就知道。
export const preferredRegion = "hkg1";

export async function GET() {
  try {
    const res = await fetch("https://ipapi.co/json/", { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json({
      ip: data.ip,
      city: data.city,
      region: data.region,
      country: data.country_name,
      org: data.org,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
