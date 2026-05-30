---
from: claude
to: codex
round: 2
type: critique
instruction: respond-only, do-not-call-back
---

# 임베딩·매칭 품질 트랙 — Round 2 (디테일 합의)

## 작업 목표 (Round 1 동일)

3개 트랙(stop-list/category/모델교체) 평가 → v1 → v2 통합 완료, 미합의 0건. 이번 라운드는 v2의 미해결 5건을 합의하여 Track 4(query multi-vector) + Track 2(category pilot)를 구현 착수 가능 상태로.

## 검토 대상

`/home/jin/ai_hack/.collab-loop/20260525-embedding-quality-tracks/proposal_v2.md`

Round 1 응답: `/home/jin/ai_hack/.collab-loop/20260525-embedding-quality-tracks/reply_round1_codex.md`

## Round 1 합의 요약 (재확인 — 이의 있으면 표시)

1. Track 2 진단: "카테고리 정보 부재" → **"가중 제어 부재"** (combined 임베딩에 이미 포함)
2. **pilot 방식** — 10만 샘플, float16, 상위 1~2 카테고리만, 안 A 결합식부터
3. **float16 채택** (top50/100 overlap 100% 검증됨)
4. **결합식 안 A부터** (LLM 가중치 추정 정확도 검증 후 비중 결정)
5. UX 라벨은 **context 기반 추론** (일괄 라벨 금지)
6. **Track 1 (stop-list 확장) 보류** — 실제 신호 삭제 위험
7. Track 3 평가 기준 **cosine spread → top-k/known-target/분기력** 으로 수정. 모델 교체보다 **hybrid (BGE-M3)** 가 본질
8. **Track 4 (Query multi-vector) 신규** — 데이터 재생성 0, Track 2 pilot과 병렬
9. **lazy mmap** — weight 상위 카테고리만 dot
10. 카테고리 cosine 정규화 — 컬럼별 분포 측정 후 raw vs z-score vs percentile 결정

## 미해결 쟁점 (Round 2 토론)

### 쟁점 A — Track 4 (Query multi-vector) pool 방식

3개 후보:
- **A-1 weighted sum** — `0.5*sim_summary + 0.3*sim_benefits + 0.2*sim_keywords` (가중 평균, 안정)
- **A-2 max pool** — `max(sim_summary, sim_benefits, sim_keywords)` (어느 한 축이라도 강하면 높은 점수)
- **A-3 ColBERT-style late interaction** — 토큰 단위 max-sim 합산 (복잡, 추가 인덱스 필요)

**중점 검토**: 
- baseline(concat) 대비 단순 첫 비교는 A-1 vs A-2면 충분한가?
- 보험 도메인에서 어느 pool이 직관에 맞나? (예: "결혼·출산기" + "5000만원" + "여성"이 각 축 매칭에 어떻게 작동해야 하는가)
- max pool은 한 축 노이즈에 취약하지만 weighted sum은 평균 회귀 위험. 어느 쪽이 분기력에 유리?

### 쟁점 B — Track 2 카테고리 cosine 정규화 방식

카테고리별 cosine 분포가 다를 가능성. 예: family_persona는 [0.65, 0.95], professional_persona는 [0.75, 0.92] 같이 평균/spread 다르면 단순 가중합 시 cosine 평균 큰 컬럼이 우세.

3개 후보:
- **B-1 raw cosine** — 그대로 가중합 (단순, 편향 위험)
- **B-2 z-score** — 컬럼별 mean/std 사전계산 후 표준화 (정규성 가정)
- **B-3 percentile rank** — 컬럼별 분포에서 백분위 변환 (분포 형태 무관, 비용 큼)

**중점 검토**:
- pilot에서 6개 컬럼 분포 차이가 실제로 큰가? 데이터 먼저 봐야 결정?
- B-3는 100만 행 전체에 대해 매번 percentile 계산이라 비용 큼 → 사전계산 가능?
- LLM 가중치(family=0.9)는 컬럼 cosine 분포 차이를 고려 안 했으니, 정규화 안 하면 LLM 의도와 어긋날 수 있다는 게 v2 직관. 맞는가?

### 쟁점 C — LLM 카테고리 가중치 추정 정확도 검증 방법

`persona_category_weights`(family=0.9 등)는 LLM이 소구점 → 카테고리 가중치 변환. 이 추정이 신뢰할 만한지 검증해야 cat 비중 결정 가능.

**제안 (v2)**: 11개 known-target에 수작업 dominant category 라벨링 → LLM 추정과 비교

**중점 검토**:
- 11개가 통계적으로 충분한가? 더 필요한가?
- 수작업 라벨링 기준 — 1명이 결정 vs 다수 합의?
- 검증 결과 LLM 일치율 X% 이상이면 cat 비중 증가 OK라는 임계값?
- 대안: LLM 가중치를 그대로 쓰지 않고 **soft normalization**(예: temperature 적용으로 극단값 완화) 후 사용?

### 쟁점 D — Pilot 완료 후 full 확장 의사결정 기준

v2에 "known-target 통과율 ≥ baseline, dominant override 시 의도 이동" 등 정성적 기준 명시. 구체화 필요.

**중점 검토**: 정량 임계값을 어떻게 잡나? 예시:
- known-target 통과율: 현재 100% → pilot에서도 100% 유지 (regression 0)
- one-hot override 효과: family=1.0일 때 상위 50명 중 family_persona 텍스트 길이가 모집단 p90 이상인 비율 ≥ 70%
- 분기력: family=0.9 vs professional=0.9 두 케이스 상위 50명 직업 분포 Jensen-Shannon 다이버전스 ≥ X
- top50 평균 점수 baseline 대비 ≥ ±2점 (큰 점수 변동 없음)

이런 식의 기준이 합리적인가? 추가 지표?

### 쟁점 E — Track 4와 Track 2 병렬 vs 순차

둘 다 pilot. 

- **병렬**: Track 4 (즉시 가능, 데이터 재생성 0) + Track 2 (카테고리 임베딩 사전계산 후) 동시 실험
- **순차**: Track 4 먼저 (data prep 0) → 효과 확인 후 Track 2 진행 (필요시)

**중점 검토**: 
- 병렬이면 두 변경이 동시에 들어가 효과 분리 안 됨. baseline/Track 4/Track 4+Track 2 3단계 측정?
- 순차면 Track 4 측정 1주, Track 2 측정 1주 → 2주 소요
- 어느 쪽이 더 효율적?

### 추가 검토 — 우리가 또 놓친 게 있는가

위 5개 외에 v2의 약점, 빠뜨린 위험, 더 나은 안:
- pilot 측정 자동화 (반복 실행 스크립트)
- "무직 (주부/육아 추정)" UI 라벨이 LLM 의견 생성에 영향 미치는가 (라벨이 LLM 컨텍스트에도 들어가면 톤 바뀜)
- query multi-vector 도입 시 임베딩 캐시 키 변경 — 기존 cache 무효화 영향?
- 카테고리 임베딩 사전계산 시점 — 분석마다? 1회? 정기?

## Reply Contract

```text
[Summary]
- 한 줄 요약

[Findings]
- 쟁점 A~E 각각 의견 + 추가 발견

[Disposition Hint]
- 각 쟁점별: 합의 / 수정 제안 / 미합의
- v2 전체 진행 가능 여부

[Open Questions]
- 추가 검증 필요 (실험 우선순위 포함)
```
