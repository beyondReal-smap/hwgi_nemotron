# 임베딩·매칭 품질 트랙 — 최종 제안 v3

> v1 → v2 → v3(final). Round 1·2 토론 결과 통합. 미합의 0건. 실험 착수 가능 상태.

## 1. 진단 (재확인)

- 이전 세션(PR-1/PR-2)으로 점수 산출·cohort 정의는 해결
- 남은 매칭 품질 이슈:
  1. **`category_bonus` 무용지물** — 카테고리 컬럼 100% 채워짐 → `persona_category_weights` 가중치가 점수에 무영향. **W_CATEGORY=0.1이 통째로 죽음**
  2. **메인 임베딩이 combined 모드** — family/professional/sports 등 카테고리 텍스트가 이미 단일 임베딩에 포함 (`scripts/embed_personas.py:15,63`). 부재한 건 "정보"가 아니라 **"가중 제어"**
  3. "무직" 매칭은 부적합이 아닌 **30대 여성 한정 강한 가설**: 100만 행 무직 36.7% 중 30대 여성으로 좁히면 주부 35.8% + 배우자있음 61.3%
  4. 한국어 임베딩 cosine [0.7, 0.95]는 [E5 모델 카드](https://huggingface.co/intfloat/multilingual-e5-large) 기준 **학습 특성상 정상** — 평가는 spread가 아닌 순위/품질로

## 2. 핵심 합의 (Round 1+2)

| 영역 | 결론 |
|---|---|
| Track 1 (stop-list 확장) | **보류** — 실제 신호 삭제 위험 |
| Track 1' (UX 라벨) | **진행** — context 기반 추론, **display 라벨과 원본 occupation 분리** (LLM 입력은 원본만) |
| Track 2 (Category 임베딩) | **pilot 진행** — 10만 샘플, float16, family 1개 카테고리부터, **z-score 정규화 기본** |
| Track 4 (Query multi-vector) — 신규 | **pilot 진행** — **max(후보 생성) + weighted sum(최종 랭킹) 2단계** |
| Track 3 (모델 교체/Hybrid) | **보류** — Track 2/4 결과 후 평가. 평가 기준 top-k/known-target/분기력 |
| LLM 카테고리 가중치 | **clip + temperature**로 극단값 완화 후 사용 |
| 측정 셀 | **4셀 분리** (baseline / T4 only / T2 only / T4+T2) |

## 3. 구현 순서

### Step 0 — 평가 인프라 준비 (착수 전 필수)

1. **Golden set** — 기존 11개 known-target 자동 회귀 테스트화 (현재 100% 통과)
2. **Category stress set** — 카테고리별 12~24개 케이스 수작업 라벨링 (family/professional/sports/arts/travel/culinary 각 2~4건)
   - 라벨링 항목: SellingPoints + **expected dominant category top1/top2**
   - 추정 작업: 2~4시간
3. **Feature flag** — `ENABLE_QUERY_MULTIVEC`, `ENABLE_CATEGORY_EMB`, `CAT_EMB_NORM_METHOD` 환경변수 또는 settings
4. **평가 스크립트** — baseline/T4/T2/T4+T2 4셀에 대해 자동 측정:
   - **회귀 0**: known-target 22/22 통과
   - **분기력**: family=0.9 vs professional=0.9 두 케이스 상위 50명 직업 분포 Jensen-Shannon 다이버전스
   - **dominant override**: family=1.0 one-hot 시 family cosine z-score가 baseline 대비 유의 상승
   - **top1 dominant 일치율** (stress set): ≥ 80% 권장 임계
   - **top2 포함률**: ≥ 90%
   - 보조: 분포 spread, 평균점수 ±2점 (gate 아닌 참고)

### Step 1 — Track 4 pilot (Query multi-vector, 데이터 재생성 0)

**구현**:
```python
def query_vectors(sp: SellingPoints) -> dict[str, np.ndarray]:
    """축별 임베딩. 빈 축은 None."""
    return {
        "summary":  embed_text(sp.summary)                       if sp.summary else None,
        "benefits": embed_text(" ".join(sp.key_benefits))        if sp.key_benefits else None,
        "keywords": embed_text(" ".join(sp.target_keywords))     if sp.target_keywords else None,
    }

# 2단계 retrieval (Codex 권장)
# 후보 생성: max pool로 노치 안 놓치게 — 후보 5,000개
# 최종 랭킹: weighted sum (0.5/0.3/0.2)으로 평균 안정성 확보
def cosine_multi(query_vecs, embeddings):
    sims = {k: embeddings @ v for k, v in query_vecs.items() if v is not None}
    max_sim   = np.maximum.reduce(list(sims.values()))   # 후보 생성용
    weights   = {"summary": 0.5, "benefits": 0.3, "keywords": 0.2}
    weighted  = sum(weights[k] * sims[k] for k in sims) / sum(weights[k] for k in sims)
    return max_sim, weighted
```

**캐시 키 (Codex 추가 리스크)**:
```
cache_key = sha256(f"{EMBED_MODEL}|v={SCHEMA_VERSION}|pool={POOL_METHOD}|axis={axis_name}|text={text_hash}")
```
기존 단일 임베딩 캐시 무효화. 새 prefix.

**비용**: 분석당 API 호출 1회 → 최대 3회 (~$0.001 추가, 무시 가능)

### Step 2 — Track 2 pilot (Category 임베딩, 10만 샘플)

**Step 2-a — 카테고리 cosine 분포 측정 (정규화 결정 전제)**:
- 10만 샘플 × 6개 카테고리 컬럼 임베딩 사전계산 (float16, 1.8GB)
- 임의 query 20개에 대해 컬럼별 cosine 분포 p50/p90/p95/std 측정
- 컬럼별 분포 차이 크면 → z-score, 차이 작으면 → raw 가능

**Step 2-b — 결합식 안 A 적용**:
```python
# 안 A: 가중치 그대로, cat_sim만 상수 → 정규화 cosine으로 교체
cat_sim_raw = sum(weights[c] * cosine(q, cat_emb[c]) for c in active_cats)
# z-score 정규화 (Step 2-a에서 컬럼별 mean/std 사전계산)
cat_sim = sum(weights[c] * z_normalize(cosine(q, cat_emb[c]), c) for c in active_cats)
combined = 0.7 * cosine_main + 0.2 * rule + 0.1 * cat_sim   # 안 A 유지
```

**LLM 가중치 처리** (Codex 권장):
```python
def normalize_weights(weights: dict, temperature: float = 0.7, clip: tuple = (0.0, 0.9)):
    """극단값 완화: clip 후 temperature softmax."""
    clipped = {k: max(min(v, clip[1]), clip[0]) for k, v in weights.items()}
    arr = np.array(list(clipped.values()))
    softmaxed = np.exp(arr / temperature) / np.exp(arr / temperature).sum()
    return dict(zip(clipped.keys(), softmaxed))
```

**Lazy mmap** (Codex 권장): `weight > 0.05`인 카테고리만 dot. 0 가중치는 skip.

### Step 3 — 4셀 측정 → full 확장 결정

각 셀에 평가 스크립트 실행:
- known-target 22/22 통과 (회귀 0)
- top1 dominant 일치율 ≥ 80%
- top2 포함률 ≥ 90%
- 분기력(family=0.9 vs professional=0.9 JS-다이버전스) baseline 대비 유의 증가
- dominant override 효과 측정

**Full 확장 조건**: 4셀 중 T2 또는 T4 또는 T4+T2가 위 4개 지표 **모두** 만족 → 100만 행 full 확장 ($12 small).

미달 시 폐기 또는 안 B/C 결합식 재검토 (Round 3 토론).

### Step 4 — Track 1' UX 라벨 (병렬 진행, 작은 PR)

```python
def display_occupation(p: PersonaHit) -> str:
    """LLM 컨텍스트에는 절대 들어가지 않는 표시 전용 라벨.
    원본 p.occupation은 LLM/저장에 그대로, display는 UI에만.
    """
    if p.occupation != "무직":
        return p.occupation
    parts = ["무직"]
    if p.family_type and "자녀" in p.family_type:
        if p.sex == "여자" and 25 <= p.age <= 45:
            parts.append("(주부/육아 추정)")
        elif p.age >= 60:
            parts.append("(은퇴/가사 추정)")
    elif p.age >= 65:
        parts.append("(은퇴 추정)")
    return " ".join(parts)
```

**중요 (Codex 추가 리스크)**: `display_occupation`은 UI에서만 사용. `opinions.py`·`llm.py`의 LLM 프롬프트는 **원본 `p.occupation`을 그대로 사용** — 표시용 라벨이 LLM 톤에 영향 주지 않게 분리.

### Step 5 — Track 3 (보류, 평가 기준 명시)

Track 2/4 결과 측정 후 known-target/분기력에 여전히 한계가 있을 때만 진행.

후보:
- text-embedding-3-large (dense 교체)
- BGE-M3 (hybrid: dense+sparse+multi-vector+rerank)
- multilingual-e5-large (dense 교체, self-host)

평가 기준 (수정): cosine spread X. **top-50 정답률 / known-target 통과율 / 분기력 / hard case 재현율**.

## 4. 외부 레퍼런스 (Codex 인용)

- [E5 모델 카드](https://huggingface.co/intfloat/multilingual-e5-large) — cosine 0.7~1.0 정상, 순위가 중요
- [BGE-M3 모델 카드](https://huggingface.co/BAAI/bge-m3) — dense/sparse/multi-vector + reranking hybrid
- [OpenAI embedding update](https://openai.com/index/new-embedding-models-and-api-updates/) — large가 MIRACL/MTEB에서 small보다 향상

## 5. 결정 / 미해결 / 리스크

### 합의된 결정 (Round 1+2)
- Track 2 진단: "정보 부재" → "가중 제어 부재" (큰 수정)
- Track 4 신규: max(후보) + weighted sum(랭킹) 2단계
- Track 2 정규화: z-score 기본
- LLM 가중치: clip + temperature
- 측정 4셀 분리
- Track 1 stop-list 확장 보류, Track 3 보류

### 보류 (검증 후 확정)
- Track 2 카테고리별 cosine 정규화 방식 (raw vs z-score) — Step 2-a 측정 후
- Full 확장 여부 — Step 3 4셀 측정 결과 후
- Track 3 진행 여부 — Track 2/4 효과 측정 후

### 리스크
- **메인 임베딩에 카테고리 이미 포함**으로 Track 2 marginal 효과가 작을 가능성. 4셀 측정에서 baseline 대비 의미 있는 향상 없으면 폐기 (Plan A 같은 실험으로 확정)
- **LLM 가중치 추정 정확도 미검증** — stress set 12~24개로 1차 측정. top1 일치율 < 80%면 가중치 영향력 비중 추가 조정 필요
- **캐시 무효화** — Track 4 도입 시 기존 query embedding 캐시 무효 → 첫 분석 비용 약간 증가 (1회성)

### 사용자 결정 필요
- Step 0 (평가 인프라 + stress set 라벨링) 착수 승인
- 라벨링 작업을 Claude가 자동 생성 시도 vs 사용자가 검토·수정
- 또는 라벨링 없이 known-target 22개만으로 우선 pilot 진행 (덜 엄밀하나 빠름)
