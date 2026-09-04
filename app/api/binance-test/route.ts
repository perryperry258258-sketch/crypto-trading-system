import { NextResponse } from "next/server";
import crypto from "crypto";

// Binance Testnet 連線測試——只查詢模擬帳戶餘額，完全不下單、不牽涉真實資金。
//
// 這是接自動下單之前的第一步：先確認API金鑰能不能正確簽章、連上Testnet、
// 讀到帳戶資訊。金鑰只從Vercel環境變數讀取，不會寫進任何程式碼檔案。
//
// 需要在 Vercel 環境變數設定：
// BINANCE_TESTNET_API_KEY
// BINANCE_TESTNET_API_SECRET
//
// 【地區限制修正】Binance會擋掉來自「受限制地區」的請求，Vercel serverless function
// 預設可能架在美國機房，容易被擋（HTTP 451）。這裡把這支API指定跑在香港機房(hkg1)，
// 離台灣近、理論上比較不容易被列為受限制地區——這是嘗試，不保證一定解決，如果還是
// 被擋，代表問題不是機房地區本身，需要別的做法（例如另外架一台代理伺服器）。
export const preferredRegion = "hkg1";

const TESTNET_BASE = "https://testnet.binance.vision";

export async function GET() {
  const apiKey = process.env.BINANCE_TESTNET_API_KEY;
  const apiSecret = process.env.BINANCE_TESTNET_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "還沒設定 BINANCE_TESTNET_API_KEY / BINANCE_TESTNET_API_SECRET 環境變數。" },
      { status: 500 }
    );
  }

  try {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = crypto.createHmac("sha256", apiSecret).update(queryString).digest("hex");

    const url = `${TESTNET_BASE}/api/v3/account?${queryString}&signature=${signature}`;
    const res = await fetch(url, {
      headers: { "X-MBX-APIKEY": apiKey },
      cache: "no-store",
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { error: `Binance回應 HTTP ${res.status}：${JSON.stringify(data)}` },
        { status: 502 }
      );
    }

    // 只回傳非零的資產，避免整包幾百種幣種的0餘額洗畫面
    const balances = (data.balances ?? []).filter(
      (b: { asset: string; free: string; locked: string }) => Number(b.free) > 0 || Number(b.locked) > 0
    );

    return NextResponse.json({
      accountType: data.accountType,
      canTrade: data.canTrade,
      balances,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
