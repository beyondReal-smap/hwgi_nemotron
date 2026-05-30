# 임베딩·매칭 품질 트랙 — 제안 v2

> v1 → v2: Codex Round 1 critique 반영. 가장 큰 진단 수정: **메인 임베딩에 카테고리 텍스트가 이미 포함**되어 Track 2의 가치가 "카테고리 정보 부재"가 아닌 "**가중 제어 부재**"로 재정의됨. 신규 후보 Query multi-vector 추가. pilot 방식 + float16 + 안 A부터 + 평가 지표 재설정 합의.

## 1. 토론 상태표 (Round 1 결과)

| # | 쟁점 | v1 (Claude) | Codex critique | 상태 | v2 조치 |
|---|------|---------|---------|------|---------|
| 1 | Track 2 진단 | "카테고리 정보 부재" | **`embeddings_1m_v2.npy`는 combined 모드 — family/professional 등이 이미 메인 임베딩에 포함** (`scripts/embed_personas.py:15,63`). 부재한 건 "가중 제어" | 합의 (큰 수정) | 진단 재정의 |
| 2 | 도입 방식 | 2-A full (6 컬럼 × 1M, 35GB) 즉시 | **10만 샘플 → float16 → 상위 1~2 카테고리만 → 안 A/C 비교** pilot | 합의 | pilot 방식 채택 |
| 3 | 디스크 부담 | 35GB | float16 (~18.4GB). 기존 임베딩 10만 샘플 검증: float32 대비 top50/100 overlap 100% | 합의 | float16 채택 |
| 4 | 결합식 가중치 | 백테스트로 결정 | **안 A부터** (현행 0.7/0.2/0.1 유지). cat 비중 키우려면 LLM 추정 정확도 검증 후 | 합의 | 안 A 시작 |
| 5 | 무직 매칭 본질 | "정확한 매칭, UX 문제" | 100만 행 전체: 무직 36.7% (은퇴 15%/가사 15%/주부 8%). **30대 여성 한정 시 주부 35.8% + 배우자있음 61.3%로 강한 가설**. 일반화 약함 | 부분 합의 | UX 라벨은 **context 기반 추론** (family_type/혼인/연령 결합) |
| 6 | Track 1 stop-list | 효과 낮음 | "화물차/무직" stop은 실제 신호 삭제 위험 → 명시 보류 | 합의 | 보류 |
| 7 | Track 3 모델 교체 | 후보 4개, "cosine spread 확대" 지표 | **잘못된 지표** — [E5 모델 카드](https://huggingface.co/intfloat/multilingual-e5-large) "cosine 0.7~1.0 정상, 순위가 중요". top-k/known-target/분기력으로 평가 | 합의 | 평가 기준 수정, 보류 |
| 8 | 신규 후보 | — | **Query-side multi-vector** — summary/key_benefits/target_keywords를 각각 임베딩 → max/weighted pool. 데이터 재생성 0 | 합의 (큰 추가) | Track 2 pilot과 병렬 신규 트랙 |
| 9 | 저장소 전략 | full 6개 매번 dot | **weight 상위 카테고리만 lazy mmap dot** (가중치 0인 카테고리 skip) | 합의 | lazy 채택 |
| 10 | Hybrid 후보 | 미고려 | **BGE-M3는 dense/sparse/multi-vector + rerank hybrid**가 공식 권장. 모델 교체보다 hybrid 후보 | 합의 | Track 3 재정의 |

미합의 0건. v2는 위 합의 그대로 반영.

## 2. 재정의된 진단

### 핵심 수정: Track 2의 가치는 "카테고리 정보 부재" → "가중 제어 부재"

`embeddings_1m_v2.npy`는 7개 페르소나 텍스트(`family_persona`, `professional_persona`, `sports_persona`, `arts_persona`, `travel_persona`, `culinary_persona` + 메인 `persona`) + 3개 속성(`skills_and_expertise`, `hobbies_and_interests`, `career_goals_and_ambitions`)을 라벨 + 줄바꿈으로 합친 **통합 텍스트의 단일 임베딩** (`scripts/embed_personas.py:63-94`).

따라서:
- ❌ 잘못된 진단: "카테고리 정보가 메인 임베딩에 없어 cat_bonus로 보강 필요"
- ✅ 올바른 진단: "카테고리 정보는 이미 메인 임베딩에 평탄하게 섞여 있음. 부재한 건 **`persona_category_weights`(family=0.9 등)에 따라 특정 카테고리 부분을 가중 강조하는 제어 능력**. 현재 `_category_bonus`는 100% 채워진 컬럼에 상수 부여로 이 가중 제어가 완전 무효화"

→ Track 2 (카테고리별 임베딩)의 효과는 v1에서 추정한 것보다 **작을 가능성**. 메인 임베딩에 이미 family·professional 텍스트가 있으니 가중 제어로 추가되는 marginal 정보는 제한적. 다만 family=0.9 같은 극단 가중치에서는 충분히 의미 있는 차별화 기대.

## 3. 권장 진행 순서 (v2 — pilot 우선)

| 순위 | 트랙 | 작업 | 비용 | 효과 추정 |
|---|---|---|---|---|
| **1** | **Track 4 (신규) — Query multi-vector pilot** | summary/key_benefits/target_keywords를 각각 임베딩 후 cosine 후보 N(예: 5,000) ∩ pool. 데이터 재생성 0 | 작음 (~$1, 분석당 API call 3회) | 미지수, 단기 효과 가능성 |
| **2** | **Track 2 — Category 임베딩 pilot** | 10만 샘플 + 상위 1~2 카테고리(family 우선)만 float16 사전계산. 안 A(0.7/0.2/0.1) 결합 | $1.20 (10만 × 6 카테고리 small) | 중 (가중 제어 회복) |
| **3** | **Track 1' — UX 라벨 보강 (context 기반)** | "무직" 표시 시 family_type + 혼인 + persona 텍스트로 추론 (예: 30대 여성 + 배우자·자녀 거주 + 주부 키워드 → "주부 추정") | 작음 (UI/유틸 로직만) | 작음 (UX 개선) |
| 보류 | Track 1 (stop-list 확장) | — | — | 매우 낮음 |
| 보류 | Track 3 (모델 교체) | Track 2/4 결과 후, top-k/known-target/분기력 기준 평가 | 중~큼 | 미지수 |

### Pilot 단계 종료 조건 (Track 2/4 둘 다)

- 10만 샘플에 적용 후 다음 지표 측정:
  1. **Known-target 통과율** — target_age/sex 명시 시 상위 50명 중 일치 비율 (현재 100%)
  2. **Dominant category override 효과** — persona_category_weights를 one-hot(예: family=1.0)로 강제 시 상위 50명이 family_persona 텍스트 풍부도로 정렬되는가
  3. **상위 50명 평균 점수 / std / p99-p50 spread** (baseline 비교)
  4. **분기력 지표** — 가중치 family=0.9 vs professional=0.9에서 상위 50명 직업 분포 차이

조건 충족 시 full(100만) 확장. 미달 시 폐기 또는 안 B/C 결합식 재검토.

## 4. 트랙별 상세

### Track 4 (신규) — Query-side multi-vector

**모티베이션**: 현재 `build_query_text`(`scoring.py:73-88`)는 `summary + key_benefits + target_keywords`를 단순 concat → 단일 임베딩. 다른 의미 축(예: "결혼·출산기" + "월 38,000원" + "여성")이 평균 풀링되어 의미 변별력 손실.

**변경안**:
```python
def query_vectors(sp: SellingPoints) -> dict[str, np.ndarray]:
    """3개 의미 축을 각각 임베딩."""
    return {
        "summary": embed_text(sp.summary),
        "benefits": embed_text(" ".join(sp.key_benefits)) if sp.key_benefits else None,
        "keywords": embed_text(" ".join(sp.target_keywords)) if sp.target_keywords else None,
    }

# 매칭: weighted sum + max pooling 후보
cosine_combined = (
    0.5 * cosine(q_summary, emb)
  + 0.3 * cosine(q_benefits, emb)
  + 0.2 * cosine(q_keywords, emb)
)
# 또는 max:
cosine_combined = np.max([cosine_summary, cosine_benefits, cosine_keywords], axis=0)
```

**비용**: 분석당 임베딩 API 1회 → 3회 (3배 ~$0.0003 → ~$0.001). 무시 가능.
**위험**: pool 방식(weighted vs max)에 따라 결과 다름. 백테스트 필수.

### Track 2 — Category 임베딩 (pilot)

**Pilot 범위**:
- 10만 샘플 (data/personas_100k.parquet 활용)
- 카테고리 1~2개부터: **family_persona** (우선, 보험 상품 가장 흔한 가중치)
- float16 저장 (10만 × 1536 × 2byte = 307MB per category)
- 안 A 결합식(`0.7 cos_main + 0.2 rule + 0.1 cat_sim`)으로 시작

**측정**:
- baseline(cat_bonus 상수) vs pilot(cat_sim 가중)의 top50 차이
- family=1.0 one-hot일 때 상위 50명 family_persona 텍스트 풍부도 변화
- LLM 카테고리 가중치 추정의 검증 가치 (수작업 라벨링 11개 케이스와 비교)

**Full 확장 조건**:
- pilot에서 known-target 통과율 유지(100%)
- one-hot override 시 상위 50명 직업/페르소나 분포 의도대로 이동
- 카테고리별 cosine 분포(p50/p95/p99) 측정 후 z-score 또는 percentile 정규화 검토 (Codex Open Question)

### Track 1' — UX 라벨 보강 (context 기반)

**원칙**: 일괄 라벨("무직(주부 포함)") 금지. context 추론.

**로직 (제안)**:
```python
def display_occupation(p: PersonaHit) -> str:
    if p.occupation != "무직":
        return p.occupation
    # 무직 → context 기반 추론
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

Codex 통계 근거: 30대 여성 무직 중 주부 35.8% + 배우자있음 61.3%이므로 "주부/육아 추정" 합리적. 일반 인구의 무직(은퇴 15%/가사 15%)에는 적용 안 함.

### Track 3 — 모델 교체 / Hybrid (보류, 재정의)

**평가 지표 (수정)**:
- ❌ "cosine spread 확대" — 잘못. E5 모델 카드: cosine 0.7~1.0이 학습 특성상 정상, 순위가 중요
- ✅ top-50 정답률, known-target 통과율, A/B 분기력, 한국어 hard case (지역/직업) 재현율

**후보 재분류**:
| 후보 | 종류 | 평가 |
|---|---|---|
| text-embedding-3-large | dense 모델 교체 | 차원 3072 (small의 2배), MTEB/MIRACL 평균 향상 |
| BGE-M3 | **hybrid (dense+sparse+multi-vector+rerank)** | 모델 교체가 아니라 retrieval 전략 전환 |
| multilingual-e5-large | dense 모델 교체 | 한국어 양호, self-host 필요 |
| ko-sroberta | dense 모델 교체 | 한국어 특화, 차원 768 |

→ Track 3은 Track 2/4 효과 측정 후 진행 결정. 진행 시 단순 dense 교체보다 BGE-M3 hybrid 실험이 더 유효할 가능성.

## 5. 외부 레퍼런스 (Codex 인용)

- [E5 모델 카드](https://huggingface.co/intfloat/multilingual-e5-large) — cosine 0.7~1.0 정상, 순위가 중요
- [BGE-M3 모델 카드](https://huggingface.co/BAAI/bge-m3) — dense+sparse+multi-vector hybrid + reranking 공식 권장
- [OpenAI embedding update](https://openai.com/index/new-embedding-models-and-api-updates/) — large가 MIRACL/MTEB에서 small보다 향상, dimension shortening 지원

## 6. 미해결 (Round 2 토론 대상)

1. **Track 4 (multi-vector) pool 방식** — weighted sum (0.5/0.3/0.2) vs max pool vs ColBERT-style late interaction. baseline (현재 concat) 대비 차이 측정 우선순위
2. **Track 2 pilot의 카테고리 cosine 정규화** — raw cosine vs z-score vs percentile. 카테고리별 분포 다른 경우 편향 위험
3. **LLM 카테고리 가중치 추정 정확도** — 11개 known-target에 수작업 dominant category 라벨링하고 비교
4. **Pilot 완료 후 full 확장 의사결정 기준** — 정량 임계값 (예: known-target 통과율 ≥ baseline, dominant override 일치율 ≥ 70%)
5. **Track 4와 Track 2 병렬 vs 순차** — 둘 다 pilot이면 병렬이 빠른가, 결합 효과 확인이 어렵지 않은가
