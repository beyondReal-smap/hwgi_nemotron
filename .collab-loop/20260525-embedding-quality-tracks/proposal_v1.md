# 임베딩·매칭 품질 3개 트랙 — 진단·우선순위·구현 제안 v1

> 이전 세션(점수 산출 고도화) `decision_log.md`에서 "별도 트랙 권장"으로 분리한 3개 항목을 이번 세션에서 다룬다.

## 1. 작업 목표

PR-1(percentile/raw 통계) + PR-2(rule_bonus 정규화) 적용 후 남은 임베딩·매칭 품질 이슈 3개:
1. **Query stop-list 확장** — "무직/화물차" 같은 비자연스러워 보이는 매칭의 추가 stop 단어 검토
2. **Category 임베딩 도입** — 현재 `category_bonus`의 변별력 회복
3. **임베딩 모델 교체** — 한국어 cosine [0.7, 0.95] 좁은 분포 근본 해결 시도

각 트랙을 진단·비용·기대효과로 평가하고 진행 우선순위를 확정하는 것이 이 문서의 목표.

## 2. 진단 (실측 데이터 기반)

### 2-1. 페르소나 카테고리 컬럼 분포 — **현재 `category_bonus`가 사실상 상수**

| 컬럼 | 비어있지 않은 비율 |
|---|---|
| professional_persona | 100.0% |
| sports_persona | 100.0% |
| arts_persona | 100.0% |
| travel_persona | 100.0% |
| culinary_persona | 100.0% |
| family_persona | 100.0% |

**결정적 발견**: `_category_bonus`(`scoring.py:163-174`)는 "카테고리 컬럼이 비어있지 않으면 가중치 부여" 로직인데, 모든 컬럼이 100% 채워져 있어 **모든 페르소나에게 동일하게 `sum(weights.values()) = 1.0` 부여**. 즉 `persona_category_weights` 입력이 점수에 **아무 영향도 안 미침**.

`W_CATEGORY = 0.1`로 가중치 10%를 할당했지만 실제 변별력 0. 의도된 카테고리 시그널이 통째로 사라진 상태.

### 2-2. "무직" 페르소나 매칭의 실체 — **stop-list 문제가 아닌 라벨 표시 문제**

최근 3개 분석 상위 50명 중 "무직"이 6~9명 등장. 페르소나 텍스트 확인 결과:

| 페르소나 (점수) | 텍스트 발췌 |
|---|---|
| 여자 35세 경기 무직 (77점) | "화성시 단독주택에서 완벽한 정리 정돈과 체계적인 일상을 추구하며, 미식 여행과 주거 환경 컨설팅이라는 꿈을 조용히 키워가는 **35세 주부**" |
| 여자 31세 경기 무직 (78점) | "분당의 아파트에서 **육아**하며 미래의 사회복지사 복귀를 꿈꾸는, 활동적이고 현실적인 31세 여성" |

→ **"무직"은 임베딩이 잘못 매칭한 게 아니라 한국 통계청 KSCO 직업 분류상 "무직" = 전업주부·가사 종사자**. "30대 여성 결혼·출산기" 안의 정확한 타겟. 사용자가 어색하게 느낀 건 **`occupation` 라벨 표시 방식의 UX 문제**이지 매칭 알고리즘 문제가 아님.

따라서 **Track 1 (stop-list 확장)은 효과 매우 낮음**. "결혼/출산/육아/가정" 같은 단어를 추가로 제거하면 정확한 의미 매칭까지 깨짐.

### 2-3. 한국어 임베딩 cosine 분포 한계 (이전 세션 진단 재확인)

- text-embedding-3-small: cosine [0.7, 0.95], raw score 분포 [52, 78]
- 이전 PR-2(rule_bonus 정규화)로 spread를 ~2배 확장했지만, **임베딩 cosine 자체의 좁음**은 그대로
- 모델 교체로 얼마나 개선될지 불확실

### 2-4. 임베딩 비용

