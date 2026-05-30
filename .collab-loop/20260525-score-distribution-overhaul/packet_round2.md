---
from: claude
to: codex
round: 2
type: critique
instruction: respond-only, do-not-call-back
---

# 점수 산출·대상자 확정 로직 고도화 — Round 2 (디테일 합의)

## 작업 목표 (Round 1 동일)

PersonaFit의 점수 산출·대상자 확정 로직 고도화. Round 1에서 v1 → v2로 통합 완료, 미합의 0건. 이번 라운드는 v2의 미해결 디테일 5건을 합의하여 P0~P4 구현 착수 가능 상태로 만드는 것이 목표.

## 검토 대상

`/home/jin/ai_hack/.collab-loop/20260525-score-distribution-overhaul/proposal_v2.md`

Round 1 응답: `/home/jin/ai_hack/.collab-loop/20260525-score-distribution-overhaul/reply_round1_codex.md`

## Round 1 합의 요약 (재확인 — 이의 있으면 표시 부탁)

1. **`score` 필드 = raw 보존**, `percentile_score` 별도 신설 — 합의
2. **cohort는 현재 absolute primary + 폴백 로직 유지** (순위 일원화 폐기) — 합의
3. **`PopulationStats` 확장**: `raw_mean/std/p50/p95/p99`, `n_above_80/65`, `core_lift/target_lift`, `quality_flags` — 합의
4. **rule_bonus 정규화 변경**: 명시 차원만 분모 + 하한 0.1 (음수 페널티 폐기) — 합의
5. **category_bonus, query de-noising은 별도 트랙** (이번 범위 외) — 합의
6. **단계적 적용 P0~P4** — 합의

## 미해결 쟁점 (Round 2 토론 대상)

### 쟁점 A — `percentile_score` 계산 시점·비용

**A측 (Claude v2 안)**: `score_all_personas` 후 `np.argsort` 두 번으로 모집단 100만 행 백분위 계산. 약 0.1~0.2초 추가, 메모리는 float32 1M = 4MB 추가. 분석 응답에 큰 영향 없다고 봄.

**B측 (Codex 가능 반론)**: ?

**중점 검토**: 100만 행 argsort × 2를 매 분석마다 실행하는 게 정말 안전한 비용인가? 캐싱 전략 (예: 동일 query embedding이면 percentile 재사용) 필요한가? scipy의 `rankdata` vs numpy `argsort` 차이는?

### 쟁점 B — UI 점수 표기 형태

세 가지 후보:
- **B-1**: 한 줄 — `78점 (상위 0.1%)`
- **B-2**: 두 줄 — 메인 `78점` / 보조(작게) `상위 0.1%`
- **B-3**: 토글 — 사용자가 raw / percentile 선택

권장: B-2 (메인 raw 유지, 보조로 percentile). UI 변화 최소화 + 직관 추가.

**중점 검토**: 카드가 좁은 모바일에서 두 줄이 시각적 부담은 없는지. 또는 percentile만 호버 툴팁으로 노출하는 안은? 비교 표(`A vs B 비교 표`)에서는 "평균 raw 점수"와 "평균 percentile" 둘 다 행으로 추가하는지?

### 쟁점 C — 품질 게이트 임계값

v2 제안: `p99-p50<3`, `core_lift<2`, `mode_inconsistent`.

**중점 검토**: 
- 실측 데이터로 임계값 보정. 정상 분포(20f5786a: p99=72, p50=62, p99-p50=10)는 통과, 비정상(cb6ef5fd: p99=78, p50=77, p99-p50=1)은 잡힘. 임계 3이 적절한가, 5가 적절한가?
- `core_lift < 2`: 정상 분포의 core_lift는 보통 얼마? (raw core avg − raw global avg)
- 게이트 발동 시 분석을 차단하지는 않고 경고 배지만 띄우는 게 맞는가? (사용자 혼란 방지)
- 추가 후보 게이트: `target_size_volatility` (A·B 간 target absolute 크기 차이가 100배 이상이면 분포 차이가 너무 커서 비교 부적합 등)?

### 쟁점 D — rule_bonus 하한값 0.1

**A측 (Claude v2)**: 0.1 — 완전 미일치자도 cosine + cat이 0.85 정도라 최종 0.59 → clip 후 약 59점. 분포 하단 확장.

**B측 (Codex 가능 반론)**: 하한값 결정은 백테스트 필요. 0.05면 더 spread, 0.2면 안정.

**중점 검토**: 하한값을 0.05 / 0.1 / 0.2로 실측 데이터에 적용했을 때 분포 spread(std, p99-p50) 차이가 얼마인가? 임의 값보다 데이터 기반 선택이 안전.

### 쟁점 E — 단계별 적용 순서 — 한 PR vs 분리

**A측 (Claude v2)**: P0~P4를 6개 단계로 분리. 의존성: P0(스키마)→P2(UI), P1(통계)→P2(비교표), P3(rule)→백테스트→P4(게이트).

**B측 (Codex 가능 반론)**: P0+P1+P2를 한 묶음(외부 노출만)으로 가고, P3+P4를 별도 묶음(점수 의미 변화)으로 분리하는 게 안전.

**중점 검토**: 어떤 묶음이 안전한가? P3(rule_bonus 변경)는 raw score 분포가 바뀌므로 LLM 컨텍스트와 cohort 컷이 모두 영향. P0~P2 먼저 배포(읽기 전용 추가)하고 P3는 별도가 맞는가?

### 추가 검토 — 우리가 놓친 게 있는가

위 5개 외에 v2의 약점, 빠뜨린 위험, 더 나은 안이 있으면 지적해주세요. 특히:
- **scipy 의존성** — `rankdata`를 쓰면 scipy를 dep에 추가해야. numpy `argsort` 2회로 동등 구현 가능한가?
- **percentile_score의 동률 처리** — argsort는 동률을 임의 순서로 배치. 같은 raw score가 다른 percentile로 표시되는 부작용. `rankdata(method='average')`가 표준.
- **PopulationStats 확장의 옛 분석 호환** — `raw_mean` 등 새 필드를 기존 jsonl이 안 가진 경우, Pydantic default 처리 + UI 옵셔널.

## Reply Contract

```text
[Summary]
- 한 줄 요약

[Findings]
- 쟁점 A~E 각각에 대한 의견 + 추가 발견

[Disposition Hint]
- 각 쟁점별: 합의 / 수정 제안 / 미합의
- v2 전체에 대한 진행 가능 여부

[Open Questions]
- 추가 검증 필요 (Plan A~D 중 우선순위 제안 포함)
```
