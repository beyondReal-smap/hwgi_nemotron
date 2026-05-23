import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// monorepo root .env를 명시적으로 로드 (Next.js는 apps/web/.env만 자동 인식)
// 빌드 시 NEXT_PUBLIC_* 가 client bundle에 인라인되려면 process.env에 미리 채워져 있어야 함.
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envText = readFileSync(resolve(__dirname, "../../.env"), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
} catch {
  // .env 없으면 무시 (각 변수 fallback이 처리)
}

/** @type {import('next').NextConfig} */
const API_INTERNAL_URL =
  process.env.API_INTERNAL_URL ?? "http://127.0.0.1:5102";

const nextConfig = {
  env: {
    // client에서 사용하는 public env — 빌드 시 인라인
    NEXT_PUBLIC_KAKAO_MAP_APPKEY: process.env.NEXT_PUBLIC_KAKAO_MAP_APPKEY ?? "",
  },
  // FastAPI 백엔드는 외부에 직접 노출하지 않고 Next.js를 통해 프록시.
  // 브라우저는 동일 오리진(5101)으로 fetch → CORS 불필요.
  //
  // 분석 + 의견 생성(40콜 LLM)이 60-150초 걸리므로 프록시 timeout을 5분으로 늘림.
  // (Next.js 14 experimental.proxyTimeout, ms 단위)
  experimental: {
    proxyTimeout: 300_000,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_INTERNAL_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
