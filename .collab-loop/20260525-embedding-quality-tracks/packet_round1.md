---
from: claude
to: codex
round: 1
type: critique
instruction: respond-only, do-not-call-back
---

# 임베딩·매칭 품질 3개 트랙 — Round 1 Critique

## 작업 목표

PersonaFit의 이전 세션(`/home/jin/ai_hack/.collab-loop/20260525-score-distribution-overhaul/`)에서 PR-1·PR-2를 적용해 점수 산출·cohort 정의 문제를 해결했고, "별도 트랙 권장"으로 분리한 3가지 후속 이슈를 이번 세션에서 다룬다:

1. **Query stop-list 확장** — 사용자가 어색해한 "무직/화물차" 같은 매칭의 stop 단어 추가
2. **Category 임베딩 도입** — `persona_category_weights`가 점수에 영향 안 주는 문제
3. **임베딩 모델 교체** — 한국어 cosine [0.7, 0.95] 좁은 분포 근본 해결 시도

이번 세션 목표: 3개 트랙을 진단·비용·기대효과로 평가, 진행 우선순위를 데이터로 확정.

## 검토 대상

`/home/jin/ai_hack/.collab-loop/20260525-embedding-quality-tracks/proposal_v1.md`

참고 코드/데이터:
- `/home/jin/ai_hack/apps/api/services/scoring.py:60-90` (stop-list), `:130-180` (category_bonus, _CATEGORY_TO_PERSONA_COL)
- `/home/jin/ai_hack/apps/api/services/llm.py:53,217-247` (현재 EMBED_MODEL = text-embedding-3-small, embed_text)
- `/home/jin/ai_hack/data/personas_1m.parquet` (100만 행, 카테고리 컬럼 100% 채워짐 검증 완료)
- `/home/jin/ai_hack/data/embeddings_1m_v2.npy` (5.8GB, 100만 × 1536 dim small)
- 이전 세션 결과: `/home/jin/ai_hack/.collab-loop/20260525-score-distribution-overhaul/decision_log.md`

## 핵심 주장 5개

