"""Nemotron-Personas-Korea 100만 행 → 10만 행 stratified 샘플링 → parquet 저장.

전략: province(17) × age_bucket(8) × sex(2) ≈ 272 셀.
각 셀의 행을 비례 추출하여 원본 분포를 보존하면서 1/10로 축소.

출력: data/personas_100k.parquet (Phase 1B의 embed_personas.py가 동일 파일 읽음)
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
from datasets import load_dataset

DATASET_ID = "nvidia/Nemotron-Personas-Korea"
TARGET_TOTAL = int(os.environ.get("SAMPLE_TARGET_TOTAL", 100_000))
OUTPUT_PATH = "data/personas_100k.parquet"
SEED = 42

# 8개 연령 버킷 (10대 ~ 80+)
AGE_BUCKETS: list[tuple[int, int]] = [
    (0, 19), (20, 29), (30, 39), (40, 49),
    (50, 59), (60, 69), (70, 79), (80, 999),
]

# parquet에 저장할 컬럼 (전체 26개 중 필수만, country는 모두 "대한민국" 단일값이라 제외)
KEEP_COLS = [
    "uuid",
    # 페르소나 텍스트 7종
    "persona",
    "professional_persona",
    "sports_persona",
    "arts_persona",
    "travel_persona",
    "culinary_persona",
    "family_persona",
    # 속성 텍스트
    "skills_and_expertise",
    "hobbies_and_interests",
    "career_goals_and_ambitions",
    # 인구통계
    "sex",
    "age",
    "marital_status",
    "military_status",
    "family_type",
    "housing_type",
    "education_level",
    "bachelors_field",
    "occupation",
    # 지역
    "district",
    "province",
]


def age_to_bucket(age: int) -> str:
    """연령 → 버킷 라벨 ('10s', '20s', ..., '80+')."""
    for low, high in AGE_BUCKETS:
        if low <= age <= high:
            return f"{low}s" if high < 999 else "80+"
    return "unknown"


def stratified_sample(df: pd.DataFrame, target: int, seed: int = SEED) -> pd.DataFrame:
    """province × age_bucket × sex 비례 stratified sampling.

    각 셀에서 (target / N_total) 비율로 추출. 1행 미만은 1행으로 라운드.
    셀별 추출 후 총합이 target과 다르면 무작위로 보정.
    """
    df = df.copy()
    df["age_bucket"] = df["age"].apply(age_to_bucket)

    n_total = len(df)
    frac = target / n_total

    # groupby 후 각 그룹에서 frac 비율 샘플링
    sampled = (
        df.groupby(["province", "age_bucket", "sex"], group_keys=False)
        .apply(
            lambda g: g.sample(
                n=max(1, int(round(len(g) * frac))),
                random_state=seed,
                replace=False,
            )
        )
    )

    # target 보정
    if len(sampled) > target:
        sampled = sampled.sample(n=target, random_state=seed)
    elif len(sampled) < target:
        # 부족분: 미선택 행에서 보충
        not_sampled = df.loc[~df.index.isin(sampled.index)]
        extra = not_sampled.sample(n=target - len(sampled), random_state=seed)
        sampled = pd.concat([sampled, extra], axis=0)

    return sampled.drop(columns=["age_bucket"]).reset_index(drop=True)


def main() -> None:
    print(f"📥 데이터셋 로드: {DATASET_ID}")
    ds = load_dataset(DATASET_ID, split="train")
    print(f"   원본 행 수: {len(ds):,}")

    # 전체를 pandas로 변환 (100만 행 × ~26컬럼 → 메모리 약 2-3GB)
    df = ds.to_pandas()
    missing = [c for c in KEEP_COLS if c not in df.columns]
    if missing:
        sys.exit(f"❌ 누락된 컬럼: {missing}")
    df = df[KEEP_COLS]

    print(f"🎲 stratified 샘플링 시작 (target={TARGET_TOTAL:,})")
    sampled = stratified_sample(df, TARGET_TOTAL)
    print(f"   샘플링된 행 수: {len(sampled):,}")

    # 분포 요약
    print("\n📊 province 분포 (상위 10):")
    print(sampled["province"].value_counts().head(10).to_string())

    print("\n📊 sex 분포:")
    print(sampled["sex"].value_counts().to_string())

    # 저장
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    sampled.to_parquet(OUTPUT_PATH, index=False, compression="zstd")
    size_mb = os.path.getsize(OUTPUT_PATH) / 1024 / 1024
    print(f"\n✅ 저장 완료: {OUTPUT_PATH} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
