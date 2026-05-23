"""data/personas_100k.parquet → OpenAI 임베딩 → data/embeddings_100k.npy.

- 입력: Phase 1A의 stratified 샘플 (10만 행)
- 출력: numpy float32 매트릭스 (100000, 1536)
- 검색 단계(part2)에서는 .npy를 메모리 로드하여 numpy 코사인 유사도로 검색
- 체크포인트: 매 10000건마다 .npy 저장 → 중단 시 재실행하면 이어서 진행

사전 조건:
- 환경변수 OPENAI_API_KEY 설정 (.env 또는 셸)
- 비용(single): 약 $0.24 (10만 행 × ~80자 × 1.5토큰/자 × $0.02/1M)
- 시간(single): 약 15-30분

임베딩 모드 (EMBED_MODE):
- single (기본): df["persona"] 종합 페르소나 컬럼만 임베딩
- combined: 7종 페르소나 + 3종 속성(전문성/취미/경력목표) 텍스트를 라벨 + 줄바꿈으로 통합 후 임베딩
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

# 프로젝트 루트의 .env 로드 (scripts/에서 실행해도 동작)
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

# 환경변수로 입/출력 경로 선택 (기본: 10만 행)
# 100만 행 batch: PERSONAS_PARQUET=data/personas_1m.parquet EMBEDDINGS_NPY=data/embeddings_1m.npy python scripts/embed_personas.py
# 통합 임베딩(100만): EMBED_MODE=combined PERSONAS_PARQUET=data/personas_1m.parquet EMBEDDINGS_NPY=data/embeddings_1m_v2.npy python scripts/embed_personas.py
EMBED_MODE = os.environ.get("EMBED_MODE", "single").lower()  # single | combined
INPUT_PATH = Path(os.environ.get("PERSONAS_PARQUET", "data/personas_100k.parquet"))
OUTPUT_PATH = Path(os.environ.get("EMBEDDINGS_NPY", "data/embeddings_100k.npy"))
MODEL = "text-embedding-3-small"
DIM = 1536
BATCH_SIZE = 100  # OpenAI 한 번에 최대 ~2048건 가능, 안정성 위해 100
CHECKPOINT_EVERY = 10_000  # 매 10000건마다 .npy 저장

# 통합 모드: 임베딩 입력에 포함할 텍스트 컬럼 → 한국어 섹션 라벨 (순서 유지)
COMBINED_SECTIONS: list[tuple[str, str]] = [
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

# text-embedding-3-small max input = 8192 tokens. 한국어 평균 ~1.5~2 char/token 보수적으로
# 1 token ≈ 2 char 가정 → 안전 상한 14000자(약 7000 tokens). 초과 시 끝에서 truncate.
COMBINED_MAX_CHARS = 14_000


def build_combined_text(row: pd.Series) -> str:
    """7종 페르소나 + 3종 속성 텍스트를 라벨 + 줄바꿈 구조로 통합.

    빈 값(NaN/공백)은 섹션 자체를 생략. 토큰 초과 방지를 위해 COMBINED_MAX_CHARS로 truncate.
    """
    parts: list[str] = []
    for col, label in COMBINED_SECTIONS:
        val = row.get(col)
        if val is None:
            continue
        s = str(val).strip()
        if not s or s.lower() == "nan":
            continue
        parts.append(f"## {label}\n{s}")
    text = "\n\n".join(parts)
    if len(text) > COMBINED_MAX_CHARS:
        text = text[:COMBINED_MAX_CHARS]
    return text


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=10))
def embed_batch(client: OpenAI, texts: list[str]) -> list[list[float]]:
    """OpenAI 임베딩 배치 호출 + 3회 재시도."""
    res = client.embeddings.create(model=MODEL, input=texts)
    return [d.embedding for d in res.data]


def resume_from_checkpoint(embeddings: np.ndarray) -> int:
    """기존 .npy 파일이 있으면 로드해서 이미 채워진 부분 복구. 시작 인덱스 반환."""
    if not OUTPUT_PATH.exists():
        return 0
    prev = np.load(OUTPUT_PATH)
    if prev.shape != embeddings.shape:
        print(f"⚠️  기존 파일 shape 불일치 {prev.shape} != {embeddings.shape}, 처음부터 시작")
        return 0
    embeddings[:] = prev
    # 마지막으로 채워진 인덱스 찾기 (norm==0인 첫 행)
    norms = np.linalg.norm(embeddings, axis=1)
    zero_mask = norms == 0
    if not zero_mask.any():
        print("✅ 이미 모든 행이 채워져 있음 (재실행 불필요)")
        return len(embeddings)
    first_empty = int(np.argmax(zero_mask))
    print(f"🔁 체크포인트 복구: {first_empty}건 채워짐, 이어서 시작")
    return first_empty


def main() -> None:
    if not INPUT_PATH.exists():
        raise FileNotFoundError(f"❌ {INPUT_PATH} 없음. 먼저 scripts/sample_personas.py 실행 필요")

    print(f"📥 입력 로드: {INPUT_PATH}")
    df = pd.read_parquet(INPUT_PATH)
    n = len(df)
    print(f"   {n:,}행 | EMBED_MODE={EMBED_MODE}")

    if EMBED_MODE == "combined":
        missing = [c for c, _ in COMBINED_SECTIONS if c not in df.columns]
        if missing:
            raise RuntimeError(f"combined 모드 필수 컬럼 누락: {missing}")
        # 샘플 길이 로그 — 비용/토큰 사전 가늠
        sample_n = min(100, n)
        sample_lens = [len(build_combined_text(df.iloc[k])) for k in range(sample_n)]
        print(
            f"   combined 텍스트 길이(샘플 {sample_n}행): "
            f"min={min(sample_lens):,} / mean={int(sum(sample_lens) / sample_n):,} / max={max(sample_lens):,}"
        )
    elif EMBED_MODE != "single":
        raise RuntimeError(f"알 수 없는 EMBED_MODE={EMBED_MODE} (single | combined)")

    embeddings = np.zeros((n, DIM), dtype=np.float32)
    start = resume_from_checkpoint(embeddings)
    if start >= n:
        print(f"✅ 이미 완료된 .npy 존재: {OUTPUT_PATH}")
        return

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY 환경변수가 설정되지 않았습니다 (.env 확인)")

    client = OpenAI()
    t0 = time.time()
    last_chk = start

    for i in range(start, n, BATCH_SIZE):
        end = min(i + BATCH_SIZE, n)
        if EMBED_MODE == "combined":
            texts = [build_combined_text(df.iloc[k]) for k in range(i, end)]
        else:
            texts = df["persona"].iloc[i:end].tolist()
        vecs = embed_batch(client, texts)
        embeddings[i:end] = np.array(vecs, dtype=np.float32)

        # 체크포인트
        if end - last_chk >= CHECKPOINT_EVERY or end == n:
            np.save(OUTPUT_PATH, embeddings)
            elapsed = time.time() - t0
            rate = (end - start) / elapsed if elapsed > 0 else 0
            eta = (n - end) / rate if rate > 0 else 0
            print(f"  💾 {end:,}/{n:,} ({end / n:.1%}) | "
                  f"{rate:.0f}행/s | ETA {eta / 60:.1f}분")
            last_chk = end

    np.save(OUTPUT_PATH, embeddings)
    size_mb = OUTPUT_PATH.stat().st_size / 1024 / 1024
    print(f"\n✅ 저장 완료: {OUTPUT_PATH} shape={embeddings.shape} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
