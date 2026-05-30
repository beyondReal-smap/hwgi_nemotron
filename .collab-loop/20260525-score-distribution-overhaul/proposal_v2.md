# 점수 산출·대상자 확정 로직 고도화 제안 v2

> v1 → v2: Codex Round 1 critique 반영. 핵심 변화: ① score 필드 raw 보존, ② cohort 일원화 폐기(raw 분포 변동 signal 보존), ③ 종합 통계 + 품질 게이트 추가, ④ rule_bonus 페널티화 폐기 → 정규화 방식, ⑤ query de-noising은 별도 실험.

## 1. 토론 상태표 (Round 1 결과)

| # | 쟁점 | v1 (Claude) | Codex critique | 상태 | v2 조치 |
|---|------|---------|---------|------|---------|
| 1 | score 필드 처리 | `display_score`로 백분위 노출 | **raw score 보존** 필수 — opinions.py:128-143와 PersonaList.tsx:72-77이 80/65/40 컷 사용. 덮으면 LLM 톤·UI 색상 모두 깨짐 | 합의 | `score`=raw 유지, `percentile_score` 별도 필드 추가 |
| 2 | cohort 순위 일원화 | percentile 5%/0.5%로 단순화 | **반대** — target이 525/718/38,514명처럼 변동하는 것 자체가 raw 분포 차이의 핵심 signal. 일원화하면 항상 동률 | 합의 | 현재 absolute 우선 + 폴백 로직 유지. cohort는 raw 기반 |
| 3 | raw 메타 노출 범위 | raw 평균/std만 추가 | **확장 필요** — `raw_mean`, `raw_std`, `p50/p95/p99`, `fixed_threshold_coverage` (점수 ≥80/65 인원), `core_lift` (core_avg − global_avg) | 합의 | PopulationStats 확장 |
| 4 | 품질 게이트 | 미고려 | **필요** — 분포 비정상 케이스(cb6ef5fd처럼 모두 75~80 몰림) 감지. `p99-p50 < 3`, `core_avg-global_avg < 2` 등 | 합의 | quality_flags 필드 추가 |
| 5 | rule_bonus 페널티화 | 음수 페널티(-0.1) 제안 | **과함** — "명시 차원만 분모 정규화 + 하한값"이 안정 | 합의 | 정규화 방식으로 변경 |
| 6 | category_bonus 처리 | 약함 인지 | **상수에 가까움** — 제거 또는 카테고리별 임베딩 필요 | 부분 합의 | 별도 PR로 분리 (이번 범위 외) |
| 7 | query 텍스트 노이즈 | 진단 누락 | **새 발견** — "보험"이 query에 들어가 보험 종사자(보험 관리자/사무원) 직업군 과매칭. 실제 상위 페르소나 데이터에서 확인됨 | 합의 | de-noising 실험 별도 진행 (이번 v2 범위 외, 별도 트랙) |
| 8 | 외부 레퍼런스 | 미인용 | Mansoury 2019(평탄화 효과), scikit-learn calibration, Lucene scoring(상대 점수 사용 주의) 인용 | 합의 | 검증 계획에 반영 |

미합의 0건. v2는 위 합의대로 정리.

## 2. 진단 (v1 그대로 유지, 데이터로 강화)

- 실측 분포: range **[52, 78]** / 평균 63~67 / std 3.7~4.1 / p99 72
- 원인 3가지: (i) 한국어 임베딩 cosine [0.7, 0.95] 좁음, (ii) 가산식 평탄화, (iii) rule_bonus 미명시 차원 만점 처리
- **추가 발견 (Codex)**: query="...보험..." 때문에 보험 직업군 과매칭 — `ec0abe86` A의 핵심 타겟 페르소나 5명 중 "보험 관리자" "보험 상품 개발자" 포함 (보험 도메인 시스템에서 보험 종사자가 타겟이 아닌데도 자꾸 잡힘)

## 3. 권장안 v2 — 4단계 변경