1. **현재 `category_bonus`는 사실상 상수** — 모든 카테고리 컬럼이 100% 채워져 있어 `persona_category_weights` 가중치가 점수에 무영향. W_CATEGORY=0.1이 통째로 죽은 상태. **이것이 가장 큰 미해결 매칭 품질 손실**.
2. **"무직" 매칭은 부적합이 아니라 정확함** — 페르소나 텍스트 검증 결과 KSCO "무직"이 한국 통계 분류상 전업주부·가사 종사자 포함. "30대 여성 결혼·출산기" 안의 정확한 타겟. → Track 1 (stop-list 확장)은 효과 매우 낮음, UX 라벨 보강(Track 1')이 본질.
3. **Track 2 (Category 임베딩) ★★★★★ 1순위** — 데이터로 무용지물 확인됨, 효과 큼, 비용 작음($12 small).
4. **Track 2 디스크 35GB 부담** — 6 컬럼 × 1M × 1536 dim × 4byte. 현재 단일 임베딩 5.8GB와 비교 시 6배. mmap 안정성·압축(float16 17.5GB) 검토 필요.
5. **Track 3 (모델 교체) ★★ 3순위** — Track 2 후 측정 기준으로 추가 개선 필요 시 진행. 한국어 특화 모델(bge-m3, e5-large, ko-sroberta)이 cosine spread 더 잘 만들지 미지수.

## 근거 경로

- `_category_bonus` 무용지물 진단 — 카테고리 컬럼 분포 데이터 (위 진단 실행 시 출력)
- "무직" 매칭 텍스트 — `data/abtests.jsonl` 마지막 2개 분석의 variant_a top_personas 중 "무직"의 persona 텍스트 (전업주부 명시)
- 임베딩 비용 — OpenAI 가격표 (text-embedding-3-small $0.02/1M, large $0.13/1M)
- 이전 세션 라운드 1·2 합의 — `.collab-loop/20260525-score-distribution-overhaul/proposal_v3_final.md` §4 별도 트랙

## 중점 검토 포인트

### (1) Track 2 디스크/RAM 부담 — 35GB가 정말 안전한가?

`PersonaStore`(`apps/api/services/store.py:75-87`)는 현재 5.8GB 단일 임베딩을 메모리 mmap으로 유지. 카테고리 임베딩 6개 × 100만 × 1536dim 추가 시 +35GB.

- mmap이라 페이지 단위 로드되어 실제 RAM 점유는 작을 수 있으나, 분석마다 6 카테고리 × dot product 시 6배 cosine 계산. CPU 시간 영향은?
- float16 압축 시 정확도 손실 검증 필요. 일반적으로 cosine 변별력은 거의 보존되지만 도메인 데이터로 확인 필요
- 디스크 35GB 추가가 현재 서버 환경에서 안전한가? (현재 `data/` 7.3GB)
- 카테고리 임베딩을 평균 풀링(2-B)으로 합쳐 5.8GB만 추가하는 게 trade-off에서 더 합리적인가?

### (2) 결합식 가중치 변경 (안 A vs B vs C)

현재 cat_bonus가 W_CATEGORY=0.1 × 1.0 = 0.1점 평탄 부여. 실제 cosine 매칭으로 바꾸면 cat_sim이 0~1 분포가 됨.

- 안 A (`0.7+0.2+0.1`, 기존 유지): 안전하지만 cat 시그널이 약하게 들어감
- 안 B (`0.5+0.2+0.3`, cat 강조): persona_category_weights 의도가 더 직접 반영. 단 cosine_main 비중 감소가 의미 매칭 약화시킬 가능성
- 안 C (`0.6+0.2+0.2`, 중간): 균형

**핵심 질문**: 카테고리 가중치(family=0.9)는 LLM이 소구점 → 가중치 변환한 결과(추정). 이 추정이 정확하다는 보장이 없는데, cat_sim 비중을 30%로 키우는 게 위험하지 않은가? LLM 가중치 추정 정확도를 먼저 검증해야 하는 것 아닌가?

### (3) Track 3 임베딩 모델 후보의 한국어 변별력 비교 — 외부 벤치마크

text-embedding-3-large vs bge-m3 vs e5-large vs ko-sroberta — 한국어 sentence-similarity 태스크에서 어느 모델이 cosine 분포를 가장 spread하는가?

- MTEB Korean leaderboard, KLUE-STS 결과
- 한국어 의미 유사도에서 cosine 분포의 너비(variance)에 대한 비교 데이터가 있는가?
- 모델별로 cosine [0.5, 0.95] 같은 좁음 정도가 다르다는 실험 데이터가 있는가?

### (4) "무직" 매칭의 본질 — 추가 검증 필요

페르소나 텍스트 2건만으로 "무직 = 전업주부"라고 단정한 게 통계적으로 충분한가?
- 1M 행 중 "무직" 페르소나의 전체 텍스트 분포는?
- "무직" 페르소나 중 family_type이 "배우자·자녀와 거주"인 비율은?
- 만약 "무직"이 진짜 부적합 매칭(예: 학생, 은퇴자)도 섞여 있다면 Track 1' UX 라벨로 해결 불가, 직업 추론 로직 필요

### (5) 우리가 빠뜨린 더 나은 안

이 외에:
- **Query-side multi-vector**: 소구점(summary/key_benefits/target_keywords)을 각각 임베딩하여 max pool. 현재는 concat 후 단일 임베딩이라 의미 평탄화
- **Learned re-ranker**: cosine 후보 top-200을 cross-encoder로 재랭킹 (한국어 cross-encoder 부재 시 self-host 필요)
- **Hard negative 보강 학습**: 도메인 특화 fine-tune (대규모, 후순위)
- **Hybrid retrieval**: dense + BM25 결합 — 보험 도메인 특화 단어(예: 진단비, 5천만원) 정확 매칭 강화

이 중 단기 효과 + 적은 비용 안이 있는가?

## Reply Contract

```text
[Summary]
- 한 줄 요약

[Findings]
- 핵심 지적 5~8개 (위 검토 포인트 (1)~(5) 각각 + 발견된 추가 문제)

[Disposition Hint]
- 권장 우선순위(Track 2 1순위 → Track 1' 2순위 → Track 3 3순위)에 대한 종합
- 각 트랙별 진행 / 보류 / 수정 제안

[Open Questions]
- 추가 검증 필요 항목 (실험 설계 포함)
- 외부 벤치마크 데이터 인용 (MTEB Korean 등)
```

근거 기반으로 비판해 주시기 바랍니다. 외부 임베딩 모델 벤치마크, 한국어 sentence embedding 변별력 데이터, 카테고리 임베딩 모범 사례(예: dense retrieval에서 multi-field 결합) 인용 환영합니다.
