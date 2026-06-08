"""페르소나 데이터 인메모리 저장소 (parquet + numpy 매트릭스).

설계:
- 앱 부팅 시 1회 로드 → 글로벌 싱글톤
- 룰 필터: pandas boolean indexing (수 ms)
- 임베딩 유사도: 사전 정규화 매트릭스 dot product (100만 행 brute-force ~84ms)
- npy는 부팅 시 RAM 상주 로드 (6GB). mmap은 cold page-cache 상태에서 fancy
  indexing이 40~80초까지 늘어져 자연어 검색 UX를 망가뜨려 제거. 시스템 RAM
  여유가 부족하면 PERSONAS_EMBED_MMAP=1 환경변수로 mmap 모드 강제 가능.
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
# KURE-v1(1024d) 재임베딩 산출물. 이전 OpenAI 1536d(embeddings_1m_v2.npy)는 PERSONAS_NPY로 전환 가능.
DEFAULT_NPY = _PROJECT_ROOT / "data" / "embeddings_1m_kure.npy"

# 지역명 표기 단축 (도 → 약칭). 데이터셋 원본은 일부만 줄여져 있어 일관성 부여.
# 광역시·특별시·강원·경기·제주는 이미 짧거나 통용 표기 그대로 유지.
_PROVINCE_SHORT_MAP = {
    "경상남": "경남",
    "경상북": "경북",
    "충청남": "충남",
    "충청북": "충북",
    "전라남": "전남",
    "전라북": "전북",  # 풀네임 '전라북도' 입력 정규화용 (데이터셋 원본은 이미 '전북')
}


def _normalize_province_label(value: str) -> str:
    """시도 표기를 데이터셋의 짧은 표기로 맞춘다."""
    label = str(value).strip()
    label = re.sub(r"(특별자치시|특별자치도|특별시|광역시|도|시)$", "", label)
    return _PROVINCE_SHORT_MAP.get(label, label)


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
    # 금융 속성 필터 (AI Hub 통신카드CB 통합, fin_ 컬럼). 컬럼 부재 시(미통합 데이터) 무시.
    insurance_interest: bool | None = None  # True면 보험 관심자(fin_interest_insurance==1)만
    life_stages: list[str] | None = None    # fin_life_stage isin (싱글/신혼/영유아자녀/청소년자녀/성인자녀/실버)
    income_top: bool | None = None          # True면 소득상위자(fin_highend_income==1)만


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
        # 컬럼별 '비어있지 않음'(0/1 float32) 마스크 캐시. 카테고리 페르소나 텍스트의 존재
        # 여부는 요청과 무관한 정적 속성이라, 매 스코어링마다 str.len()을 1M 행에 재계산
        # (컬럼당 ~80ms)하지 않고 부팅 후 컬럼별 1회 계산해 재사용한다.
        self._nonempty_cache: dict[str, np.ndarray] = {}
        self._district_values_cache: set[str] | None = None
        # 컬럼별 '전체 모집단' value_counts 캐시 — baseline-lift(타겟 cohort 분포를
        # 모집단 분포와 비교한 과대/과소 표집 배수) 계산의 분모. 요청과 무관한 정적
        # 통계라 부팅 후 컬럼별 1회만 집계한다.
        self._population_counts_cache: dict[str, pd.Series] = {}
        # 고유 직업명(~2120종)을 '|'로 합친 blob. 직업 카테고리 어근이 실제 직업명에
        # substring으로 존재하는지 검증해(occupation_has_substring) 0매칭 어근을 걸러낸다.
        self._occupation_blob: str | None = None
        # uuid → 행 위치(positional index) dict. uuid로 단건 조회 시 100만 행 boolean
        # 풀스캔(O(N)) 대신 O(1) iloc 조회를 제공한다. 부팅 후 1회 구축.
        self._uuid_to_pos: dict[str, int] = {
            uuid: i for i, uuid in enumerate(self.df["uuid"])
        }

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
            mask &= df["province"].isin([_normalize_province_label(v) for v in params.provinces])
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

        # 금융 속성 필터 — fin_ 컬럼이 있을 때만 적용 (미통합 데이터셋에서 graceful)
        if params.insurance_interest and "fin_interest_insurance" in df.columns:
            mask &= df["fin_interest_insurance"] == 1
        if params.life_stages and "fin_life_stage" in df.columns:
            mask &= df["fin_life_stage"].isin(params.life_stages)
        if params.income_top and "fin_highend_income" in df.columns:
            mask &= df["fin_highend_income"] == 1

        # 동적 필터 — 허용 컬럼만, isin 정확 매칭
        if params.additional_filters:
            for col, values in params.additional_filters.items():
                if col not in ALLOWED_DYNAMIC_COLUMNS:
                    continue  # 허용 목록 외 컬럼 무시
                if not values:
                    continue
                if col not in df.columns:
                    continue
                if col == "district":
                    mask &= df[col].isin(self._expand_district_filter_values(values))
                else:
                    mask &= df[col].isin(values)

        return df.index[mask].to_numpy()

    def _expand_district_filter_values(self, values: list[str]) -> set[str]:
        """'영등포구', '서울 영등포구' 같은 입력을 '서울-영등포구' 값으로 확장한다."""
        if self._district_values_cache is None:
            self._district_values_cache = set(self.df["district"].dropna().astype(str).unique())

        expanded: set[str] = set()
        suffix_tokens: set[str] = set()

        for raw in values:
            token = str(raw).strip()
            if not token:
                continue
            token = re.sub(r"\s*[-/]\s*", "-", token)
            token = re.sub(r"\s+", "-", token)
            expanded.add(token)

            if "-" in token:
                province, district = token.split("-", 1)
                province = _normalize_province_label(province)
                district = district.strip()
                if province and district:
                    expanded.add(f"{province}-{district}")
            else:
                suffix_tokens.add(token)

        for district_value in self._district_values_cache:
            suffix = district_value.split("-", 1)[-1]
            for token in suffix_tokens:
                if suffix == token or (len(token) >= 2 and suffix.startswith(token)):
                    expanded.add(district_value)

        return expanded

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

        # 임베딩은 사전 L2 정규화됨(KURE-v1 인코딩 시 normalize_embeddings=True, norm≈1.0).
        # 따라서 score_all_personas와 동일하게 dot만으로 코사인 유사도가 된다.
        # 후보별 norm 재계산(np.linalg.norm + 나눗셈)은 불필요한 연산이라 제거 — 일관성·속도.
        #
        # 후보가 많으면 fancy-indexing 복사(self.embeddings[candidate_indices], (N,1024)
        # float32 수백 MB 신규 할당)가 GC 압박/지연 변동을 유발한다. 후보 비율이 임계
        # (전체의 50%) 이상이면 복사 없이 전체 매트릭스 dot 후 후보만 추려 더 안정적이다.
        # 임계 미만(좁은 검색 경로)은 현행 슬라이스 유지가 빠르다. 결과·정규화는 동일.
        if len(candidate_indices) >= self.total * 0.5:
            all_sims = self.embeddings @ q  # (total,) — 복사 없음(mmap 비활성 시 RAM 상주)
            sims = all_sims[candidate_indices]  # (N,)
        else:
            cand_emb = self.embeddings[candidate_indices]  # (N, 1024)
            sims = cand_emb @ q  # (N,)

        # 상위 top_k 추출
        k = min(top_k, len(sims))
        top_local = np.argpartition(-sims, k - 1)[:k]  # 정렬 안 됨
        top_local = top_local[np.argsort(-sims[top_local])]  # 정렬

        return candidate_indices[top_local], sims[top_local]

    def get_rows(self, indices: np.ndarray) -> pd.DataFrame:
        """인덱스 → 행 DataFrame 슬라이스."""
        return self.df.iloc[indices]

    def get_row_by_uuid(self, uuid: str) -> pd.Series | None:
        """uuid로 단일 행을 O(1) 조회. 없으면 None.

        _uuid_to_pos 인덱스를 사용해 100만 행 boolean 풀스캔을 회피한다.
        """
        pos = self._uuid_to_pos.get(uuid)
        if pos is None:
            return None
        return self.df.iloc[pos]

    def nonempty_mask(self, col: str) -> np.ndarray:
        """col 값이 비어있지 않으면 1.0, 비어있거나 컬럼 부재면 0.0인 float32 마스크 (length=total).

        카테고리 페르소나 텍스트 존재 여부는 정적이라 부팅 후 컬럼별 1회 계산 후 캐싱한다.
        _category_bonus가 매 스코어링마다 1M 행 str.len()을 반복하던 비용을 제거한다.
        """
        cached = self._nonempty_cache.get(col)
        if cached is None:
            if col in self.df.columns:
                cached = (self.df[col].fillna("").str.len() > 0).to_numpy(dtype=np.float32)
            else:
                cached = np.zeros(self.total, dtype=np.float32)
            self._nonempty_cache[col] = cached
        return cached

    def population_counts(self, col: str) -> pd.Series:
        """전체 모집단 기준 col 값 분포(value_counts). 부팅 후 컬럼별 1회 캐시.

        baseline-lift 계산의 분모 — 타겟 cohort의 어떤 값이 모집단 대비 과대/과소
        표집됐는지 배수로 보여주기 위해 필요하다. 결측 처리는 scoring._value_counts와
        동일 규칙(object 컬럼만 '(미상)'으로 채우고, category/수치는 NaN 제외)이라
        라벨이 타겟 분포와 정합한다.
        """
        cached = self._population_counts_cache.get(col)
        if cached is None:
            if col not in self.df.columns:
                cached = pd.Series(dtype="int64")
            else:
                series = self.df[col]
                if series.dtype == object:
                    series = series.fillna("(미상)")
                cached = series.value_counts()
            self._population_counts_cache[col] = cached
        return cached

    def occupation_has_substring(self, root: str) -> bool:
        """어근이 실제 직업명(KSCO) 중 하나에라도 substring으로 존재하는지 판정.

        고유 직업명(~2120종)만 '|'로 join해 1회 캐시 → 100만 행 풀스캔을 회피한다.
        직업 카테고리 어근('IT'·'생산직' 등)이 실제 직업명에 없으면(=isin/contains 0)
        그 어근을 occupations에서 빼고 임베딩으로 강등하기 위한 검증 게이트.
        """
        if not root:
            return False
        if self._occupation_blob is None:
            uniq = self.df["occupation"].dropna().astype(str).unique()
            self._occupation_blob = "|".join(uniq)
        return root in self._occupation_blob


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
    # npy 매트릭스를 RAM에 적재 — mmap_mode="r"은 cold page-cache 상태에서
    # fancy indexing이 매우 느려져 자연어 검색이 40~80초 걸리는 문제 발생.
    # PERSONAS_EMBED_MMAP=1이면 mmap 모드로 폴백 (RAM 부족 환경 대비).
    if os.environ.get("PERSONAS_EMBED_MMAP") == "1":
        embeddings = np.load(npy_path, mmap_mode="r")
    else:
        embeddings = np.load(npy_path)
        # 인접 메모리 + float32 보장 — fancy indexing/매트릭스 곱 안정성
        embeddings = np.ascontiguousarray(embeddings, dtype=np.float32)
    return PersonaStore(df, embeddings)
