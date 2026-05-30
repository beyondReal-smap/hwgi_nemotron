"""자동차 특약 상품들에 모상품(CA00044001) 약관 PDF를 hardlink로 alias.

자동차 특약(ECO마일리지·첨단안전장치·퍼마일 등)은 한화 사이트에 별도 PDF가
게시되지 않고 모상품인 '개인용 자동차보험(CA00044001)'의 약관에 모두 통합되어
있다. 따라서 같은 inode를 공유하는 hardlink로 본문을 alias한다.

hardlink 선택 이유:
  - symlink는 절대/상대 경로 깨질 위험 (배포·이동 시)
  - hardlink는 mtime이 원본과 동일 → API의 mtime 기반 캐시(`apps/api/routes/products.py`)가
    원본 갱신 시 자동으로 재추출 트리거
  - 같은 파일시스템 내라 원본 파일 1개만큼만 디스크 사용
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PDF_DIR = ROOT / "data" / "products" / "pdfs"

SOURCE = "CA00044001"  # 한화 개인용 자동차보험 (모상품, 8개 특약을 모두 포함)
ALIAS_IDS = [
    "CA00077001",  # ECO마일리지 특약
    "CA00088002",  # 첨단안전장치 특약
    "CA00088003",  # 커넥티드카 할인특약
    "CA00088004",  # 안전운전점수 할인특약
    "CA00088005",  # 후측방충돌방지장치 할인특약
    "CA00088006",  # 어라운드뷰모니터장착 할인특약
    "CA00088007",  # 헤드업디스플레이장착 할인특약
    "CA00100001",  # 퍼마일 특별약관(월정산형)
]


def main() -> None:
    src = PDF_DIR / f"{SOURCE}.pdf"
    if not src.exists():
        raise SystemExit(f"source PDF not found: {src}")
    print(f"source: {src.name} ({src.stat().st_size:,} bytes)")

    for pid in ALIAS_IDS:
        dst = PDF_DIR / f"{pid}.pdf"
        if dst.exists():
            if dst.samefile(src):
                print(f"  ✓ skip {pid} (already hardlinked)")
            else:
                print(f"  ! skip {pid} (independent file exists, size={dst.stat().st_size:,})")
            continue
        os.link(src, dst)
        print(f"  ✓ link {pid}.pdf → {SOURCE}.pdf")


if __name__ == "__main__":
    main()