### 단계 1: score 이중 노출 — `score`(raw) 보존 + `percentile_score` 추가 [핵심]

**의도**: raw score는 절대 매력도(LLM 톤·UI 색상의 기준)로 보존. percentile_score는 사용자 친화적 표시("상위 N%")로 추가.

**구현**:
```python
# scoring.py
def to_percentile(raw_scores: np.ndarray) -> np.ndarray:
    """raw → 모집단 백분위 (높을수록 100). 동률은 평균 순위로."""
    from scipy.stats import rankdata
    ranks = rankdata(-raw_scores, method='average')
    return (1 - ranks / len(raw_scores)) * 100
```

**스키마 변경** (`models/schemas.py`):
```python
class PersonaHit(BaseModel):
    score: float          # raw, 기존 그대로
    percentile_score: float  # 신규: 0~100, 모집단 내 백분위 (균등 분포)
    ...
```

**UI 라벨링**:
- 카드 메인 숫자: **raw score** (기존 컬러링 유지)
- 보조 라벨: "**상위 X%**" (percentile 기반)
- 예: `78점 · 상위 0.1%` ← raw 78점이 무엇을 의미하는지 즉시 해석 가능

### 단계 2: PopulationStats 확장 — raw 분포 통계 종합

**현재**: `total_scored`, `cohorts`, `score_distribution`, `demographics`, `districts_full`
**추가**:
```python
class PopulationStats(BaseModel):
    ...
    raw_mean: float          # 전체 모집단 raw 평균
    raw_std: float           # 전체 std
    raw_p50: float           # 중위
    raw_p95: float
    raw_p99: float
    raw_max: float
    # 고정 임계값 통과 인원 (안 간 비교용)
    n_above_80: int          # raw ≥80
    n_above_65: int          # raw ≥65
    # cohort lift (core_avg가 모집단 평균 대비 얼마나 높은가)
    core_lift: float         # core.avg_score - raw_mean
    target_lift: float
    # 품질 플래그 (단계 4)
    quality_flags: list[str] # ["distribution_narrow", "core_low_lift", ...]
```

### 단계 3: rule_bonus 정규화 — 명시 차원만 분모 사용 + 하한값

**현재 문제**: 미명시 차원은 모든 페르소나에 만점 부여 → 분포 평탄화에 일조.

**변경**:
```python
def _rule_bonus(rows, sp) -> np.ndarray:
    """명시 차원만으로 정규화. 미명시 차원은 분모에서 제외.
    명시 차원 0개면 모두 0.5 (중립값).
    """
    specified = []  # (weight, match_array)
    if sp.target_age_min is not None or sp.target_age_max is not None:
        specified.append((0.35, age_match_array))
    if sp.target_sex:
        specified.append((0.15, sex_match_array))
    # ... 가구형태/학력/직업도 동일하게

    if not specified:
        return np.full(len(rows), 0.5, dtype=np.float32)  # 중립
    total_weight = sum(w for w, _ in specified)
    bonus = np.zeros(len(rows), dtype=np.float32)
    for w, match in specified:
        bonus += (w / total_weight) * match
    # 하한 0.1: 완전 미일치자도 cosine + cat로 살아남게 (Codex 권장)
    return np.maximum(bonus, 0.1)
```

**효과**:
- 명시 차원 일치자 = 1.0, 비일치자 = 0.1 → spread 확장
- 미명시 차원은 점수에 영향 없음 → "타겟을 명확히 한 안일수록 분포가 spread"
- 음수 페널티의 부작용(점수 음수 클립) 없음

### 단계 4: 품질 게이트 — 분포 비정상 감지

**의도**: cb6ef5fd 같은 케이스(모든 점수 75~80 동률 몰림)에서 cohort의 의미가 약화됨. 자동 감지 + 경고.

