"""데이터셋 전체 통계 계산 — /api/dataset/overview에서 사용.

PersonaStore의 df를 그대로 활용. lru_cache로 1회만 계산 (정적 데이터).
임베딩과 무관 — 페르소나 메타데이터 분포만.
"""

from __future__ import annotations

import re
from functools import lru_cache

import pandas as pd

from services.store import get_store


# ============================================================
# 직업군 매핑 (KSCO 대분류 + 한국 친숙 분류)
# ============================================================
#
# 키워드 부분 매칭. 위에서부터 우선순위 (먼저 매칭되는 그룹이 채택).
# 데이터셋의 실제 표현(예: "그 외 법률 관련 사무원")에 맞춰 키워드 선정.
# 마지막 "기타"는 fallback.
JOB_GROUPS: list[tuple[str, list[str]]] = [
    ("무직", ["무직"]),
    ("군인", ["군인", "병사", "장교", "부사관"]),
    (
        "의료/보건",
        [
            "의사", "간호", "약사", "치과", "치위생", "한의", "수의",
            "임상병리", "방사선", "물리치료", "작업치료",
            "응급구조", "보건", "위생사", "의료기사", "의무",
        ],
    ),
    ("교육", ["교사", "교수", "강사", "어린이집", "유치원", "학원"]),
    (
        "법률/회계 전문직",
        [
            "변호사", "회계사", "변리사", "법무사", "노무사", "세무사",
            "감정평가", "감정사", "관세사", "법률 관련 사무",
        ],
    ),
    (
        "IT/연구",
        [
            "프로그래머", "개발자", "소프트웨어", "시스템", "데이터베이스",
            "네트워크", "정보보안", "웹 개발", "앱 개발",
            "연구원", "엔지니어",
        ],
    ),
    (
        "예술/미디어/체육",
        [
            "디자이너", "작가", "기자", "PD", "방송", "프로듀서", "아나운서",
            "화가", "음악", "작곡", "지휘", "연주",
            "선수", "코치", "감독", "심판",
            "배우", "성우", "모델", "사진", "영상", "촬영", "조명", "음향",
            "공예", "조각", "큐레이터",
        ],
    ),
    ("경영/관리자", ["임원", "경영자", "최고 경영", "최고 재무"]),
    (
        "운수/물류",
        [
            "운전", "기관사", "선원", "선장", "선박", "철도운송",
            "조종사", "객실 승무",
            "하역", "적재", "택배", "배달",
        ],
    ),
    ("청소/경비/안전", ["청소", "경비", "안전원", "환경미화", "방재"]),
    (
        "건설/시공",
        [
            "배관", "목공", "미장", "도장", "용접", "전기 공사", "건설",
            "토목", "건축", "측량", "조적", "철근", "비계", "타일",
            "방수", "단열",
        ],
    ),
    (
        "기능/제조",
        [
            "기사", "기술자", "조작원", "정비", "설치", "검사", "수리",
            "조립", "기능", "절단", "용해", "주조", "단조", "도금", "도색",
            "선반", "밀링", "공작",
        ],
    ),
    (
        "농림어업",
        ["농업", "축산", "어업", "원예", "조경", "임업", "양식", "재배", "작물", "산림"],
    ),
    (
        "서비스/조리/숙박",
        [
            "조리사", "주방", "음식", "음료", "객실", "여행", "관광",
            "미용", "이용사", "스파", "예식", "장례", "안내",
            "도우미", "베이비시터", "스튜어드",
        ],
    ),
    ("영업/판매", ["영업원", "판매원", "텔레마케터", "상담원", "온라인 쇼핑"]),
    (
        "사무행정",
        [
            "사무원", "사무 보조", "비서", "행정", "총무",
            "기획자", "기획 사무", "조사 전문가",
            "마케팅 전문가", "경영 컨설턴트", "상담 전문가",
        ],
    ),
]
JOB_GROUP_ORDER = [name for name, _ in JOB_GROUPS] + ["기타"]


def _classify_occupation(occ: str) -> str:
    """occupation 문자열 → 그룹명. 매칭 안 되면 "기타"."""
    if not occ:
        return "기타"
    text = str(occ)
    # "무직"은 정확 매칭만 (다른 직업명에 "무"가 우연히 들어가지 않도록)
    if text.strip() == "무직":
        return "무직"
    for group, keywords in JOB_GROUPS:
        if group == "무직":
            continue
        for kw in keywords:
            if kw in text:
                return group
    return "기타"


def _classify_series(s: pd.Series) -> pd.Series:
    """벡터화는 어려운 우선순위 매칭이라 unique 값만 분류 후 map (캐시 효과)."""
    unique_to_group = {v: _classify_occupation(v) for v in s.unique()}
    return s.map(unique_to_group)


