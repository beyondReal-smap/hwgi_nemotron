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
        // 임베딩 v2 — 금융·소비 프로파일 제외(2026-05-31 롤백). 금융 hot-deck 개인추정 신빙성
        // 이슈로 fin_ 컬럼/임베딩 텍스트를 제거. parquet personas_1m.parquet(fin_ 드롭본)과 행순서 정합.
        // 금융 복원: 이 줄 → "data/embeddings_1m_v3_fin.npy" + parquet 백업(.archive/2026-05-31_finance-rollback/) 복원 + PersonaFilterPanel SHOW_FINANCE_FILTER=true + pm2 restart.
        PERSONAS_NPY: path.join(PROJECT_ROOT, "data/embeddings_1m_v2.npy"),
        // Docker 컨테이너 메모리 한계 48GB + 다른 PM2 앱 누적 사용으로 임베딩을 RAM 상주
        // 적재하면 OOM-killer SIGKILL 발생. mmap 모드로 페이지 캐시에 위임.
        // 컨테이너 한계가 풀리면 이 줄 제거 → RAM 상주로 cold 40~80초 문제 해소.
        PERSONAS_EMBED_MMAP: "1",
      },
      // 임베딩 6GB를 mmap이 아닌 RAM에 상주 적재(2026-05-28) + 요청 처리 시 cand_emb 일시 사본 등
      // 누적으로 RSS가 30GB 한계를 일시 초과하면 PM2가 SIGKILL → restart 폭주 발생.
      // 호스트 RAM 372GB라 여유 충분, 한계를 60G로 상향. 추후 ANN 인덱스 도입 시 재산정.
      max_memory_restart: "60G",
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
