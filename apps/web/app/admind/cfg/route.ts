// 관리자 LLM 설정 프록시 — 서버사이드에서 ADMIN_TOKEN(.env)을 자동 주입해 백엔드를 호출한다.
// 토큰이 클라이언트(브라우저)에 노출되지 않으면서, 백엔드 admin API의 X-Admin-Token 보호는 유지.
// next.config의 /api/* rewrites를 타지 않도록 /api 밖 경로(/admind/cfg)에 둔다.
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:5102";
const TOKEN = process.env.ADMIN_TOKEN ?? "";

export async function GET() {
  const r = await fetch(`${API}/api/admin/llm-config`, {
    headers: { "X-Admin-Token": TOKEN },
    cache: "no-store",
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const r = await fetch(`${API}/api/admin/llm-config`, {
    method: "POST",
    headers: { "X-Admin-Token": TOKEN, "Content-Type": "application/json" },
    body,
    cache: "no-store",
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "Content-Type": "application/json" },
  });
}
