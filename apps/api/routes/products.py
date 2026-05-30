"""한화일반보험 상품 카탈로그 라우트.

- GET  /api/products            → 30개 상품 메타 + 약관 본문 가용 여부
- GET  /api/products/{id}/body  → 약관 본문 텍스트 (수동 업로드된 PDF에서 추출)

데이터 소스:
- data/products/catalog.json      (scripts/crawler/hwgi_crawl.py 산출물)
- data/products/pdfs/<id>.pdf     (대표님이 한화 사이트에서 직접 받아둔 약관 PDF)
- data/products/bodies/<id>.txt   (PDF에서 추출된 텍스트 캐시 — mtime 비교로 자동 갱신)

한화 사이트는 anti-bot 보호로 PDF 자동 다운로드가 막혀 있어, 약관 본문은
수동 업로드 워크플로우로 운영한다 (2026-05-26 결정).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.text_extractor import (
    FileTooLargeError,
    TextExtractionError,
    UnsupportedFormatError,
    extract_from_bytes,
)

logger = logging.getLogger("personafit.products")

router = APIRouter(prefix="/api/products", tags=["products"])

# 데이터 경로 — apps/api/main.py 의 BASE 기준으로 ../../data
DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "products"
CATALOG_PATH = DATA_DIR / "catalog.json"
PDF_DIR = DATA_DIR / "pdfs"
BODY_DIR = DATA_DIR / "bodies"

# 카탈로그 캐시 — 파일 mtime이 바뀌면 재로드
_catalog_cache: dict | None = None
_catalog_mtime: float | None = None


class ProductSummary(BaseModel):
    id: str
    name: str
    official_name: str
    category: str
    page_url: str
    body_available: bool
    body_chars: int | None = None


class ProductCatalog(BaseModel):
    source: str
    fetched_at: str
    count: int
    products: list[ProductSummary]


class ProductBody(BaseModel):
    id: str
    name: str
    text: str
    chars: int
    source: Literal["pdf", "txt"]


def _load_catalog() -> dict:
    """카탈로그 JSON을 mtime 기반으로 lazy-load."""
    global _catalog_cache, _catalog_mtime

    if not CATALOG_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail=(
                "상품 카탈로그가 아직 생성되지 않았습니다. "
                "scripts/crawler/hwgi_crawl.py 를 실행하세요."
            ),
        )

    mtime = CATALOG_PATH.stat().st_mtime
    if _catalog_cache is None or _catalog_mtime != mtime:
        _catalog_cache = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        _catalog_mtime = mtime
        logger.info("catalog reloaded: %d products", _catalog_cache.get("count", 0))
    return _catalog_cache


def _resolve_body(product_id: str) -> tuple[str, Literal["pdf", "txt"]] | None:
    """약관 본문 텍스트를 반환 + 출처 표시.

    우선순위:
      1) bodies/<id>.txt 존재 + (pdfs/<id>.pdf 없거나 txt가 더 최신) → txt 그대로
      2) pdfs/<id>.pdf 존재 → 추출 후 bodies/<id>.txt 캐시 후 반환
      3) 둘 다 없음 → None
    """
    txt_path = BODY_DIR / f"{product_id}.txt"
    pdf_path = PDF_DIR / f"{product_id}.pdf"

    txt_exists = txt_path.exists()
    pdf_exists = pdf_path.exists()

    if not txt_exists and not pdf_exists:
        return None

    # 캐시가 PDF보다 최신이면 그대로 사용
    if txt_exists and (not pdf_exists or txt_path.stat().st_mtime >= pdf_path.stat().st_mtime):
        return txt_path.read_text(encoding="utf-8"), "txt"

    # PDF에서 추출 후 캐시
    try:
        text = extract_from_bytes(pdf_path.read_bytes(), pdf_path.name)
    except (UnsupportedFormatError, FileTooLargeError, TextExtractionError) as e:
        raise HTTPException(status_code=422, detail=f"PDF 추출 실패: {e}") from e
    BODY_DIR.mkdir(parents=True, exist_ok=True)
    txt_path.write_text(text, encoding="utf-8")
    logger.info("body cached: %s (%d chars)", product_id, len(text))
    return text, "pdf"


def _body_meta(product_id: str) -> tuple[bool, int | None]:
    """약관 본문 가용 여부 + 캐시된 글자수 (없으면 None)."""
    txt_path = BODY_DIR / f"{product_id}.txt"
    if txt_path.exists():
        try:
            return True, len(txt_path.read_text(encoding="utf-8"))
        except OSError:
            return True, None
    if (PDF_DIR / f"{product_id}.pdf").exists():
        return True, None  # PDF는 있지만 아직 추출 전
    return False, None


@router.get("", response_model=ProductCatalog)
def list_products() -> ProductCatalog:
    """30개 상품 메타 + 각 상품의 약관 본문 가용 여부."""
    cat = _load_catalog()
    summaries: list[ProductSummary] = []
    for p in cat["products"]:
        available, chars = _body_meta(p["id"])
        summaries.append(
            ProductSummary(
                id=p["id"],
                name=p["name"],
                official_name=p.get("official_name") or p["name"],
                category=p.get("category") or "기타",
                page_url=p["page_url"],
                body_available=available,
                body_chars=chars,
            )
        )
    return ProductCatalog(
        source=cat["source"],
        fetched_at=cat["fetched_at"],
        count=len(summaries),
        products=summaries,
    )


@router.get("/{product_id}/body", response_model=ProductBody)
def get_product_body(product_id: str) -> ProductBody:
    """특정 상품의 약관 본문 텍스트.

    PDF가 data/products/pdfs/<id>.pdf 로 업로드되어 있어야 한다.
    텍스트 캐시(bodies/<id>.txt)가 PDF보다 최신이면 캐시를 그대로 반환.
    """
    cat = _load_catalog()
    product = next((p for p in cat["products"] if p["id"] == product_id), None)
    if product is None:
        raise HTTPException(status_code=404, detail=f"상품을 찾을 수 없습니다: {product_id}")

    result = _resolve_body(product_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"약관 본문이 아직 등록되지 않았습니다. "
                f"data/products/pdfs/{product_id}.pdf 로 약관 PDF를 업로드하세요."
            ),
        )
    text, source = result
    return ProductBody(
        id=product_id,
        name=product.get("official_name") or product["name"],
        text=text,
        chars=len(text),
        source=source,
    )
