"""PersonaFit FastAPI 진입점.

현재는 헬스체크만 노출. Phase 2-3에서 /api/analyze 라우터를 추가한다.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 프로젝트 루트의 .env 로드 (모노레포 기준)
load_dotenv(dotenv_path="../../.env")

# 애플리케이션 로거 INFO 출력 (uvicorn 로거와 별도) — survey_run/engine 진행 추적
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logging.getLogger("personafit").setLevel(logging.INFO)

logger = logging.getLogger("personafit.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 부팅 시 100만 행 페르소나 store를 사전 로드(~17초).

    이유: lazy 로드 시 첫 분석 요청이 store 로드 시간만큼 추가로 소요되어
    Next.js proxy(~30s)에서 ECONNRESET이 발생. 부팅 시 한 번 로드해두면
    이후 모든 분석은 평균 ~22초 안에 완료.
    """
    from services.store import get_store

    try:
        store = get_store()
        logger.info("페르소나 store 사전 로드 완료: %d행", store.total)
    except Exception:
        # 데이터 미준비 시에도 앱은 기동되어 /health 등은 응답하도록 (Phase 1 흐름 호환)
        logger.exception("페르소나 store 사전 로드 실패 — lazy 로드로 폴백")

    # 수동 재시작·크래시로 끊긴 설문(status='running')을 자동 이어 돌림.
    # completed 세션은 답변 캐시로 즉시 통과되므로 비용은 미완료분만 발생.
    try:
        from services.survey_run import resume_stale_running_surveys
        resumed = await resume_stale_running_surveys()
        if resumed:
            logger.info("startup 자동 재개 설문: %d건", resumed)
    except Exception:
        logger.exception("stale survey 자동 재개 실패 — 앱은 계속 기동")

    yield


app = FastAPI(title="PersonaFit API", version="0.1.0", lifespan=lifespan)

# CORS — 환경변수에서 콤마 구분 도메인 파싱, 기본은 Next.js 로컬
_cors_origins = os.getenv("API_CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in _cors_origins if origin.strip()],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, bool | str]:
    """헬스체크. 부팅 검증 및 외부 모니터링용."""
    return {"ok": True, "service": "personafit-api"}


from routes.analyses import router as analyses_router  # noqa: E402
from routes.analyze import router as analyze_router  # noqa: E402
from routes.dataset import router as dataset_router  # noqa: E402
from routes.extract import router as extract_router  # noqa: E402
from routes.segments import router as segments_router  # noqa: E402
from routes.simulate import router as simulate_router  # noqa: E402
from routes.survey_progress import router as survey_progress_router  # noqa: E402
from routes.survey_questions_import import router as survey_questions_import_router  # noqa: E402
from routes.survey_report import router as survey_report_router  # noqa: E402
from routes.survey_responses import router as survey_responses_router  # noqa: E402
from routes.survey_run import router as survey_run_router  # noqa: E402
from routes.surveys import router as surveys_router  # noqa: E402

app.include_router(analyze_router)
app.include_router(extract_router)
app.include_router(analyses_router)
app.include_router(simulate_router)
app.include_router(dataset_router)
app.include_router(surveys_router)
app.include_router(survey_questions_import_router)
app.include_router(survey_run_router)
app.include_router(survey_progress_router)
app.include_router(survey_responses_router)
app.include_router(survey_report_router)
app.include_router(segments_router)
