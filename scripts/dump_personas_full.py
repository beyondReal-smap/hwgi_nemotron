"""Nemotron-Personas-Korea 100만 행 전체 → parquet (stratified 없이).

10만 샘플(sample_personas.py)과 별도로, 제출용·임베딩용 풀 데이터를 만든다.
입력 동일 (HuggingFace 데이터셋), 출력 경로만 다름.
"""

from __future__ import annotations

import os
import sys

import pandas as pd
from datasets import load_dataset

DATASET_ID = "nvidia/Nemotron-Personas-Korea"
OUTPUT_PATH = "data/personas_1m.parquet"

# scripts/sample_personas.py와 동일 컬럼 (호환성)
KEEP_COLS = [
    "uuid",
    "persona",
    "professional_persona",
    "sports_persona",
    "arts_persona",
    "travel_persona",
    "culinary_persona",
    "family_persona",
    "skills_and_expertise",
    "hobbies_and_interests",
    "career_goals_and_ambitions",
    "sex",
    "age",
    "marital_status",
    "military_status",
    "family_type",
    "housing_type",
    "education_level",
    "bachelors_field",
    "occupation",
    "district",
    "province",
]


def main() -> None:
    print(f"📥 데이터셋 로드: {DATASET_ID}")
    ds = load_dataset(DATASET_ID, split="train")
    print(f"   원본 행 수: {len(ds):,}")

    df = ds.to_pandas()
    missing = [c for c in KEEP_COLS if c not in df.columns]
    if missing:
        sys.exit(f"❌ 누락된 컬럼: {missing}")
    df = df[KEEP_COLS]

    # 분포 요약 (검증용)
    print(f"\n📊 province (상위 5):")
    print(df["province"].value_counts().head().to_string())
    print(f"\n📊 sex: {dict(df['sex'].value_counts())}")
    print(f"📊 age: min={df['age'].min()}, max={df['age'].max()}, mean={df['age'].mean():.1f}")

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    print(f"\n💾 parquet 저장 중... ({OUTPUT_PATH})")
    df.to_parquet(OUTPUT_PATH, index=False, compression="zstd")
    size_mb = os.path.getsize(OUTPUT_PATH) / 1024 / 1024
    print(f"✅ 완료: {len(df):,}행, {size_mb:.1f}MB")


if __name__ == "__main__":
    main()
