[Summary]
- 대표님, A+E는 유지하되 “백분위 표시 + raw 품질 게이트 + raw 비교 지표”로 수정해야 하며, 코호트를 순위만으로 일원화하는 것은 반대입니다.

[Findings]
- **P1 — raw 메타만으로 A/B 비교 보완은 부족합니다.** 현재 `PopulationStats`에는 전체 raw 평균·표준편차가 없고(`apps/api/models/schemas.py:199-230`), A/B 비교도 상위 페르소나 평균만 봅니다(`apps/api/services/comparison.py:224-240`); `raw_mean`, `raw_std`, `p95/p99`, `fixed_threshold_coverage`, `core_lift`를 스키마에 추가해야 합니다.
- **P1 — 순위 기반 코호트 일원화는 규모 신호를 제거합니다.** 최근 5건에서도 target이 absolute 525명, 718명, 38,514명처럼 변동하는 신호가 있는데, 상위 5% 고정으로 바꾸면 `core_size`, `target_size` 비교가 항상 동률이 됩니다(`apps/api/services/comparison.py:242-263`).
- **P1 — 백분위 점수를 기존 `score`에 덮어쓰면 LLM 의견·UI 톤이 깨집니다.** `opinions.py`는 80/65/40 컷으로 “매우 높음/높음”을 판단하고(`apps/api/services/opinions.py:128-147`), 프런트도 같은 컷으로 색상을 정합니다(`apps/web/components/PersonaList.tsx:72-77`).
- **P1 — 품질 실패 감지 안전망은 필요합니다.** 모든 점수가 75~80에 몰리는 케이스에서는 상위 0.5%가 “핵심 타겟”이라는 말만 유지되고 실제 분리도는 약할 수 있으므로 `p99-p50`, `core_avg-global_avg`, `core_avg-target_avg`, `target-dimension hit rate`를 품질 게이트로 둬야 합니다.
- **P2 — `rule_bonus` 음수 페널티는 과합니다.** 현재 미명시 차원을 만점 처리하는 문제(`apps/api/services/scoring.py:57-110`)는 맞지만, 음수 페널티보다 “명시된 차원만 분모로 정규화 + 하한값”이 안정적입니다.
- **P2 — `category_bonus`는 사실상 상수에 가깝습니다.** 현재는 카테고리 컬럼이 비어 있지 않으면 가중치가 붙는 구조라 변별력이 약합니다(`apps/api/services/scoring.py:129-152`); 제거하거나 카테고리별 임베딩으로 대체해야 합니다.
- **P2 — query 텍스트가 보험 직업군을 과매칭할 가능성이 큽니다.** `summary + key_benefits + target_keywords` 단순 결합(`apps/api/services/scoring.py:40-43`) 때문에 상위 페르소나에 보험 관리자·보험 비서·보험 사무원이 반복되며, 구매 타겟이 아니라 “보험이라는 단어와 가까운 사람”을 뽑는 아티팩트가 생깁니다.

[Disposition Hint]
- **종합**: 권장안 A+E는 “수정 채택”입니다. `score`는 raw로 보존하고, `display_score` 또는 `percentile_score`를 별도 필드로 추가해야 합니다.
- **A 백분위**: 표시용으로 채택합니다. 단, 라벨은 “85점”보다 “상위 15%”가 안전합니다.
- **B T-score**: 전문가용 분포 차트에는 유용하지만 사용자 메인 점수로는 정규성 가정이 약합니다.
- **C 곱셈 결합**: 보류합니다. 검증 없이 적용하면 파라미터 튜닝 문제가 커집니다.
- **D 가산식 재조정**: 일부 채택 가능합니다. 다만 고정 매핑보다 기준 분석군 기반 보정이 낫습니다.
- **E 이중 노출**: 채택합니다. 다만 raw 평균/std만이 아니라 고정 raw 컷 인원, lift, 분위수 요약까지 필요합니다.

[Open Questions]
- 최근 20개 분석에 대해 `raw`, `percentile`, `T-score`, `specified-rule-normalized`를 재계산해 순위 안정성·분포 폭·Known-target 통과율을 비교해야 합니다.
- `display_score`를 LLM 프롬프트에 넣을지, raw 점수만 넣을지 분리 실험이 필요합니다.
- 코호트 품질 게이트 임계값은 `p99-p50 < 3`, `core_avg-global_avg < 2` 같은 후보를 두고 cb6ef5fd류 케이스로 검증해야 합니다.
- query de-noising 실험이 필요합니다: “보험/진단비/월 보험료” 같은 도메인 공통어 제거 전후로 보험 직업군 과대표집이 줄어드는지 봐야 합니다.
- 외부 근거상 백분위 변환은 추천 분포 평탄화에 효과가 있지만([Mansoury et al., 2019](https://arxiv.org/abs/1907.07766)), 확률적 의미를 주려면 별도 캘리브레이션이 필요합니다([scikit-learn calibration](https://scikit-learn.org/stable/modules/calibration.html), [Top-N recommendation calibration](https://arxiv.org/abs/2408.11596)). 검색 점수도 쿼리·인덱스 통계에 의존하므로 raw relevance score를 절대 퍼센트처럼 쓰면 안 됩니다([Elastic scoring](https://www.elastic.co/docs/solutions/search/full-text/search-relevance/consistent-scoring), [Lucene scoring](https://lucene.apache.org/core/2_9_4/scoring.html)).