def _occupations_grouped(df: pd.DataFrame, top_n_per_group: int = 5) -> list[dict]:
    """직업 그룹별 인원 합계 + 그룹 내 Top N 직업 리스트.

    Returns:
        [{group, count, ratio, top_jobs: [{label, count}, ...]}, ...]
        — count 내림차순
    """
    groups = _classify_series(df["occupation"])
    g_df = pd.DataFrame({"occupation": df["occupation"], "group": groups})

    total = len(g_df)
    out = []
    for group_name, sub in g_df.groupby("group"):
        top_jobs = (
            sub["occupation"].value_counts().head(top_n_per_group)
        )
        out.append({
            "group": str(group_name),
            "count": int(len(sub)),
            "ratio": float(len(sub) / total) if total > 0 else 0.0,
            "top_jobs": [
                {"label": str(label), "count": int(count)}
                for label, count in top_jobs.items()
            ],
        })
    # 정의된 순서로 정렬 (count 내림차순 → 표시 일관성)
    out.sort(key=lambda x: x["count"], reverse=True)
    return out

# ============================================================
# 표시용 라벨 매핑
# ============================================================

COLUMN_LABELS: dict[str, str] = {
    "sex": "성별",
    "marital_status": "혼인 상태",
    "military_status": "병역 상태",
    "family_type": "가구 형태",
    "housing_type": "주거 형태",
    "education_level": "교육 수준",
    "bachelors_field": "전공 분야",
    "occupation": "직업",
    "province": "시도",
    "district": "시군구",
}

# 연령 버킷 (10년 단위)
AGE_BUCKETS = [
    (0, 19, "~19"),
    (20, 29, "20대"),
    (30, 39, "30대"),
    (40, 49, "40대"),
    (50, 59, "50대"),
    (60, 69, "60대"),
    (70, 79, "70대"),
    (80, 999, "80+"),
]

# 페르소나 텍스트 컬럼 (길이 통계 대상)
PERSONA_TEXT_COLS = [
    "persona",
    "professional_persona",
    "sports_persona",
    "arts_persona",
    "travel_persona",
    "culinary_persona",
    "family_persona",
]


# ============================================================
# 헬퍼
# ============================================================

def _count_by(
    df: pd.DataFrame,
    column: str,
    top_n: int | None = None,
    include_others: bool = False,
) -> list[dict]:
    """컬럼 값 분포 (count 내림차순). top_n 지정 시 상위만.

    include_others=True면 잘려나간 나머지 카테고리를 "기타 (N개)" 항목으로 합산해 끝에 추가.
    분포 합계가 전체 분모와 일치해야 하는 컬럼에 사용 (예: family_type 39개 중 15개만 표시 시 5.5% 누락).
    """
    vc = df[column].value_counts(dropna=False)
    total_unique = len(vc)
    rest_count = 0
    rest_unique = 0
    if top_n is not None and total_unique > top_n:
        rest_count = int(vc.iloc[top_n:].sum())
        rest_unique = total_unique - top_n
        vc = vc.head(top_n)
    bins = [
        {"label": str(label) if not pd.isna(label) else "(미상)", "count": int(count)}
        for label, count in vc.items()
    ]
    if include_others and rest_count > 0:
        bins.append({"label": f"기타 ({rest_unique}개 카테고리)", "count": rest_count})
    return bins


def _age_histogram(df: pd.DataFrame) -> list[dict]:
    """10년 단위 연령 분포."""
    bins = []
    for lo, hi, label in AGE_BUCKETS:
        mask = (df["age"] >= lo) & (df["age"] <= hi)
        count = int(mask.sum())
        if count > 0 or lo >= 20:  # 0~19 빈 버킷은 숨김
            bins.append({"label": label, "count": count})
    return bins


def _province_with_district_breakdown(df: pd.DataFrame) -> list[dict]:
    """시도별 인원 + 시군구 수 + 평균 연령."""
    out: list[dict] = []
    grouped = df.groupby("province")
    for province, group in grouped:
        out.append({
            "province": str(province),
            "count": int(len(group)),
            "district_count": int(group["district"].nunique()),
            "avg_age": float(group["age"].mean()),
            "female_ratio": float((group["sex"] == "여자").mean()),
        })
    out.sort(key=lambda x: x["count"], reverse=True)
    return out


def _district_distribution(df: pd.DataFrame, top_n: int | None = None) -> list[dict]:
    """시군구별 인원 분포. 지도 색상 강도용.

    top_n=None이면 전체 252개 시군구 모두 반환 (지도 전체 칠하기용).
    """
    vc = df["district"].value_counts()
    if top_n is not None:
        vc = vc.head(top_n)
    out = []
    for district, count in vc.items():
        # district 형식: "서울-강남구"
        parts = str(district).split("-", 1)
        province = parts[0] if len(parts) == 2 else ""
        name = parts[1] if len(parts) == 2 else str(district)
        out.append({
            "district": str(district),
            "province": province,
            "name": name,
            "count": int(count),
        })
    return out


