"""보험 약관 PDF 카탈로그 라우트.

- GET  /api/products            → insurance/ 폴더의 약관 PDF 목록 + 본문 가용 여부
- GET  /api/products/{id}/body  → 약관 본문 텍스트 (PDF에서 추출, txt 캐시)

데이터 소스:
- insurance/<파일명>.pdf           (대표님이 폴더에 둔 한화 약관 PDF — 런타임 스캔)
- data/products/bodies/<id>.txt    (PDF에서 추출된 텍스트 캐시 — mtime 비교로 자동 갱신)

폴더에 PDF를 추가/삭제하면 별도 크롤러 실행 없이 드롭다운에 자동 반영된다
(2026-06-01 결정: catalog.json 크롤러 산출물 → insurance/ 폴더 직접 스캔으로 교체).
한글 파일명은 안정적인 SHA1 해시(12자)를 id로 부여해 URL-safe + path traversal을 차단한다.
"""

from __future__ import annotations

import hashlib
import logging
import unicodedata
from datetime import datetime, timezone
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

# 데이터 경로 — apps/api/main.py 의 BASE 기준으로 ../../insurance, ../../data/products
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
INSURANCE_DIR = _PROJECT_ROOT / "insurance"
BODY_DIR = _PROJECT_ROOT / "data" / "products" / "bodies"

# 파일명 키워드 → 카테고리 (위에서부터 우선순위. 첫 매칭 채택)
_CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("운전자", ("운전자",)),
    ("자동차", ("자동차", "이륜", "마일리지", "캐롯자동차")),
    ("연금·저축", ("연금", "저축")),
    ("화재·재산·기업", ("화재", "재산", "주택", "가정생활", "농기계", "기업", "owner")),
    ("건강·의료", ("암", "건강", "치아", "치료", "어린이", "실손", "여성", "간편", "종합보험")),
]
_DEFAULT_CATEGORY = "기타"


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


def _product_id(filename: str) -> str:
    """파일명 → 안정적인 12자 해시 id (ASCII, URL-safe, traversal-free)."""
    return hashlib.sha1(filename.encode("utf-8")).hexdigest()[:12]


def _display_name(stem: str) -> str:
    """파일명을 NFC로 정규화한 표시용 문자열.

    insurance/ PDF 파일명은 NFD(자모 분리)로 저장돼 있어, NFC로 정규화하지 않으면
    한글 키워드 매칭과 프론트 표시에서 깨진다. 디스크 접근에는 원본 파일명을 쓴다.
    """
    return unicodedata.normalize("NFC", stem)


def _categorize(stem: str) -> str:
    """파일명(확장자 제외)을 키워드로 분류."""
    lowered = _display_name(stem).lower()
    for category, keywords in _CATEGORY_RULES:
        if any(kw.lower() in lowered for kw in keywords):
            return category
    return _DEFAULT_CATEGORY


def _scan_pdfs() -> list[Path]:
    """insurance/ 폴더의 PDF를 파일명 가나다순으로 반환."""
    if not INSURANCE_DIR.is_dir():
        raise HTTPException(
            status_code=503,
            detail=(
                "약관 PDF 폴더(insurance/)가 없습니다. "
                "프로젝트 루트에 insurance/ 폴더를 만들고 약관 PDF를 넣어주세요."
            ),
        )
    return sorted(
        (p for p in INSURANCE_DIR.glob("*.pdf") if p.is_file()),
        key=lambda p: p.name,
    )


def _find_pdf_by_id(product_id: str) -> Path | None:
    """해시 id로 insurance/ 폴더의 PDF 경로를 역매핑."""
    for pdf in _scan_pdfs():
        if _product_id(pdf.name) == product_id:
            return pdf
    return None


def _resolve_body(pdf_path: Path, product_id: str) -> tuple[str, Literal["pdf", "txt"]]:
    """약관 본문 텍스트 + 출처 반환.

    캐시(bodies/<id>.txt)가 PDF보다 최신이면 캐시를, 아니면 PDF에서 추출 후 캐시.
    """
    txt_path = BODY_DIR / f"{product_id}.txt"
    if txt_path.exists() and txt_path.stat().st_mtime >= pdf_path.stat().st_mtime:
        return txt_path.read_text(encoding="utf-8"), "txt"

    try:
        text = extract_from_bytes(pdf_path.read_bytes(), pdf_path.name)
    except (UnsupportedFormatError, FileTooLargeError, TextExtractionError) as e:
        raise HTTPException(status_code=422, detail=f"PDF 추출 실패: {e}") from e
    BODY_DIR.mkdir(parents=True, exist_ok=True)
    txt_path.write_text(text, encoding="utf-8")
    logger.info("body cached: %s (%d chars)", product_id, len(text))
    return text, "pdf"


def _body_chars(product_id: str, pdf_path: Path) -> int | None:
    """캐시된 본문 글자수 (PDF보다 최신인 캐시가 있을 때만). 없으면 None."""
    txt_path = BODY_DIR / f"{product_id}.txt"
    if txt_path.exists() and txt_path.stat().st_mtime >= pdf_path.stat().st_mtime:
        try:
            return len(txt_path.read_text(encoding="utf-8"))
        except OSError:
            return None
    return None


@router.get("", response_model=ProductCatalog)
def list_products() -> ProductCatalog:
    """insurance/ 폴더의 약관 PDF 목록. PDF는 항상 본문 추출 가능."""
    pdfs = _scan_pdfs()
    summaries: list[ProductSummary] = []
    for pdf in pdfs:
        display = _display_name(pdf.stem)
        pid = _product_id(pdf.name)
        summaries.append(
            ProductSummary(
                id=pid,
                name=display,
                official_name=display,
                category=_categorize(pdf.stem),
                page_url="",
                body_available=True,  # PDF가 존재하므로 항상 추출 가능
                body_chars=_body_chars(pid, pdf),
            )
        )
    return ProductCatalog(
        source="insurance/ (약관 PDF 폴더)",
        fetched_at=datetime.now(timezone.utc).isoformat(),
        count=len(summaries),
        products=summaries,
    )


@router.get("/{product_id}/body", response_model=ProductBody)
def get_product_body(product_id: str) -> ProductBody:
    """특정 약관 PDF의 본문 텍스트. 캐시(bodies/<id>.txt)가 최신이면 캐시 반환."""
    pdf_path = _find_pdf_by_id(product_id)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail=f"상품을 찾을 수 없습니다: {product_id}")

    text, source = _resolve_body(pdf_path, product_id)
    return ProductBody(
        id=product_id,
        name=_display_name(pdf_path.stem),
        text=text,
        chars=len(text),
        source=source,
    )
