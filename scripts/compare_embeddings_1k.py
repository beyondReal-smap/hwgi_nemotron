"""1천 행 샘플 한국어 검색 벤치마크.

비교 대상:
  - OpenAI: text-embedding-3-small
  - Upstage: embedding-query / embedding-passage

평가 방식:
  - 코퍼스: 샘플 1천 행의 페르소나 본문(현재 combined 방식)
  - 질의: 같은 행의 메타데이터를 한국어 검색어로 변환
  - 지표: self-retrieval Recall@1/5/10, MRR, 평균/중앙 rank

실행:
  uv run --project apps/api python scripts/compare_embeddings_1k.py
"""

from __future__ import annotations

import argparse
import os
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI

PROJ = Path(__file__).resolve().parent.parent
load_dotenv(PROJ / ".env")

DATA_PATH = PROJ / "data" / "personas_100k.parquet"
SAMPLE_SIZE = 1_000
BATCH_SIZE = 100
SEED = 42


@dataclass(frozen=True)
class Provider:
    name: str
    api_key_envs: tuple[str, ...]
    base_url: str | None
    query_model: str
    passage_model: str


OPENAI_PROVIDER = Provider(
    name="openai",
    api_key_envs=("OPENAI_API_KEY",),
    base_url=None,
    query_model="text-embedding-3-small",
    passage_model="text-embedding-3-small",
)

UPSTAGE_PROVIDER = Provider(
    name="upstage",
    api_key_envs=("UPSTAGE_API_KEY", "UPSTAGE_API_KEY_INJECT"),
    base_url="https://api.upstage.ai/v1",
    query_model="embedding-query",
    passage_model="embedding-passage",
)


def _is_missing(value: object) -> bool:
    if value is None:
        return True
    s = str(value).strip()
    return not s or s.lower() == "nan"


def build_passage_text(row: pd.Series) -> str:
    """현재 운영 combined 모드와 같은 본문 구성."""
    sections: list[tuple[str, str]] = [
        ("persona", "종합"),
        ("professional_persona", "직업"),
        ("sports_persona", "스포츠"),
        ("arts_persona", "예술"),
        ("travel_persona", "여행"),
        ("culinary_persona", "요리"),
        ("family_persona", "가족"),
        ("skills_and_expertise", "전문성"),
        ("hobbies_and_interests", "취미"),
        ("career_goals_and_ambitions", "경력 목표"),
    ]
    parts: list[str] = []
    for col, label in sections:
        val = row.get(col)
        if _is_missing(val):
            continue
        parts.append(f"## {label}\n{str(val).strip()}")
    return "\n\n".join(parts)


def build_query_text(row: pd.Series) -> str:
    """한국어 검색 질의로 바꾼 메타데이터 요약."""
    age = row.get("age")
    sex = row.get("sex")
    province = row.get("province")
    marital_status = row.get("marital_status")
    family_type = row.get("family_type")
    education_level = row.get("education_level")
    occupation = row.get("occupation")

    parts: list[str] = []
    if not _is_missing(age) and not _is_missing(sex):
        parts.append(f"{int(age)}세 {sex}")
    if not _is_missing(province):
        parts.append(f"{province} 거주")
    if not _is_missing(marital_status):
        parts.append(str(marital_status))
    if not _is_missing(family_type):
        parts.append(str(family_type))
    if not _is_missing(education_level):
        parts.append(f"{education_level} 학력")
    if not _is_missing(occupation):
        parts.append(f"{occupation} 직업")
    return ", ".join(parts)


def make_client(provider: Provider) -> OpenAI:
    api_key = next((os.environ.get(name) for name in provider.api_key_envs if os.environ.get(name)), None)
    if not api_key:
        raise RuntimeError(f"{provider.name} 키가 없습니다: {', '.join(provider.api_key_envs)}")
    if provider.base_url:
        return OpenAI(api_key=api_key, base_url=provider.base_url)
    return OpenAI(api_key=api_key)


def embed_batch(client: OpenAI, model: str, texts: list[str]) -> np.ndarray:
    safe = [t if t and t.strip() else "(empty)" for t in texts]
    res = client.embeddings.create(model=model, input=safe)
    arr = np.asarray([item.embedding for item in res.data], dtype=np.float32)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    return arr / np.maximum(norms, 1e-9)


def embed_texts(client: OpenAI, model: str, texts: list[str]) -> np.ndarray:
    chunks: list[np.ndarray] = []
    for i in range(0, len(texts), BATCH_SIZE):
        chunks.append(embed_batch(client, model, texts[i : i + BATCH_SIZE]))
    return np.vstack(chunks)


def rank_of_target(scores: np.ndarray, target_idx: int) -> int:
    order = np.argsort(-scores, kind="mergesort")
    return int(np.where(order == target_idx)[0][0]) + 1


def age_band(value: object) -> int | None:
    if _is_missing(value):
        return None
    return int(float(value)) // 10


def attribute_score(source: pd.Series, target: pd.Series) -> float:
    fields = [
        ("sex", lambda a, b: a == b),
        ("province", lambda a, b: a == b),
        ("marital_status", lambda a, b: a == b),
        ("family_type", lambda a, b: a == b),
        ("education_level", lambda a, b: a == b),
        ("age", lambda a, b: age_band(a) is not None and age_band(a) == age_band(b)),
    ]
    matches = 0
    total = 0
    for field, predicate in fields:
        src = source.get(field)
        dst = target.get(field)
        if _is_missing(src) or _is_missing(dst):
            continue
        total += 1
        if predicate(src, dst):
            matches += 1
    return matches / total if total else 0.0


