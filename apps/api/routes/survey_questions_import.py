"""설문 질문 파일 업로드·파싱 API.

엔드포인트:
  POST /api/surveys/questions/parse-file          — multipart 파일 → 파싱 결과
  GET  /api/surveys/questions/template/excel      — 표준 Excel 템플릿
  GET  /api/surveys/questions/template/word       — 표준 Word 템플릿

마법사 Step 3에서 survey 저장 전에 호출되므로 survey_id 불필요.
프론트가 파싱 결과를 받아 미리보기·수정 후 wizard state에 병합/교체.
"""

from __future__ import annotations

import logging
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from services.question_parser import (
    ParseResult,
    build_excel_template,
    build_word_template,
    parse_question_file,
)

logger = logging.getLogger("personafit.questions_import")

router = APIRouter(prefix="/api/surveys/questions", tags=["surveys_questions_import"])

MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5MB
SUPPORTED_EXT = (".xlsx", ".xls", ".csv", ".docx")


@router.post("/parse-file", response_model=ParseResult)
async def parse_file(file: UploadFile = File(...)) -> ParseResult:
    if not file.filename:
        raise HTTPException(status_code=400, detail="파일 이름이 없습니다")

    name_lower = file.filename.lower()
    if not name_lower.endswith(SUPPORTED_EXT):
        raise HTTPException(
            status_code=415,
            detail=f"지원하지 않는 형식. {', '.join(SUPPORTED_EXT)}만 가능합니다",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="빈 파일입니다")
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail=f"파일이 너무 큽니다 (최대 {MAX_FILE_SIZE_BYTES // 1024 // 1024}MB)")

    try:
        return parse_question_file(file.filename, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("파일 파싱 실패: %s", file.filename)
        raise HTTPException(status_code=500, detail=f"파싱 실패: {e}") from e


@router.get("/template/excel")
def template_excel() -> StreamingResponse:
    data = build_excel_template()
    filename = "personafit_질문_템플릿.xlsx"
    encoded = quote(filename, safe="")
    return StreamingResponse(
        iter([data]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": (
                f'attachment; filename="personafit_template.xlsx"; '
                f"filename*=UTF-8''{encoded}"
            ),
        },
    )


@router.get("/template/word")
def template_word() -> StreamingResponse:
    data = build_word_template()
    filename = "personafit_질문_템플릿.docx"
    encoded = quote(filename, safe="")
    return StreamingResponse(
        iter([data]),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": (
                f'attachment; filename="personafit_template.docx"; '
                f"filename*=UTF-8''{encoded}"
            ),
        },
    )
