"""POST /api/extract-text — 업로드 파일에서 텍스트 추출."""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from services.text_extractor import (
    ALLOWED_EXTENSIONS,
    FileTooLargeError,
    TextExtractionError,
    UnsupportedFormatError,
    extract_from_bytes,
)

logger = logging.getLogger("personafit.extract")

router = APIRouter(prefix="/api", tags=["extract"])


class ExtractResponse(BaseModel):
    filename: str
    char_count: int
    text: str
    truncated: bool


@router.post("/extract-text", response_model=ExtractResponse)
async def extract_text(file: UploadFile = File(...)) -> ExtractResponse:
    """파일을 받아 텍스트만 추출해 반환.

    프론트엔드는 응답의 `text`를 textarea에 채우고, 사용자는 그대로 분석 가능.
    """
    if not file.filename:
        raise HTTPException(status_code=422, detail="파일명이 비어 있습니다.")

    content = await file.read()

    try:
        text = extract_from_bytes(content, file.filename)
    except UnsupportedFormatError as e:
        raise HTTPException(status_code=415, detail=str(e)) from e
    except FileTooLargeError as e:
        raise HTTPException(status_code=413, detail=str(e)) from e
    except TextExtractionError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.exception("파일 추출 실패")
        raise HTTPException(status_code=500, detail=f"파일 처리 중 오류: {e}") from e

    return ExtractResponse(
        filename=file.filename,
        char_count=len(text),
        text=text,
        truncated=len(text) >= 20_000,
    )


@router.get("/extract-text/supported")
def supported_formats() -> dict:
    """지원 형식 목록 (UI에서 accept 속성 채울 때 사용)."""
    return {
        "extensions": sorted(ALLOWED_EXTENSIONS),
        "max_size_mb": 10,
    }
