// 방문 로그 조회 프록시 — 브라우저에 ADMIN_TOKEN을 노출하지 않고 서버에서만 백엔드로 전달한다.
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:5102";
const TOKEN = process.env.ADMIN_TOKEN ?? "";

export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get("limit") ?? "200";
  const r = await fetch(`${API}/api/visitors?limit=${encodeURIComponent(limit)}`, {
    headers: { "X-Admin-Token": TOKEN },
    cache: "no-store",
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "Content-Type": "application/json" },
  });
}