**플래그 규칙**:
| flag | 조건 | 의미 |
|---|---|---|
| `distribution_narrow` | `raw_p99 - raw_p50 < 3` | 변별력 부족 (분포 너무 좁음) |
| `core_low_lift` | `core_lift < 2.0` | 핵심 cohort가 모집단 대비 거의 차이 없음 |
| `mode_inconsistent` | core/target/interest의 mode가 섞임 | cohort 비교 부적합 |
| `query_domain_overmatch` | (장기) 상위 페르소나의 직업 분포가 query 키워드 직업과 비정상 일치 | query 노이즈 의심 |

UI 표시: cohort 카드 상단에 경고 배지 (`⚠️ 분포 좁음 — 점수 변별력 약함`)

## 4. 검증 계획 (Codex 제안 반영)

### Plan A: 백테스트
- 최근 20개 분석에 대해 4가지 변환(raw / percentile / T-score / specified-rule-normalized)을 각각 계산
- **지표 1**: 순위 안정성 — 상위 100명 페르소나가 변환 간에 얼마나 일치하는가 (rank correlation)
- **지표 2**: 분포 폭 — IQR, p99-p50, std
- **지표 3**: Known-target 통과율 — sp.target_sex/age 명시 시 상위 100명 중 일치 비율

### Plan B: LLM 컨텍스트 분리 실험
- raw score만 LLM에 전달 vs raw + percentile 둘 다 vs percentile만
- LLM 의견 톤 일관성, hallucination 비율, 사용자 평가

### Plan C: 품질 게이트 임계값 캘리브레이션
- 후보값: `p99-p50 < 3` vs `< 5`, `core_lift < 2` vs `< 3`
- cb6ef5fd / ec0abe86 / 20f5786a 등으로 실측 → "정상 분포는 통과, 비정상은 잡힌다" 임계 결정

### Plan D (별도 트랙): query de-noising
- 도메인 공통어(보험·진단비·월·보험료·보장·보험금·진단·치료 등) 제거 stop-list
- 상위 페르소나 직업 분포 비교: stop-list 적용 전후로 보험 종사자 비율 변화 측정
- 이번 v2 범위 외, 별도 PR

## 5. 단계별 적용 계획 (한 번에 가지 않음)

| 단계 | 변경 | 범위 | 위험도 | 검증 |
|---|---|---|---|---|
| **P0** | `PersonaHit.percentile_score` 필드 추가만, UI는 raw만 표시 | scoring.py + schema | 낮음 | API 응답에 새 필드 포함되는지만 확인 |
| **P1** | `PopulationStats` 확장 (raw 통계 + cohort_lift) | scoring.py + schema | 낮음 | 기존 API 응답 모양 깨지지 않는지 |
| **P2** | UI에 "상위 X%" 보조 라벨 + 비교표에 raw 평균/lift 추가 | 프론트 + comparison.py | 중간 | 카드 시각적 검증 |
| **P3** | rule_bonus 정규화 방식 변경 | scoring.py | 중간 | 백테스트 (Plan A) — 분포 spread 변화 |
| **P4** | 품질 게이트 + UI 배지 | scoring.py + UI | 낮음 | 분포 좁은 분석에 배지 뜨는지 |
| **P5** (별도) | category_bonus 처리 | scoring.py | 중간 | 별도 검토 |
| **P6** (별도) | query de-noising | scoring.py + 실험 | 높음 | Plan D |

## 6. 미해결 (Round 2 토론 대상)

1. **percentile_score의 계산 시점**: 100만 행 전체 rank 계산 시 메모리/시간 비용. `np.argsort` 두 번이면 O(N log N), 100만 행에 약 0.1초 — OK?
2. **UI 점수 표기 형태**: `78점 · 상위 0.1%` 두 줄? 또는 `78점 (상위 0.1%)` 한 줄? 또는 toggle?
3. **품질 게이트 임계값**: `p99-p50<3` 같은 휴리스틱이 실측 케이스에 맞는지 (Plan C 결과 기반 결정)
4. **rule_bonus 하한값 0.1**: 적정한가? 0.05? 0.2? 백테스트로 결정
5. **단계별 적용 순서**: P0~P4 한 PR로 vs 분리? 분리 시 의존성?