def _persona_text_stats(df: pd.DataFrame) -> list[dict]:
    """7종 페르소나 텍스트의 평균/최소/최대 글자 수."""
    out = []
    for col in PERSONA_TEXT_COLS:
        if col not in df.columns:
            continue
        lengths = df[col].fillna("").str.len()
        out.append({
            "column": col,
            "label": col.replace("_persona", "").replace("persona", "종합") or "종합",
            "mean": round(float(lengths.mean()), 1),
            "min": int(lengths.min()),
            "max": int(lengths.max()),
        })
    return out


# ============================================================
# 카테고리별 페르소나 샘플
# ============================================================

def get_persona_samples(column: str, limit: int = 8) -> list[dict]:
    """특정 페르소나 카테고리에서 대표 샘플 N건.

    "대표"의 정의: 길이 분포의 양극단(최장/최단)을 보여주면 카테고리 특성이 잘 드러남.
    구성:
      - 가장 긴 샘플 limit//2 건
      - 가장 짧은 샘플 (단, 빈/너무 짧은 건 제외) limit - 위 건수

    Args:
        column: PERSONA_TEXT_COLS 중 하나
        limit: 5-20 권장

    Raises:
        ValueError: 지원하지 않는 컬럼
    """
    if column not in PERSONA_TEXT_COLS:
        raise ValueError(f"지원하지 않는 컬럼: {column}. 허용: {PERSONA_TEXT_COLS}")

    store = get_store()
    df = store.df
    lengths = df[column].fillna("").str.len()
    # 너무 짧은 노이즈 제외 (최소 30자). 보조 컬럼으로 길이 정렬 사용.
    valid = df[lengths >= 30].assign(_len=lengths[lengths >= 30])

    half = limit // 2
    longest = valid.nlargest(half, "_len")
    shortest = valid.nsmallest(limit - half, "_len")

    rows = pd.concat([longest, shortest]).drop(columns=["_len"])

    return [
        {
            "uuid": str(r["uuid"]),
            "text": str(r[column]),
            "length": int(len(str(r[column]))),
            "sex": str(r["sex"]),
            "age": int(r["age"]),
            "province": str(r["province"]),
            "district": str(r["district"]),
            "occupation": str(r["occupation"]),
        }
        for _, r in rows.iterrows()
    ]


# ============================================================
# 메인 함수
# ============================================================

@lru_cache(maxsize=1)
def get_dataset_overview() -> dict:
    """데이터셋 전체 통계 (1회만 계산, 메모리 캐시)."""
    store = get_store()
    df = store.df

    return {
        "meta": {
            "total_rows": int(len(df)),
            "total_provinces": int(df["province"].nunique()),
            "total_districts": int(df["district"].nunique()),
            "total_occupations": int(df["occupation"].nunique()),
            "embedding_dim": int(store.embeddings.shape[1]),
            "embedding_rows": int(store.embeddings.shape[0]),
            "source": "nvidia/Nemotron-Personas-Korea",
            "license": "CC BY 4.0",
        },
        "age": {
            "min": int(df["age"].min()),
            "max": int(df["age"].max()),
            "mean": round(float(df["age"].mean()), 1),
            "median": int(df["age"].median()),
            "histogram": _age_histogram(df),
        },
        "demographics": [
            {"column": "sex",             "label": COLUMN_LABELS["sex"],             "bins": _count_by(df, "sex")},
            {"column": "marital_status",  "label": COLUMN_LABELS["marital_status"],  "bins": _count_by(df, "marital_status")},
            {"column": "military_status", "label": COLUMN_LABELS["military_status"], "bins": _count_by(df, "military_status")},
            {"column": "education_level", "label": COLUMN_LABELS["education_level"], "bins": _count_by(df, "education_level")},
            {"column": "housing_type",    "label": COLUMN_LABELS["housing_type"],    "bins": _count_by(df, "housing_type")},
            {"column": "family_type",     "label": COLUMN_LABELS["family_type"],     "bins": _count_by(df, "family_type", top_n=15, include_others=True)},
            {"column": "bachelors_field", "label": COLUMN_LABELS["bachelors_field"], "bins": _count_by(df, "bachelors_field")},
        ],
        "occupations_top": _count_by(df, "occupation", top_n=20),
        "occupations_grouped": _occupations_grouped(df, top_n_per_group=5),
        "provinces": _province_with_district_breakdown(df),
        # 전체 252개 시군구 (지도 색칠용). top_n 제한 없음.
        "districts_top": _district_distribution(df, top_n=None),
        "persona_text_stats": _persona_text_stats(df),
    }
