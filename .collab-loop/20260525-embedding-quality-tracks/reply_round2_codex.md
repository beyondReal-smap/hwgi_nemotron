대표님, 아래가 Round 2 응답입니다.

[Summary]
- v2는 진행 가능합니다. 단, Track 4는 `max pool`을 후보 확장용, `weighted sum`을 최종 랭킹용으로 두고, Track 2는 분포 측정 후 `z-score` 기본값으로 가는 안을 권장합니다.

[Findings]
- 쟁점 A: A-1 vs A-2 비교면 1차 실험은 충분합니다. 보험 도메인은 “여성 + 결혼·출산기 + 보장금액”처럼 여러 축이 함께 맞아야 하므로 최종 점수는 `weighted sum`이 더 직관적입니다. `max pool`은 한 축 노이즈에 취약하지만 좋은 후보를 놓치지 않는 장점이 있으니, 후보군 생성에는 `max`, 최종 정렬에는 `weighted sum`을 쓰는 2단계가 가장 안전합니다. A-3는 이번 pilot 범위 밖입니다.
- 쟁점 B: 데이터 분포를 먼저 봐야 하지만, 운영 후보는 `raw cosine`보다 `z-score`가 낫습니다. LLM 가중치는 컬럼 간 cosine 평균·분산 차이를 고려하지 않기 때문에 raw 가중합은 LLM 의도와 어긋날 수 있습니다. `percentile rank`는 사전계산 가능하지만 pilot 1차 기본값으로는 과합니다.
- 쟁점 C: 11개 known-target은 통계 검증으로는 부족하지만 회귀 방지용 골든셋으로는 충분합니다. 별도로 카테고리 스트레스셋을 12~24개 추가하는 것이 좋습니다. 임계값은 `top1 dominant category 일치율 >= 80%`, `top2 포함률 >= 90%`를 권장합니다. LLM 가중치는 그대로 쓰지 말고 `clip + temperature`로 극단값을 완화해야 합니다.
- 쟁점 D: known-target은 현재 100%이므로 pilot도 22/22 체크 회귀 0을 gate로 두는 게 맞습니다. 다만 “family_persona 텍스트 길이 p90 이상”은 좋은 지표가 아닙니다. 길이 대신 one-hot override 시 해당 카테고리의 정규화 cosine 평균 또는 percentile이 baseline 대비 유의하게 상승하는지 봐야 합니다. 평균 점수 ±2점도 핵심 gate가 아니라 UI 점수 보정 참고값으로만 두는 게 맞습니다.
- 쟁점 E: 병렬 준비, 순차 판정이 최선입니다. Track 2 임베딩 생성은 Track 4 실험과 병렬로 진행하되, 측정은 `baseline`, `Track 4 only`, `Track 2 only`, `Track 4 + Track 2` 4개 셀로 분리해야 효과가 섞이지 않습니다.

[Disposition Hint]
- A: 수정 제안. `max 후보 생성 + weighted 최종 랭킹`.
- B: 수정 제안. `raw 분포 측정`, `z-score 기본`, `percentile 보류`.
- C: 수정 제안. 11개만으로 결정하지 말고 카테고리 스트레스셋 추가.
- D: 수정 제안. 길이·평균점수보다 정규화 category lift, 회귀 0, 분기력 중심.
- E: 합의 가능. 병렬 준비 + 4셀 분리 측정이면 진행 가능.
- v2 전체는 진행 가능합니다. 구현 착수 전 평가 스크립트와 feature flag를 먼저 고정해야 합니다.

[Open Questions]
- 실험 우선순위 1: Track 4 `concat baseline` vs `weighted final` vs `max candidate + weighted final`.
- 실험 우선순위 2: Track 2 카테고리별 cosine `p50/p90/p95/std` 측정 후 raw/z-score 비교.
- 실험 우선순위 3: category stress set 12~24개 작성 후 LLM 가중치 top1/top2 정확도 측정.
- 추가 리스크: query multi-vector 캐시 키에 `schema_version`, `pool_method`, `embedding_model`, 축별 텍스트 해시를 포함해야 합니다.
- 추가 리스크: “무직(주부/육아 추정)” 같은 표시용 라벨은 리포트 생성 LLM 입력에 넣지 말고, 원본 occupation과 display label을 분리해야 합니다.