"""한화일반보험 현재판매상품 카탈로그 크롤러.

- 한화 사이트는 anti-bot 보호로 상세 ajax(약관 PDF 등)는 차단되지만,
  헤더/사이드 메뉴 HTML은 stealth 적용 시 렌더링됨.
- 본 스크립트는 메뉴에 노출된 상품 코드(insGdcd) + 상품명 + 카테고리만 수집해
  data/products/catalog.json 으로 저장한다.
- 약관 PDF 본문은 별도 워크플로우(수동 업로드 → text_extractor)로 처리한다.

실행:
  cd scripts/crawler
  .venv/bin/python hwgi_crawl.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth

BASE = "https://www.hwgeneralins.com"
LIST_URL = f"{BASE}/notice/ir/product-ing01.do"
DETAIL_URL = f"{BASE}/product/catalog/product-info.do?insGdcd="

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data" / "products"
DATA_DIR.mkdir(parents=True, exist_ok=True)

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
)


CATEGORY_BLACKLIST = {
    "자동차",
    "운전자/상해",
    "건강/종합",
    "가족",
    "화재/재물",
    "기업",
    "기타",
    "여행",
    "연금/저축",
    "상해",
    "어린이",
    "종합",
    "암",
}

PREFIX_CATEGORY = {
    "CA": "자동차",
    "FA": "화재·배상·기업",
    "LA": "장기·건강·연금",
}


def fetch_menu_products(page) -> list[dict]:
    """상단/사이드 메뉴에서 노출된 상품 a 태그를 추출.

    - 이름은 ga-label 속성 우선(메뉴 inner HTML의 [HOT]/[새창] 노이즈 제거됨)
    - 카테고리 헤더 anchor(텍스트가 "자동차" 등 화이트리스트와 동일)는 제외
    """
    return page.evaluate(
        """() => {
          const anchors = Array.from(document.querySelectorAll('a[href*="product-info.do?insGdcd="]'));
          const BLACKLIST = new Set([
            '자동차','운전자/상해','건강/종합','가족','화재/재물','기업','기타',
            '여행','연금/저축','상해','어린이','종합','암'
          ]);
          const seen = new Map();
          for (const a of anchors) {
            const m = (a.getAttribute('href') || '').match(/insGdcd=([A-Z0-9]+)/);
            if (!m) continue;
            const id = m[1];
            const gaLabel = (a.getAttribute('ga-label') || '').trim();
            const raw = (a.innerText || a.textContent || '').replace(/\\s+/g, ' ')
              .replace(/\\[HOT\\]|\\[NEW\\]|\\[새창\\]/g, '').trim();
            const name = gaLabel || raw;
            if (!name || name.length > 100) continue;
            if (BLACKLIST.has(name)) continue;
            // 같은 id 중복: 더 긴(상세한) 이름 유지
            const prev = seen.get(id);
            if (!prev || name.length > prev.name.length) {
              seen.set(id, { id, name, page_url: '/product/catalog/product-info.do?insGdcd=' + id });
            }
          }
          return Array.from(seen.values()).sort((a, b) => a.id.localeCompare(b.id));
        }"""
    )


def category_of(product_id: str) -> str:
    """상품 코드 prefix 기반 카테고리 (한화 내부 분류 체계).

    CA = Casualty(자동차), FA = Fire & Allied(화재·배상·기업), LA = Long-term(장기·건강·연금)
    """
    prefix = product_id[:2].upper()
    return PREFIX_CATEGORY.get(prefix, "기타")


def enrich_with_detail_title(page, products: list[dict]) -> list[dict]:
    """각 상품의 product-info.do 페이지를 열어 페이지 title로 상품명 보정.

    메뉴에 "한화 시그니처 여성 건강보험4.0[새창]" 같은 노이즈가 섞일 수 있어,
    실제 페이지 title("한화손보 - 한화 시그니처 여성 건강보험4.0")에서
    "한화손보 - " 접두를 떼낸 값을 official_name으로 추가한다.
    """
    enriched: list[dict] = []
    total = len(products)
    for i, p in enumerate(products, 1):
        url = f"{BASE}{p['page_url']}"
        official = None
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            try:
                page.wait_for_load_state("networkidle", timeout=10_000)
            except Exception:
                pass
            title = (page.title() or "").strip()
            if title.startswith("한화손보 - "):
                official = title[len("한화손보 - ") :].strip()
            elif "한화손보" in title:
                official = title.replace("한화손보", "").strip(" -")
            else:
                official = title or None
        except Exception as e:  # noqa: BLE001
            print(f"  [{i}/{total}] {p['id']} skip: {e}", flush=True)
        out = dict(p)
        # title이 "한화손보"로만 오는 경우(상세 콘텐츠 로딩 실패) menu name 우선
        if not official or official.strip() == "한화손보":
            out["official_name"] = p["name"]
        else:
            out["official_name"] = official
        out["category"] = category_of(p["id"])
        enriched.append(out)
        print(f"  [{i}/{total}] {p['id']} | {out['category']:8s} → {out['official_name']}", flush=True)
    return enriched


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        )
        ctx = browser.new_context(
            user_agent=UA,
            viewport={"width": 1366, "height": 900},
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        )
        Stealth().apply_stealth_sync(ctx)
        page = ctx.new_page()
        # 한화 사이트는 anti-bot 감지 시 alert를 띄움 → 무조건 dismiss
        page.on("dialog", lambda d: d.dismiss())

        print(f"navigate → {LIST_URL}", flush=True)
        page.goto(LIST_URL, wait_until="domcontentloaded", timeout=60_000)
        try:
            page.wait_for_load_state("networkidle", timeout=20_000)
        except Exception:
            pass
        page.wait_for_timeout(3_000)

        products = fetch_menu_products(page)
        print(f"메뉴에서 추출된 고유 상품: {len(products)}개", flush=True)
        for p_ in products[:5]:
            print(f"  - {p_['id']} | {p_.get('category')} | {p_['name']}", flush=True)

        print("\n각 상품 상세 페이지에서 공식 명칭 보정 중...", flush=True)
        products = enrich_with_detail_title(page, products)

        browser.close()

    catalog = {
        "source": LIST_URL,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "count": len(products),
        "products": products,
    }
    out_path = DATA_DIR / "catalog.json"
    out_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n저장: {out_path} ({len(products)}개)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
