# 점수 산출·대상자 확정 로직 고도화 — 최종 제안 v3

> v1 → v2 → v3(final). Round 1·2 토론 결과 통합. 미합의 0건. 구현 착수 가능 상태.

## 1. 문제 정의 (재확인)

**대표님 직감**: "점수가 항상 70점대만 나와 신빙성이 안 느껴진다. 분포가 골고루 나와야 할 것 같다."

**실측 데이터(100만 페르소나 × 10개 분석)**:
- range **[52, 78]** (100점 척도의 26%만 사용)
- 평균 63~67, std 3.7~4.1
- p99(상위 1%)조차 72점, max 78점 — **80점 이상 단 1명도 없음**

**진단**: 한국어 임베딩 cosine이 [0.7, 0.95]로 좁고, rule/cat 미명시 차원이 만점 처리되어 가산 결합이 평탄화되는 구조적 결과. + Codex 발견: **query 텍스트에 "보험" 키워드가 들어가 보험 종사자 직업군이 과매칭**되는 아티팩트(별도 트랙).

## 2. 핵심 합의 (Round 1+2 결과)

| 영역 | 결론 |
|---|---|
| `score` 필드 | **raw 유지** (LLM 톤·UI 색상 호환). `percentile_score` 별도 신설 |
| Cohort 정의 | **현재 absolute 우선 + 폴백 유지** (raw 분포 변동 signal 보존) |
| PopulationStats | **raw 통계 종합 확장** (mean/std/p50/p95/p99, n_above_80/65, core_lift, quality_flags) |
| rule_bonus | **명시 차원만 분모 정규화 + 하한값** (음수 페널티 폐기) |
| Category bonus / Query 노이즈 | **별도 트랙** (이번 범위 외) |
| 품질 게이트 | **경고 배지** (분석 차단 아님) |
| 적용 순서 | **P0+P1+P2 1차 PR** → 검증 → **P3** → **P4** (분리 배포) |

## 3. 구현 계획 — 2개 PR로 분리

### PR-1 (P0+P1+P2): 읽기 전용 노출 추가 — 점수 의미 불변

목표: 사용자/LLM에게 보이는 정보를 풍부하게 하되, 기존 점수 의미는 그대로 유지. 안전한 1차 배포.

#### P0 — `PersonaHit.percentile_score` 신설
```python
# scoring.py
def _compute_percentile_for_hits(top_scores, all_scores):
    """상위 hit 점수만 모집단 분포에 대해 백분위 변환.
    100만 행 전체 argsort 2회 대신, 정렬 1회 + searchsorted로 효율적.
    동률은 left/right 경계 평균으로 'rankdata(method=average)' 동치.
    """
    sorted_all = np.sort(all_scores)
    n = len(all_scores)
    left = np.searchsorted(sorted_all, top_scores, side='left')
    right = np.searchsorted(sorted_all, top_scores, side='right')
    avg_rank = (left + right) / 2
    # 백분위: 작을수록 0%, 클수록 100%
    return avg_rank / n * 100
```

```python
# schemas.py
class PersonaHit(BaseModel):
    score: float                  # raw, 기존 그대로
    percentile_score: float       # 신규: 모집단 내 백분위 (0~100, 100=최상위)
    ...
```

비용: scipy 의존성 없음. 100만 정렬 1회 + searchsorted N건 = 매 분석 +0.05초 정도.

#### P1 — `PopulationStats` 확장
```python
class PopulationStats(BaseModel):
    # 기존 필드 유지
    total_scored: int
    cohorts: list[CohortStat]
    score_distribution: list[DistributionBin]
    demographics: list[DemographicGroup]
    districts_full: list[RegionStat]
    # 신규 — 모두 옵셔널 (옛 jsonl 호환)
    raw_mean: float | None = None
    raw_std: float | None = None
    raw_p50: float | None = None
    raw_p95: float | None = None
    raw_p99: float | None = None
    raw_max: float | None = None
    n_above_80: int | None = None      # raw ≥80 인원
    n_above_65: int | None = None      # raw ≥65 인원
    core_lift: float | None = None     # core.avg_score − raw_mean
    target_lift: float | None = None
    quality_flags: list[str] = []      # 비어 있으면 정상
```

#### P2 — UI/비교표 노출

**미니 카드 / 페르소나 카드**: B-2 형태
```
78점          ← 메인 (기존 raw, 색상 그대로)
상위 0.1%     ← 보조 (작은 글씨, dusty 톤)
```

**A/B 비교표 신규 행 3개**:
| 항목 | A안 | B안 |
|---|---|---|
| 평균 raw 점수 (상위 50명) | 76.6 | 76.4 |
| 평균 백분위 (상위 50명) | 99.7% | 99.7% |
| core 리프트 (raw 평균 대비) | +12.5 | +12.8 |

**PopulationStatsPanel**: 분포 차트 옆에 작은 통계 박스
```
모집단 통계
mean 63.5 · std 3.9 · p50 62 · p95 70 · p99 72 · max 78
점수 ≥80: 0명 · ≥65: 162,394명
```

**검증 (PR-1 완료 후 P3 착수 전)**:
- Plan A 백테스트: 최근 20개 분석에 percentile + raw + (현재) 3가지 변환 비교. 순위 안정성·분포 폭·Known-target 통과율 측정
- Plan C 캘리브레이션: 정상/비정상 케이스의 `p99-p50`, `core_lift` 실측 → 임계값 보정

### PR-2 (P3+P4): 점수 의미 변경 — 별도 배포

