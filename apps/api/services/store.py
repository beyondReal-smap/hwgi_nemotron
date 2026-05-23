"""페르소나 데이터 인메모리 저장소 (parquet + numpy 매트릭스).

설계:
- 앱 부팅 시 1회 로드 → 글로벌 싱글톤
- 룰 필터: pandas boolean indexing (수 ms)
- 임베딩 유사도: 정규화된 임베딩 매트릭스로 dot product (10만 행 < 50ms)
- Phase 5에서 Supabase 백엔드로 swap 가능하도록 인터페이스 분리
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd


def _re_escape(s: str) -> str:
    """직업 키워드를 regex로 안전하게 사용 (특수문자 escape)."""
    return re.escape(s)

# 프로젝트 루트 기준 경로 (100만 행 인메모리 — npy 5.8GB / parquet 930MB)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_PARQUET = _PROJECT_ROOT / "data" / "personas_1m.parquet"
DEFAULT_NPY = _PROJECT_ROOT / "data" / "embeddings_1m_v2.npy"

# 지역명 표기 단축 (도 → 약칭). 데이터셋 원본은 일부만 줄여져 있어 일관성 부여.
# 광역시·특별시·강원·경기·제주는 이미 짧거나 통용 표기 그대로 유지.
_PROVINCE_SHORT_MAP = {
    "경상남": "경남",
    "경상북": "경북",
    "충청남": "충남",
    "충청북": "충북",
    "전라남": "전남",
    # '전북'은 데이터셋 원본이 이미 단축형이라 매핑 불필요
}


@dataclass
class FilterParams:
    """룰 기반 사전 필터링 파라미터.

    필드가 None/빈 리스트면 해당 조건 무시.
    """

    age_min: int | None = None
    age_max: int | None = None
    sex: list[str] | None = None
    provinces: list[str] | None = None        # 시도 (정확 매칭)
    marital_statuses: list[str] | None = None  # 혼인상태 (정확 매칭): 미혼/배우자있음/사별/이혼
    family_types: list[str] | None = None
    education_levels: list[str] | None = None
    # occupations은 부분 매칭이라 따로 처리
    occupations: list[str] | None = None
    # 고용 상태 — "employed"=occupation이 "무직"이 아닌 모든 사람, "unemployed"=occupation="무직"
    employment: str | None = None  # Literal["employed","unemployed"] | None
    # 동적 필터 — 위에 명시 필드 외의 컬럼에 isin 필터 적용 (예: housing_type, bachelors_field, military_status)
    # 허용 컬럼은 ALLOWED_DYNAMIC_COLUMNS 화이트리스트로 강제.
    additional_filters: dict[str, list[str]] | None = None


# 동적 필터 허용 컬럼 — 보안·정합성을 위해 명시적 허용 목록만 통과
ALLOWED_DYNAMIC_COLUMNS: tuple[str, ...] = (
    "housing_type",
    "bachelors_field",
    "military_status",
    "district",
)


class PersonaStore:
    """페르소나 데이터 + 임베딩 매트릭스 인메모리 저장소."""

    def __init__(self, df: pd.DataFrame, embeddings: np.ndarray) -> None:
        if len(df) != len(embeddings):
            raise ValueError(f"df 행 수({len(df)}) != embeddings 행 수({len(embeddings)})")
        self.df = df.reset_index(drop=True)
        # L2 정규화는 쿼리 시점 온디맨드로 처리하여 전체 복사본 RAM 점유 방지 (mmap 유지)
        self.embeddings = embeddings

    @property
    def total(self) -> int:
        return len(self.df)

    def filter_indices(self, params: FilterParams) -> np.ndarray:
        """룰 필터를 통과하는 행 인덱스 반환."""
        df = self.df
        mask = pd.Series(True, index=df.index)

        if params.age_min is not None:
            mask &= df["age"] >= params.age_min
        if params.age_max is not None:
            mask &= df["age"] <= params.age_max
        if params.sex:
            mask &= df["sex"].isin(params.sex)
        if params.provinces:
            mask &= df["province"].isin(params.provinces)
        if params.marital_statuses:
            mask &= df["marital_status"].isin(params.marital_statuses)
        if params.family_types:
            mask &= df["family_type"].isin(params.family_types)
        if params.education_levels:
            mask &= df["education_level"].isin(params.education_levels)
        if params.occupations:
            # 직업명 부분 매칭 (예: "의사" → "치과 일반 의사", "한의사" 모두 매칭)
            pattern = "|".join(map(_re_escape, params.occupations))
            mask &= df["occupation"].fillna("").str.contains(pattern, regex=True, na=False)
        if params.employment == "employed":
            # 직장인 = "무직"이 아닌 모든 사람 (KSCO 구체 직업명)
            mask &= df["occupation"].fillna("") != "무직"
        elif params.employment == "unemployed":
            mask &= df["occupation"].fillna("") == "무직"

        # 동적 필터 — 허용 컬럼만, isin 정확 매칭
        if params.additional_filters:
            for col, values in params.additional_filters.items():
                if col not in ALLOWED_DYNAMIC_COLUMNS:
                    continue  # 허용 목록 외 컬럼 무시
                if not values:
                    continue
                if col not in df.columns:
                    continue
                mask &= df[col].isin(values)

        return df.index[mask].to_numpy()

    def cosine_topk(
        self,
        query_vec: np.ndarray,
        candidate_indices: np.ndarray,
        top_k: int,
    ) -> tuple[np.ndarray, np.ndarray]:
        """candidate_indices 중에서 query_vec와 코사인 유사도 상위 top_k 반환.

        Returns:
            (indices, scores) — 각각 길이 top_k
        """
        if len(candidate_indices) == 0:
            return np.array([], dtype=np.int64), np.array([], dtype=np.float32)

        # query 정규화
        q_norm = np.linalg.norm(query_vec)
        if q_norm == 0:
            return np.array([], dtype=np.int64), np.array([], dtype=np.float32)
        q = (query_vec / q_norm).astype(np.float32)

        # 후보들의 임베딩 슬라이스 (mmap 상태에서 필요한 조각만 슬라이스로 로드)
        cand_emb = self.embeddings[candidate_indices]  # (N, 1536)
        
        # 쿼리 시점 온디맨드 코사인 유사도 연산 (dot product / ||cand||)
        sims = cand_emb @ q  # (N,)
        cand_norms = np.linalg.norm(cand_emb, axis=1)
        cand_norms[cand_norms == 0] = 1.0
        sims = sims / cand_norms

        # 상위 top_k 추출
        k = min(top_k, len(sims))
        top_local = np.argpartition(-sims, k - 1)[:k]  # 정렬 안 됨
        top_local = top_local[np.argsort(-sims[top_local])]  # 정렬

        return candidate_indices[top_local], sims[top_local]

    def get_rows(self, indices: np.ndarray) -> pd.DataFrame:
        """인덱스 → 행 DataFrame 슬라이스."""
        return self.df.iloc[indices]


# ============================================================
# 싱글톤 로더 (앱 수명주기 1회 로드)
# ============================================================

@lru_cache(maxsize=1)
def get_store() -> PersonaStore:
    """글로벌 PersonaStore 인스턴스. 첫 호출 시 디스크에서 로드.

    환경변수:
    - PERSONAS_PARQUET: parquet 경로 (기본: data/personas_100k.parquet)
    - PERSONAS_NPY: npy 경로 (기본: data/embeddings_100k.npy)
    """
    parquet_path = Path(os.environ.get("PERSONAS_PARQUET", str(DEFAULT_PARQUET)))
    npy_path = Path(os.environ.get("PERSONAS_NPY", str(DEFAULT_NPY)))

    if not parquet_path.exists():
        raise FileNotFoundError(f"parquet 없음: {parquet_path}")
    if not npy_path.exists():
        raise FileNotFoundError(f"npy 없음: {npy_path} — scripts/embed_personas.py 실행 필요")

    df = pd.read_parquet(parquet_path)

    # province 표기 일관화: 도(道)는 약칭으로 통일 (광역시·특별시는 원본 유지)
    df["province"] = df["province"].replace(_PROVINCE_SHORT_MAP)
    # district는 "province-시군구" 형식이라 prefix도 동일하게 변환
    _district_pattern = "^(" + "|".join(_PROVINCE_SHORT_MAP) + ")-"
    df["district"] = df["district"].str.replace(
        _district_pattern,
        lambda m: _PROVINCE_SHORT_MAP[m.group(1)] + "-",
        regex=True,
    )

    # 카테고리 최적화로 RAM 절감
    for col in ["sex", "province", "marital_status", "family_type", "education_level"]:
        if col in df.columns:
            df[col] = df[col].astype("category")
    # npy 매트릭스를 mmap_mode="r" 옵션으로 가볍게 로딩 (RAM 0바이트 수준 점유 유도)
    embeddings = np.load(npy_path, mmap_mode="r")
    return PersonaStore(df, embeddings)