| 항목 | 비용 추정 |
|---|---|
| text-embedding-3-small (현재) — 1M 페르소나 | ~$2 (이미 지불) |
| text-embedding-3-large로 100만 교체 | ~$13 |
| Category 임베딩 6개 컬럼 추가 (small) | ~$12 |
| Category 임베딩 6개 컬럼 추가 (large) | ~$78 |

**절대값 모두 작음**. 비용은 결정 요인 아님.

## 3. 트랙별 평가

### Track 1 — Query stop-list 확장

| | |
|---|---|
| **진단 결과** | 효과 매우 낮음. "무직" 매칭은 정확함 (UX 라벨 문제) |
| **추가 후보 단어** | 거의 없음. 남은 query 단어는 대부분 의미 핵심 |
| **권장** | **보류** (단, 명확히 노이즈인 단어 발견 시 단발성 추가) |

#### Track 1' (신규) — UX 라벨 보강 (occupation 표시 개선)

| | |
|---|---|
| **문제** | "무직" 라벨이 한국어 일상에서 부정 뉘앙스, 실제로는 전업주부도 포함 |
| **해법** | 카드 표시 시 `family_type` + `occupation` 결합 추론 — 예: "무직" + "배우자·자녀와 거주" → "전업주부 (가사·양육)" 보조 표시 |
| **비용** | 작음 (UI 표시 로직만 변경, 데이터 불변) |
| **권장** | **소형 PR로 진행** (Track 2 작업과 병렬 가능) |

### Track 2 — Category 임베딩 도입

| | |
|---|---|
| **현재 문제** | `category_bonus`가 모든 페르소나에 상수(가중치 합) → `persona_category_weights` 입력이 점수에 **무영향**. W_CATEGORY=0.1이 통째 죽음 |
| **변경안** | 카테고리별 페르소나 텍스트(family_persona 등)를 사전 임베딩 → query 임베딩과 카테고리별 cosine → `persona_category_weights`로 가중합 |
| **기대 효과** | (1) family=0.9 안은 family_persona가 매칭에 강하게 작동 → 상위 페르소나가 가족 중심으로 정렬 (2) professional=0.7 안은 professional_persona 강조 (3) **A·B 안의 카테고리 가중치 차이가 실제 매칭 결과 차이로 나타남** |
| **비용** | $12 (small) / $78 (large), 1회 사전계산 |
| **저장소 영향** | 카테고리 임베딩 6개 × 100만 × 1536 dim × 4byte = 35GB (small). 현재 1M 임베딩 5.8GB와 비교 시 큼. 디스크/RAM 영향 검토 필요 |
| **권장** | **★★★★★ 1순위** |

#### 구현 옵션

| 안 | 설명 | 장단점 |
|---|---|---|
| 2-A | 카테고리별 별도 임베딩 배열 6개 (full) | 변별력 최대, 35GB 추가 |
| 2-B | 카테고리별 임베딩을 평균하여 단일 카테고리 벡터 (가중치 합산) | 5.8GB 추가만, 변별력 일부 손실 |
| 2-C | 카테고리 임베딩 대신 카테고리 토큰을 query에 가중치 비례 prepend (예: family=0.9면 "가족 가족 가족 ...") | 데이터 변경 0, 효과 제한 |

**1차 권장: 2-A (full)** — 변별력 최대. 디스크 35GB가 부담이면 2-B로 다운그레이드.

### Track 3 — 임베딩 모델 교체

| | |
|---|---|
| **현재** | text-embedding-3-small (1536 dim, OpenAI) |
| **후보 1** | text-embedding-3-large (3072 dim, OpenAI). 변별력 일반적으로 ↑, 한국어 특화 X |
| **후보 2** | BAAI/bge-m3 (1024 dim, multilingual, self-hosted). 한국어 양호 |
| **후보 3** | intfloat/multilingual-e5-large (1024 dim, self-hosted). 한국어 양호, MTEB 상위 |
| **후보 4** | jhgan/ko-sroberta-multitask (768 dim, 한국어 특화) |
| **검증 비용** | 1만 행 샘플로 4모델 비교 (cosine 분포, top-50 일치율) ~ $1 + GPU 시간 |
| **마이그레이션 비용** | 선택 모델로 100만 행 재계산 ($13~$78 또는 GPU 시간 수십 분~수 시간) |
| **위험** | 모델 교체 후 cosine 분포가 더 나빠질 수도 (예: e5-large는 query/passage 구분 필요) |
| **권장** | **★★ 3순위** — Track 2 효과 측정 후 진행 결정 |