#### P3 — rule_bonus 정규화 (명시 차원만 분모 + 하한값)
```python
def _rule_bonus(rows, sp) -> np.ndarray:
    specified = []  # (weight, match_array)
    if sp.target_age_min is not None or sp.target_age_max is not None:
        specified.append((0.35, age_match_arr))
    if sp.target_sex:
        specified.append((0.15, sex_match_arr))
    if sp.target_family_types:
        specified.append((0.15, family_match_arr))
    if sp.target_education_levels:
        specified.append((0.15, edu_match_arr))
    if sp.target_occupations:
        specified.append((0.20, occ_match_arr))

    if not specified:
        return np.full(len(rows), 0.5, dtype=np.float32)  # 중립
    total_w = sum(w for w, _ in specified)
    bonus = np.zeros(len(rows), dtype=np.float32)
    for w, match in specified:
        bonus += (w / total_w) * match
    # 하한 — 백테스트로 0.05/0.1/0.2 비교 후 확정 (기본 0.1)
    return np.maximum(bonus, RULE_BONUS_FLOOR)
```

**하한값 확정 절차** (Plan A 결과):
- 후보 0.05 / 0.1 / 0.2 백테스트
- 측정: `std`, `p99-p50`, Known-target(명시 타겟) 통과율, 상위 50명 중 명시 타겟 일치율
- 0.05는 분포 spread 크지만 cosine과 결합 시 비일치자 과도 push (Codex 우려)
- 0.2는 안정적이나 spread 작음
- 기본 0.1로 시작, 백테스트 결과로 조정

#### P4 — 품질 게이트 + UI 배지

**플래그 규칙** (1차 보수값):
| flag | 조건 | 의미 |
|---|---|---|
| `distribution_narrow` | `raw_p99 - raw_p50 < 3` | 변별력 부족 |
| `core_low_lift` | `core_lift < ?` (Plan C 확정) | core가 모집단 대비 거의 차이 없음 |
| `mode_inconsistent` | core/target/interest의 mode 혼재 | cohort 비교 부적합 |

**A/B 비교 전용 별도 플래그**:
| flag | 조건 | 의미 |
|---|---|---|
| `target_size_volatility` | A·B의 target absolute 크기 차이가 100배 이상 | 분포 너무 달라 직접 비교 부적합 |

UI: cohort 카드 헤더 또는 비교표 상단에 작은 배지 (`⚠️ 분포 좁음 — 점수 변별력 약함`).

## 4. 별도 트랙 (이번 범위 외, 단 우선순위 결정 필요)

| 트랙 | 영향 | 우선순위 권장 |
|---|---|---|
| **Query de-noising** | "보험" 등 도메인 공통어 제거 → 보험 종사자 과매칭 해소 | **높음** — 점수 의미 변경 전후로 효과 분리 측정 필요 (P3와 충돌 X) |
| **Category 임베딩** | persona_category_weights 변별력 회복 | 중간 — sport/arts/travel 등 카테고리별 임베딩 추가 필요 |
| **Embedding 모델 교체** | 한국어 임베딩 다양성 확보 | 낮음 — 모델 검증·튜닝 비용 큼 |

## 5. 결정 사항 / 미해결

**합의된 결정 (Round 1+2)**:
- 점수 척도 [52, 78] 문제는 표시 변환(percentile)으로 해결, raw 의미는 보존
- cohort는 raw absolute 기반 유지 (변동 signal 보존)
- 품질 게이트는 경고만, 차단 X
- 2개 PR로 단계적 배포

**남은 결정 (사용자 승인 필요)**:
- PR-1 우선 착수 승인 — UI 변경(B-2)과 PopulationStats 확장 모두 진행할지
- Plan A 백테스트 범위 — 최근 20개 분석 자동 vs 수동 sampling
- Plan D(query de-noising)를 PR-1과 병렬 진행할지 vs PR-2 이후

**보류(Deferred)**:
- `core_low_lift` 임계값 — Plan C 결과 기반 결정
- `RULE_BONUS_FLOOR` 값 — Plan A 결과 기반 결정
- 캐싱 전략 (동일 embedding 재요청) — 사용 패턴 데이터 확보 후 검토

## 6. 검증 계획 우선순위 (Codex 권장)

1. **Plan A** (백테스트) — P3 착수 전 필수. rule_bonus 하한값 + 순위 안정성 확정
2. **Plan C** (게이트 임계값) — P4 착수 전 필수
3. **Plan B** (LLM 컨텍스트 분리) — P2 이후 LLM에 percentile 추가할지 결정 시
4. **Plan D** (query de-noising) — 별도 트랙 유지

## 7. 외부 레퍼런스 (Codex 인용)

- [Mansoury et al., 2019 — Recommendation distribution flattening](https://arxiv.org/abs/1907.07766)
- [scikit-learn calibration](https://scikit-learn.org/stable/modules/calibration.html)
- [Top-N recommendation calibration, 2024](https://arxiv.org/abs/2408.11596)
- [Elastic scoring — relative score 사용 주의](https://www.elastic.co/docs/solutions/search/full-text/search-relevance/consistent-scoring)
- [Lucene scoring](https://lucene.apache.org/core/2_9_4/scoring.html)

핵심 시사점: **검색·추천 raw score는 절대 백분율로 쓰면 안 됨**. percentile/calibration은 표시 단계에서만 활용하고 raw는 cohort 컷·정렬 기준으로 보존하는 것이 모범.
