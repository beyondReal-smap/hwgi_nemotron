/**
 * PersonaFit pm2 ecosystem
 *
 * 사용법:
 *   pm2 start ecosystem.config.cjs
 *   pm2 status
 *   pm2 logs personafit-web
 *   pm2 logs personafit-api
 *   pm2 restart all
 *   pm2 stop all
 *   pm2 delete all
 *
 * 외부 접근: http://<host>:5101  (Next.js)
 * 내부 전용: http://127.0.0.1:5102  (FastAPI, Next.js rewrites만 호출)
 */

const path = require("path");
const PROJECT_ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: "personafit-api",
      cwd: path.join(PROJECT_ROOT, "apps/api"),
      // uv가 .venv를 자동 활성화
      script: ".venv/bin/uvicorn",
      // timeout-keep-alive: 분석 + 의견 생성이 60-150초 걸리므로 idle 끊김 방지 (기본 5초 → 300초)
      args:
        "main:app --host 127.0.0.1 --port 5102 --workers 1 --timeout-keep-alive 300",
      interpreter: "none",
      // 환경변수: .env가 main.py 안에서 load_dotenv로 로드되므로 별도 지정 불필요
      env: {
        PYTHONUNBUFFERED: "1",
        // 통합 임베딩(7종 페르소나 + 3종 속성 텍스트) — 2026-05-21 전환. store.py 기본값과 동일하므로 명시는 documentation 목적.
        // 롤백: data/.archive/2026-05-22_v1-npy/embeddings_1m.npy를 data/로 복원 후 이 줄 → "data/embeddings_1m.npy"로 변경 + pm2 restart.
        PERSONAS_NPY: path.join(PROJECT_ROOT, "data/embeddings_1m_v2.npy"),
      },
      max_memory_restart: "30G",  // 100만 행 인메모리: 실측 RSS ~23GB (npy 6GB + DataFrame + 정규화본)
      autorestart: true,
      max_restarts: 10,
      out_file: path.join(PROJECT_ROOT, "logs/api-out.log"),
      error_file: path.join(PROJECT_ROOT, "logs/api-err.log"),
      time: true,
    },
    {
      name: "personafit-web",
      cwd: path.join(PROJECT_ROOT, "apps/web"),
      // Next.js 14 production 서버 — dotenv-cli로 루트 .env 자동 로드
      // (런타임 process.env용. NEXT_PUBLIC_*의 클라이언트 인라인은 빌드 시점에 결정되므로
      //  코드 수정 후 반드시 `pnpm --filter web build` 먼저 실행할 것)
      script: "node_modules/.bin/dotenv",
      args:
        "-e ../../.env -- node_modules/.bin/next start -H 0.0.0.0 -p 5101",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        API_INTERNAL_URL: "http://127.0.0.1:5102",
      },
      // 1G는 분석 응답 처리 시 일시 스파이크에 빠듯. 호스트 메모리(285GB free) 여유 있으니 4G로 상향
      max_memory_restart: "4G",
      autorestart: true,
      max_restarts: 10,
      out_file: path.join(PROJECT_ROOT, "logs/web-out.log"),
      error_file: path.join(PROJECT_ROOT, "logs/web-err.log"),
      time: true,
    },
  ],
};
