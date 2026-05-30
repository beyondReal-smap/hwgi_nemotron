"""Track 2 사전계산 — 10만 샘플 × 6개 카테고리 임베딩 (float16).

배경: `embeddings_1m_v2.npy`는 combined 모드라 모든 카테고리가 단일 임베딩에 평탄하게 섞여 있음.
`persona_category_weights`(family=0.9 등)에 따라 특정 카테고리만 강조하는 가중 제어가 불가능.
카테고리별 임베딩을 사전계산해두면 query × 카테고리 cosine을 가중합할 수 있다.

이 작업은:
  - Track 2 pilot 본체 (family 카테고리 매칭에 활용)
  - 평가 인프라 (dominant category top1 측정 — 6개 카테고리 cosine 비교)
  둘 다에 필요해 6개 모두 사전계산.

산출물: data/category_emb_{cat}_100k_v1.npy × 6개. 각 10만 × 1536 float16 (307MB).
비용: 10만 × 6 = 60만 호출, $0.02/1M × ~100 토큰 = 약 $1.2.
시간: 배치 100건, 6000 batch, OpenAI tier에 따라 5~30분.

실행: cd /home/jin/ai_hack && python scripts/embed_categories_100k.py
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI

PROJ = Path(__file__).resolve().parent.parent
load_dotenv(PROJ / ".env")

MODEL = "text-embedding-3-small"
DIM = 1536
BATCH_SIZE = 100
CATEGORIES = [
    "family_persona",
    "professional_persona",
    "sports_persona",
    "arts_persona",
    "travel_persona",
    "culinary_persona",
]


def embed_batch(client: OpenAI, texts: list[str]) -> list[list[float]]:
    """안정성: 빈 텍스트는 placeholder로 (API 에러 방지)."""
    safe = [t if t and t.strip() else "(empty)" for t in texts]
    res = client.embeddings.create(model=MODEL, input=safe)
    return [d.embedding for d in res.data]


def main():
    data_dir = PROJ / "data"
    parquet_path = data_dir / "personas_100k.parquet"
    if not parquet_path.exists():
        print(f"ERROR: {parquet_path} not found")
        sys.exit(1)

    print(f"[1/3] Load personas_100k.parquet...")
    df = pd.read_parquet(parquet_path)
    n = len(df)
    print(f"  rows = {n:,}")

    client = OpenAI()

    for cat in CATEGORIES:
        cat_short = cat.replace("_persona", "")
        out_path = data_dir / f"category_emb_{cat_short}_100k_v1.npy"
        if out_path.exists():
            print(f"\n[skip] {out_path.name} already exists ({out_path.stat().st_size / 1024**2:.1f} MB)")
            continue
        if cat not in df.columns:
            print(f"\n[skip] column '{cat}' not in parquet")
            continue

        print(f"\n[2/3] Embedding {cat} ({n:,} rows, batch={BATCH_SIZE})...")
        emb = np.zeros((n, DIM), dtype=np.float32)
        texts = df[cat].fillna("").tolist()

        t0 = time.time()
        for i in range(0, n, BATCH_SIZE):
            end = min(i + BATCH_SIZE, n)
            batch = texts[i:end]
            try:
                vectors = embed_batch(client, batch)
            except Exception as e:
                print(f"  ERROR at batch {i}: {e}, retrying once...")
                time.sleep(2)
                vectors = embed_batch(client, batch)
            for j, v in enumerate(vectors):
                emb[i + j] = v
            if (i // BATCH_SIZE) % 50 == 0 and i > 0:
                elapsed = time.time() - t0
                eta = elapsed / i * (n - i)
                print(f"  {i:>6,}/{n:,}  elapsed={elapsed:5.1f}s  eta={eta:5.1f}s")

        # L2 정규화 (cosine 계산을 dot product로 단순화)
        norms = np.linalg.norm(emb, axis=1, keepdims=True)
        emb = emb / np.maximum(norms, 1e-9)

        # float16 압축 후 저장 (Codex 권장 — top50/100 overlap 100% 검증됨)
        emb16 = emb.astype(np.float16)
        np.save(out_path, emb16)
        elapsed_total = time.time() - t0
        size_mb = out_path.stat().st_size / 1024**2
        print(f"  saved: {out_path.name}  ({size_mb:.1f} MB, {elapsed_total:.1f}s)")

    print("\n[3/3] Done.")


if __name__ == "__main__":
    main()
