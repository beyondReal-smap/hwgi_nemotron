"""Nemotron-Personas-Korea 데이터셋 탐색 스크립트.

목적:
- 컬럼 스키마, 타입, 누락값 빠르게 확인
- 처음 N개 샘플의 지역/연령/직업 분포 파악
- 페르소나 텍스트 길이 분포 확인
"""

from __future__ import annotations

import json
from collections import Counter

from datasets import load_dataset

DATASET_ID = "nvidia/Nemotron-Personas-Korea"
SAMPLE_SIZE = 200


def main() -> None:
    print(f"📥 streaming 모드로 {DATASET_ID} 로드 중...")
    ds = load_dataset(DATASET_ID, split="train", streaming=True)

    # 첫 SAMPLE_SIZE개 수집
    rows: list[dict] = []
    for i, row in enumerate(ds):
        if i >= SAMPLE_SIZE:
            break
        rows.append(row)
    print(f"✅ 샘플 {len(rows)}개 수집 완료\n")

    # 1) 컬럼 스키마
    print("=" * 60)
    print("📋 컬럼 스키마")
    print("=" * 60)
    first = rows[0]
    for col, val in first.items():
        sample_repr = (str(val)[:60] + "...") if isinstance(val, str) and len(str(val)) > 60 else val
        print(f"  - {col:35s} ({type(val).__name__:6s}) :: {sample_repr}")

    # 2) 카테고리 컬럼 분포 (sample 기준)
    print("\n" + "=" * 60)
    print("📊 카테고리 분포 (sample 200개 기준)")
    print("=" * 60)
    for col in ["sex", "marital_status", "education_level", "housing_type", "family_type", "province"]:
        cnt = Counter(r.get(col) for r in rows)
        top = cnt.most_common(10)
        print(f"\n[{col}] (총 {len(cnt)}종)")
        for k, v in top:
            print(f"  {k:30s}: {v}")

    # 3) 연령 분포
    print("\n" + "=" * 60)
    print("👥 연령 분포")
    print("=" * 60)
    ages = [r["age"] for r in rows]
    print(f"  min={min(ages)}, max={max(ages)}, mean={sum(ages)/len(ages):.1f}")
    age_buckets = Counter((a // 10) * 10 for a in ages)
    for bucket in sorted(age_buckets):
        print(f"  {bucket}대: {age_buckets[bucket]}")

    # 4) 페르소나 텍스트 길이
    print("\n" + "=" * 60)
    print("📝 페르소나 텍스트 길이 (글자수)")
    print("=" * 60)
    persona_cols = [
        "persona",
        "professional_persona",
        "sports_persona",
        "arts_persona",
        "travel_persona",
        "culinary_persona",
        "family_persona",
    ]
    for col in persona_cols:
        lengths = [len(r[col]) for r in rows if r.get(col)]
        if lengths:
            print(f"  {col:25s}: min={min(lengths)}, max={max(lengths)}, mean={sum(lengths)/len(lengths):.0f}")

    # 5) 직업 상위 20
    print("\n" + "=" * 60)
    print("💼 직업 분포 상위 20")
    print("=" * 60)
    occ = Counter(r["occupation"] for r in rows)
    for k, v in occ.most_common(20):
        print(f"  {k:40s}: {v}")

    # 6) 대표 샘플 1개 (종합 페르소나만)
    print("\n" + "=" * 60)
    print("🎭 대표 샘플 (첫 번째 행, 종합 페르소나)")
    print("=" * 60)
    sample = rows[0]
    print(f"  uuid     : {sample['uuid']}")
    print(f"  성별/나이 : {sample['sex']}, {sample['age']}세")
    print(f"  지역     : {sample['province']} {sample['district']}")
    print(f"  직업     : {sample['occupation']}")
    print(f"  교육     : {sample['education_level']}")
    print(f"  주거     : {sample['housing_type']}")
    print(f"\n  [persona]")
    print(f"  {sample['persona']}")

    # 7) JSON으로 첫 3개 저장
    out_path = "/home/jin/ai_hack/scripts/sample_personas.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rows[:3], f, ensure_ascii=False, indent=2)
    print(f"\n💾 첫 3개 행을 {out_path}에 저장")


if __name__ == "__main__":
    main()