def summarize_ranks(ranks: list[int]) -> dict[str, float]:
    arr = np.asarray(ranks, dtype=np.float32)
    return {
        "recall@1": float(np.mean(arr <= 1)),
        "recall@5": float(np.mean(arr <= 5)),
        "recall@10": float(np.mean(arr <= 10)),
        "mrr": float(np.mean(1.0 / arr)),
        "mean_rank": float(np.mean(arr)),
        "median_rank": float(np.median(arr)),
    }


def run_provider(
    provider: Provider,
    df: pd.DataFrame,
    corpus_texts: list[str],
    query_texts: list[str],
) -> dict[str, object]:
    client = make_client(provider)
    print(f"\n[{provider.name}] 임베딩 중...")
    t0 = time.perf_counter()
    corpus_emb = embed_texts(client, provider.passage_model, corpus_texts)
    query_emb = embed_texts(client, provider.query_model, query_texts)
    if corpus_emb.shape[1] != query_emb.shape[1]:
        raise RuntimeError(
            f"{provider.name} 차원 불일치: corpus={corpus_emb.shape[1]}, query={query_emb.shape[1]}"
        )
    embed_elapsed = time.perf_counter() - t0

    print(f"[{provider.name}] 검색 평가 중...")
    t1 = time.perf_counter()
    ranks: list[int] = []
    top1_attr_scores: list[float] = []
    top10_attr_scores: list[float] = []
    for i in range(len(query_emb)):
        scores = corpus_emb @ query_emb[i]
        ranks.append(rank_of_target(scores, i))
        order = np.argsort(-scores, kind="mergesort")
        top1_attr_scores.append(attribute_score(df.iloc[i], df.iloc[int(order[0])]))
        top10_attr_scores.append(
            float(np.mean([attribute_score(df.iloc[i], df.iloc[int(j)]) for j in order[:10]]))
        )
    search_elapsed = time.perf_counter() - t1

    return {
        "provider": provider.name,
        "embed_seconds": embed_elapsed,
        "search_seconds": search_elapsed,
        "metrics": summarize_ranks(ranks),
        "top1_attr_score": float(np.mean(top1_attr_scores)),
        "top10_attr_score": float(np.mean(top10_attr_scores)),
        "ranks": ranks,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample-size", type=int, default=SAMPLE_SIZE)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--providers", nargs="+", default=["openai", "upstage"])
    args = parser.parse_args()

    if not DATA_PATH.exists():
        raise FileNotFoundError(f"{DATA_PATH} 없음")

    df = pd.read_parquet(DATA_PATH).sample(n=args.sample_size, random_state=args.seed).reset_index(drop=False)
    corpus_texts = [build_passage_text(row) for _, row in df.iterrows()]
    query_texts = [build_query_text(row) for _, row in df.iterrows()]

    print(f"샘플: {len(df):,}행 | 데이터: {DATA_PATH.name}")
    print("질의 예시:")
    for i in range(min(3, len(df))):
        print(f"  - {query_texts[i]}")

    provider_map = {
        "openai": OPENAI_PROVIDER,
        "upstage": UPSTAGE_PROVIDER,
    }

    results: list[dict[str, object]] = []
    for name in args.providers:
        provider = provider_map.get(name)
        if provider is None:
            print(f"\n[{name}] 알 수 없는 provider라 건너뜁니다.")
            continue
        try:
            result = run_provider(provider, df, corpus_texts, query_texts)
        except RuntimeError as e:
            print(f"\n[{provider.name}] 건너뜁니다: {e}")
            continue
        results.append(result)

    if not results:
        raise RuntimeError("실행된 provider가 없습니다.")

    print("\n결과:")
    for r in results:
        m = r["metrics"]
        print(
            f"- {r['provider']}: "
            f"R@1={m['recall@1']:.3f}, R@5={m['recall@5']:.3f}, R@10={m['recall@10']:.3f}, "
            f"MRR={m['mrr']:.3f}, mean_rank={m['mean_rank']:.2f}, median_rank={m['median_rank']:.2f}, "
            f"top1_attr={r['top1_attr_score']:.3f}, top10_attr={r['top10_attr_score']:.3f}, "
            f"embed={r['embed_seconds']:.1f}s, search={r['search_seconds']:.1f}s"
        )

    if len(results) == 2:
        a, b = results
        ma = a["metrics"]
        mb = b["metrics"]
        print("\n차이(뒤 - 앞):")
        print(f"- recall@1: {mb['recall@1'] - ma['recall@1']:+.3f}")
        print(f"- recall@5: {mb['recall@5'] - ma['recall@5']:+.3f}")
        print(f"- recall@10: {mb['recall@10'] - ma['recall@10']:+.3f}")
        print(f"- mrr: {mb['mrr'] - ma['mrr']:+.3f}")
        print(f"- top1_attr: {b['top1_attr_score'] - a['top1_attr_score']:+.3f}")
        print(f"- top10_attr: {b['top10_attr_score'] - a['top10_attr_score']:+.3f}")


if __name__ == "__main__":
    main()
