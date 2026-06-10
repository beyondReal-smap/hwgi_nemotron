"""POST /api/analyze/stream — 분석을 SSE로 단계별 스트리밍.

기존 /api/analyze(블로킹)와 동일 파이프라인이지만, 각 단계가 끝날 때마다 부분 결과를
Server-Sent Events로 흘려보낸다. 리포트 LLM이 수십 초 걸려도 소구점→스코어→세그먼트→
의견이 먼저 화면에 박혀 들어와 체감 대기가 ~6초로 줄어든다.

운영 경로(Cloudflare Tunnel → Next.js rewrites → FastAPI)에서 버퍼링되지 않도록
`X-Accel-Buffering: no`(nginx)와 `Cache-Control: no-cache`를 응답 헤더로 준다.
프론트가 스트리밍을 못 받으면 기존 블로킹 /api/analyze로 graceful fallback 한다.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from time import perf_counter

import numpy as np
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from openai import UnprocessableEntityError

from models.schemas import AnalyzeRequest
from services.llm import embed_text, extract_selling_points, stream_report
from services.opinions import generate_persona_opinions
from services.persistence import persist_analysis
from services.pii_mask import mask_pii
from services.scoring import build_query_text, score_personas
from services.segment_discovery import discover_segments
from services.store import get_store

logger = logging.getLogger("personafit.analyze_stream")

router = APIRouter(prefix="/api", tags=["analyze"])


def _sse(event: str, data: dict) -> str:
    """SSE 프레임 직렬화. 한글 보존(ensure_ascii=False)."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


@router.post("/analyze/stream")
async def analyze_stream(req: AnalyzeRequest) -> StreamingResponse:
    """상품 텍스트 → 단계별 SSE 스트림(selling_points/score/opinions/report/done)."""

    async def gen() -> AsyncIterator[str]:
        elapsed: dict[str, int] = {}
        overall_t0 = perf_counter()
        try:
            product_text = mask_pii(req.product_text)

            # 1) 소구점 추출
            t0 = perf_counter()
            sp = await asyncio.to_thread(extract_selling_points, product_text, req.llm_provider)
            elapsed["selling_points"] = int((perf_counter() - t0) * 1000)
            yield _sse("selling_points", {"selling_points": sp.model_dump(), "elapsed_ms": elapsed})

            # 2) 임베딩 + 스코어링 + 세그먼트 (가장 큰 '첫 결과' 덩어리)
            t0 = perf_counter()
            query_vec = np.array(
                await asyncio.to_thread(embed_text, build_query_text(sp)), dtype=np.float32
            )
            elapsed["embed"] = int((perf_counter() - t0) * 1000)

            store = get_store()
            t0 = perf_counter()
            (
                top_personas,
                mid_personas,
                bottom_personas,
                province_stats,
                district_stats,
                population_stats,
                cohort_indices,
                all_scores,
            ) = await asyncio.to_thread(score_personas, sp, query_vec, store)
            elapsed["score"] = int((perf_counter() - t0) * 1000)

            if not top_personas:
                yield _sse("error", {"status": 422, "detail": "매칭된 페르소나가 없습니다. 입력 조건이 너무 좁습니다."})
                return

            t0 = perf_counter()
            segments = await asyncio.to_thread(
                discover_segments, store, cohort_indices["target"], all_scores
            )
            elapsed["segments"] = int((perf_counter() - t0) * 1000)

            sliced_top = top_personas[: req.top_k]
            yield _sse("score", {
                "top_personas": [p.model_dump() for p in sliced_top],
                "mid_personas": [p.model_dump() for p in mid_personas],
                "bottom_personas": [p.model_dump() for p in bottom_personas],
                "province_stats": [r.model_dump() for r in province_stats],
                "district_stats": [r.model_dump() for r in district_stats],
                "population_stats": population_stats.model_dump(),
                "segments": [s.model_dump() for s in segments],
                "elapsed_ms": elapsed,
            })

            # 3) 페르소나 의견 (상/중/하 병렬)
            t0 = perf_counter()
            top_opinions, mid_opinions, bottom_opinions = await asyncio.gather(
                generate_persona_opinions(top_personas, sp, provider=req.llm_provider),
                generate_persona_opinions(mid_personas, sp, provider=req.llm_provider),
                generate_persona_opinions(bottom_personas, sp, provider=req.llm_provider),
            )
            elapsed["opinions"] = int((perf_counter() - t0) * 1000)
            yield _sse("opinions", {
                "top_opinions": [o.model_dump() for o in top_opinions],
                "mid_opinions": [o.model_dump() for o in mid_opinions],
                "bottom_opinions": [o.model_dump() for o in bottom_opinions],
                "elapsed_ms": elapsed,
            })

            # 4) 리포트 — 토큰 단위 스트리밍(가장 오래 걸리는 단계가 타이핑되듯 흘러든다).
            #    동기 LLM 스트림 generator를 to_thread로 한 청크씩 당겨 SSE로 흘린다.
            t0 = perf_counter()
            report_parts: list[str] = []
            report_iter = await asyncio.to_thread(
                stream_report, sp, top_personas, population_stats, req.llm_provider
            )
            sentinel = object()
            while True:
                chunk = await asyncio.to_thread(next, report_iter, sentinel)
                if chunk is sentinel:
                    break
                report_parts.append(chunk)
                yield _sse("report_token", {"chunk": chunk})
            report_md = "".join(report_parts).strip()
            elapsed["report"] = int((perf_counter() - t0) * 1000)
            yield _sse("report", {"report_md": report_md, "elapsed_ms": elapsed})

            # 5) 영속화 + done
            elapsed["total"] = int((perf_counter() - overall_t0) * 1000)
            analysis_id = persist_analysis({
                "product_text": product_text[:500],
                "selling_points": sp.model_dump(),
                "top_personas": [p.model_dump() for p in sliced_top],
                "mid_personas": [p.model_dump() for p in mid_personas],
                "bottom_personas": [p.model_dump() for p in bottom_personas],
                "province_stats": [r.model_dump() for r in province_stats],
                "district_stats": [r.model_dump() for r in district_stats],
                "population_stats": population_stats.model_dump(),
                "top_opinions": [o.model_dump() for o in top_opinions],
                "mid_opinions": [o.model_dump() for o in mid_opinions],
                "bottom_opinions": [o.model_dump() for o in bottom_opinions],
                "report_md": report_md,
                "segments": [s.model_dump() for s in segments],
                "elapsed_ms": elapsed,
                "llm_provider": req.llm_provider,
            })
            yield _sse("done", {"analysis_id": analysis_id, "elapsed_ms": elapsed})

        except UnprocessableEntityError:
            logger.warning("스트리밍 분석 입력 거부(PII 등)")
            yield _sse("error", {
                "status": 422,
                "detail": "입력에 처리할 수 없는 개인정보(주민등록번호·카드번호 등)가 포함되어 있습니다. 해당 정보를 제거한 뒤 다시 시도해 주세요.",
            })
        except Exception as e:
            logger.exception("스트리밍 분석 실패")
            yield _sse("error", {"status": 502, "detail": f"분석 오류: {e}"})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # nginx가 이 응답만 버퍼링하지 않도록(전역 설정 변경 불필요).
            "X-Accel-Buffering": "no",
        },
    )
