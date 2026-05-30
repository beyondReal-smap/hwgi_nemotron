"""한화 공식 사이트(hwgeneralins.com)에 게시되지 않은 일부 상품의 약관을
한화 직판 채널(hwgi.kr) 등 외부 채널에서 보강 다운로드.

hwgeneralins.com의 hidden input `insClaUrlAdr`이 빈 값으로 노출되지 않는 상품 중,
hwgi.kr 같은 한화 다른 도메인에 PDF가 게시된 경우를 명시적 매핑으로 처리한다.

사용:
  .venv/bin/python hwgi_download_extras.py
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parents[2]
PDF_DIR = ROOT / "data" / "products" / "pdfs"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# 카탈로그 ID → 외부 채널 PDF 소스
EXTRA_SOURCES: dict[str, dict[str, str]] = {
    "FA00052011": {
        "url": "https://www.hwgi.kr/ver2/images/fire/OWNER(2604)_03.pdf",
        "referer": "https://www.hwgi.kr/fire",
        "note": "성공하는 Owner 재산종합보험 (한화 직판 채널 hwgi.kr)",
    },
}


def _encode_path(url: str) -> str:
    """경로 내 특수문자(한글·괄호 등)를 보수적으로 quote.
    `safe="()"`로 둬서 hwgi.kr의 OWNER(2604) 같이 괄호가 들어간 경로도 그대로 전송.
    """
    parsed = urlparse(url)
    segs = parsed.path.split("/")
    encoded_path = "/" + "/".join(quote(seg, safe="()") for seg in segs[1:])
    rebuilt = f"{parsed.scheme}://{parsed.netloc}{encoded_path}"
    if parsed.query:
        rebuilt += f"?{parsed.query}"
    return rebuilt


def download(pdf_url: str, referer: str, dest: Path) -> int:
    req = urllib.request.Request(
        _encode_path(pdf_url),
        headers={"User-Agent": UA, "Referer": referer},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read()
    if not body.startswith(b"%PDF"):
        raise SystemExit(f"  ✗ magic bytes mismatch: {body[:8]!r}")
    dest.write_bytes(body)
    return len(body)


def main() -> None:
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    print(f"output dir: {PDF_DIR}")

    summary = {"ok": [], "skip": []}
    for pid, info in EXTRA_SOURCES.items():
        dest = PDF_DIR / f"{pid}.pdf"
        if dest.exists() and dest.stat().st_size > 0:
            print(f"✓ skip {pid} (already exists, {dest.stat().st_size:,} bytes)")
            summary["skip"].append(pid)
            continue
        print(f"\n→ {pid}  {info['note']}")
        print(f"  {info['url']}")
        size = download(info["url"], info["referer"], dest)
        print(f"  ✓ saved {dest.name} ({size:,} bytes)")
        summary["ok"].append(pid)

    print(f"\n=== summary === ok={len(summary['ok'])}  skip={len(summary['skip'])}")


if __name__ == "__main__":
    main()