## 4. 권장 진행 우선순위

| 순위 | 트랙 | 이유 | 작업 규모 |
|---|---|---|---|
| **1** | **Track 2 (Category 임베딩)** | 데이터로 무용지물 확인됨, 효과 큼, 비용 작음 | 중 (3~5시간) |
| **2** | **Track 1' (UX 라벨 보강)** | cheap, 사용자 직감 해소, Track 2와 병렬 | 소 (30분) |
| **3** | **Track 3 (모델 교체)** | Track 2 효과 측정 후 추가 개선 필요 시 | 대 (1~2일) |
| 보류 | Track 1 (stop-list 확장) | 데이터로 효과 낮음 확인됨 | — |

## 5. Track 2 (Category 임베딩) 상세 계획

### 5-1. 데이터 파이프라인

```
1. 6개 카테고리 컬럼 텍스트 → 임베딩 사전계산 (1회)
   - data/category_embeddings_1m_v1.npy (6 × 1M × 1536 × 4 = 35GB)
   - 또는 컬럼별 6개 파일로 분리 (디스크 mmap 효율)

2. PersonaStore에 카테고리 임베딩 로드 (mmap)

3. score_all_personas에서:
   query_vec → category별 cosine 6개
   weighted_cat_sim = Σ (persona_category_weights[cat] * cosine_cat)
   combined = W_COSINE * cosine_main + W_RULE * rule + W_CATEGORY * weighted_cat_sim
```

### 5-2. 결합식 변경 가능성

현재: `0.7 cosine + 0.2 rule + 0.1 cat_bonus(상수)`

3안:
| 안 | 결합식 | 의도 |
|---|---|---|
| A | `0.7 cosine_main + 0.2 rule + 0.1 cat_sim` (기존 가중치 유지) | 안전. cat 비중 그대로 |
| B | `0.5 cosine_main + 0.2 rule + 0.3 cat_sim` (cat 비중 증가) | 카테고리 시그널 강조 |
| C | `0.6 cosine_main + 0.2 rule + 0.2 cat_sim` (중간) | 균형 |

→ 백테스트로 결정. baseline = 안 A, 비교 = 안 B/C.

### 5-3. 검증 계획

1. 1만 행 샘플로 사전계산 → 안 A/B/C 점수 분포 비교
2. 안마다(family=0.9 / professional=0.7 등) 상위 페르소나 카테고리 텍스트 일치 정도 확인
3. 분포 spread, top-50 평균/타겟 일치율, family vs professional 분기 효과

## 6. 미해결 / 토론 대상

1. **Track 2 디스크 35GB** — mmap 효율, 인프라 영향, 압축(float16) 가능성
2. **결합식 가중치 (안 A/B/C)** — 백테스트 전 직관적 권장은?
3. **카테고리 임베딩 1차 모델** — 메인 임베딩과 같은 small? large로 카테고리만 업그레이드?
4. **Track 1' UX 라벨** — "무직"을 어떻게 표시할지 (자동 추론 vs 단순 "무직(주부 포함)" 보조어)
5. **Track 3 모델 교체** — Track 2 후 측정 기준 (Re cosine spread, top-50 일치율, 분포 펴짐 정도)
6. **우리가 빠뜨린 더 좋은 안** — 예: query-side multi-vector(소구점별 임베딩 분리 후 max/sum pool), learned re-ranker 등

---

**다음 단계**: 이 문서를 Codex에게 critique 의뢰. 특히 (a) Track 2의 35GB 디스크 부담과 mmap 안정성, (b) 결합식 가중치 변경 위험, (c) Track 3 모델 후보 비교 데이터 기반 평가, (d) "무직" 매칭의 진짜 본질에 대한 검증.
