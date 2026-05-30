"""한화일반보험 카탈로그(`data/products/catalog.json`) 기반 약관 PDF 일괄 다운로더.

흐름:
  1. 카탈로그에서 상품 메타 로드 (id, page_url, name)
  2. Playwright stealth 컨텍스트로 각 상품 상세 페이지 접속
  3. hidden input `id="insClaUrlAdr"` value 추출 → PDF 절대 URL 구성 (한글 경로 quote)
  4. 같은 컨텍스트의 APIRequestContext로 PDF GET (쿠키 공유 + Referer 명시)
  5. 매직바이트 `%PDF` 검증 후 `data/products/pdfs/<상품id>.pdf` 로 저장
  6. 이미 존재하면 skip → 재실행 시 누락분만 보강 (idempotent)
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

from playwright.async_api import Page, async_playwright
from playwright_stealth import Stealth

BASE = "https://www.hwgeneralins.com"
ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "products"
CATALOG = DATA / "catalog.json"
PDF_DIR = DATA / "pdfs"

PDF_URL_RE = re.compile(r'id="insClaUrlAdr"\s+value="([^"]+)"')


def to_absolute_pdf_url(rel: str) -> str | None:
    """한글이 섞인 상대경로를 절대 URL로 변환 (segment별 quote)."""
    rel = rel.strip()
    if not rel:
        return None
    if rel.startswith("http"):
        return rel
    if not rel.startswith("/"):
        rel = "/" + rel
    encoded = "/" + "/".join(quote(seg) for seg in rel.split("/")[1:])
    return BASE + encoded


async def fetch_pdf_url(page: Page, page_url: str) -> str | None:
    try:
        await page.goto(BASE + page_url, wait_until="domcontentloaded", timeout=60_000)
        await asyncio.sleep(1.2)  # 스크립트 hydration 안정화
        html = await page.content()
    except Exception as e:
        print(f"  ! navigate error: {type(e).__name__}: {e}")
        return None
    m = PDF_URL_RE.search(html)
    if not m:
        return None
    return to_absolute_pdf_url(m.group(1))


async def download_pdf(page: Page, pdf_url: str, referer: str, dest: Path) -> int | None:
    try:
        resp = await page.context.request.get(
            pdf_url,
            headers={"Referer": referer},
            timeout=120_000,
        )
    except Exception as e:
        print(f"  ! download error: {type(e).__name__}: {e}")
        return None
    if resp.status != 200:
        print(f"  ! HTTP {resp.status}")
        return None
    ct = (resp.headers.get("content-type") or "").lower()
    body = await resp.body()
    if "pdf" not in ct and not body.startswith(b"%PDF"):
        print(f"  ! not pdf (content-type={ct}, head={body[:8]!r})")
        return None
    if not body.startswith(b"%PDF"):
        # content-type만 맞고 매직바이트가 다르면 오염된 응답으로 간주
        print(f"  ! magic bytes mismatch: {body[:8]!r}")
        return None
    dest.write_bytes(body)
    return len(body)


async def main() -> None:
    if not CATALOG.exists():
        print(f"catalog not found: {CATALOG}", file=sys.stderr)
        sys.exit(1)
    PDF_DIR.mkdir(parents=True, exist_ok=True)

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    products = catalog["products"]
    print(f"target products: {len(products)}")
    print(f"output dir   : {PDF_DIR}")

    summary: dict[str, list[str]] = {"ok": [], "skip": [], "no_url": [], "failed": []}

    async with Stealth().use_async(async_playwright()) as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 900},
            locale="ko-KR",
        )
        page = await ctx.new_page()
        page.on("dialog", lambda d: asyncio.create_task(d.dismiss()))

        for i, prod in enumerate(products, 1):
            pid = prod["id"]
            name = prod["name"]
            page_url = prod["page_url"]
            dest = PDF_DIR / f"{pid}.pdf"
            print(f"\n[{i:>2}/{len(products)}] {pid}  {name}")

            if dest.exists() and dest.stat().st_size > 0:
                print(f"  ✓ skip (already exists, {dest.stat().st_size:,} bytes)")
                summary["skip"].append(pid)
                continue

            pdf_url = await fetch_pdf_url(page, page_url)
            if not pdf_url:
                print("  ! insClaUrlAdr 없음 → 본문에 약관 URL이 박혀있지 않음")
                summary["no_url"].append(pid)
                continue
            print(f"  → {pdf_url}")

            referer = BASE + page_url
            size = await download_pdf(page, pdf_url, referer, dest)
            if size:
                print(f"  ✓ saved {dest.name} ({size:,} bytes)")
                summary["ok"].append(pid)
            else:
                summary["failed"].append(pid)
            await asyncio.sleep(0.6)  # 서버 부하 완화

        await browser.close()

    print("\n=== summary ===")
    print(f"  ok      : {len(summary['ok'])}")
    print(f"  skip    : {len(summary['skip'])}")
    print(f"  no_url  : {len(summary['no_url'])}  {summary['no_url']}")
    print(f"  failed  : {len(summary['failed'])}  {summary['failed']}")


if __name__ == "__main__":
    asyncio.run(main())
