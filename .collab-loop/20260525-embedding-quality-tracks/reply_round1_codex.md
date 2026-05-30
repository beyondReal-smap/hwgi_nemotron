[Summary]
- Track 2가 1순위라는 결론은 맞지만, “full 6개 카테고리 임베딩 즉시 도입”은 과합니다. 먼저 `float16 + 상위 N개 카테고리 + 10만 샘플`로 효과를 검증해야 합니다.

[Findings]
- `category_bonus` 무용지물 진단은 정확합니다. 6개 카테고리 컬럼 모두 non-empty 100%라 현재 로직은 거의 상수입니다.
- 다만 `embeddings_1m_v2.npy`는 `scripts/embed_personas.py`의 `combined` 모드 산출물이라 이미 `family_persona`, `professional_persona` 등 카테고리 텍스트가 메인 임베딩에 들어갑니다. 손실은 “카테고리 정보 부재”가 아니라 “카테고리별 가중 제어 부재”입니다.
- 35GB 증분은 운영상 가볍지 않습니다. 현재 `data/`는 약 14GB, 메인 임베딩은 6.14GB입니다. 카테고리 6개 `float32`는 약 36.9GB 추가, `float16`은 약 18.4GB 추가입니다.
- `float16`은 유력합니다. 기존 메인 임베딩 10만 샘플에서 `float32` 대비 평균 오차 `4.6e-6`, top50/top100 overlap 100%, top1000 overlap 99.9%였습니다. 단, 실제 카테고리 임베딩으로 재검증해야 합니다.
- 결합식은 안 A부터 시작해야 합니다. `0.5/0.2/0.3`은 LLM이 추정한 `persona_category_weights`를 30% 신뢰하는 설계인데, 현재 그 추정 정확도 검증이 없습니다. 카테고리별 cosine 분포도 서로 다를 수 있어 raw cosine을 바로 가중합하면 특정 컬럼 편향이 생깁니다.
- “무직 = 전업주부” 단정은 약합니다. 로컬 100만 행 기준 `무직`은 36.7%이고, 그중 은퇴 키워드 15.4%, 가사 14.9%, 주부 8.2%입니다. 30대 여성 무직만 보면 주부 35.8%, 배우자있음 61.3%라 UX 보강은 타당하지만, 무조건 “전업주부”로 바꾸면 오표시가 납니다.
- Track 3의 목표를 “cosine spread 확대”로 잡으면 위험합니다. `multilingual-e5-large` 모델 카드는 cosine이 0.7~1.0에 몰리는 것이 학습 특성상 정상이며, 절대값보다 순위가 중요하다고 명시합니다. 즉 모델 교체 평가는 spread가 아니라 top-k 품질, known-target, A/B 분기력으로 봐야 합니다. 참고: [E5 모델 카드](https://huggingface.co/intfloat/multilingual-e5-large)
- 빠뜨린 단기안은 query-side multi-vector입니다. 데이터 재생성 없이 `summary`, `key_benefits`, `target_keywords`를 따로 임베딩해 max/weighted pooling을 실험할 수 있어 Track 2 pilot과 같이 넣을 가치가 큽니다.

[Disposition Hint]
- Track 2: 진행. 단, 2-A full이 아니라 `10만 샘플 → float16 → 상위 1~2개 카테고리만 계산 → 안 A/C 비교`로 시작합니다.
- Track 1': 진행. “무직(주부 포함)” 같은 일괄 라벨보다 `persona` 텍스트·가구·혼인·연령 기반 보조 라벨이 안전합니다.
- Track 1 stop-list 확장: 보류. `화물차`, `무직` 같은 단어를 stop 처리하면 실제 타겟 신호를 삭제할 가능성이 큽니다.
- Track 3: 보류. Track 2와 query multi-vector 후에도 known-target 또는 사용자 체감 문제가 남을 때 비교 실험으로 진행합니다.
- 추가 후보: BGE-M3는 dense/sparse/multi-vector와 hybrid retrieval + reranking을 공식 권장하므로, 모델 교체보다 “hybrid retrieval 실험” 후보로 보는 편이 낫습니다. 참고: [BGE-M3 모델 카드](https://huggingface.co/BAAI/bge-m3)

[Open Questions]
- 카테고리 가중치 검증: 11개 known-target에 “기대 dominant category”를 수작업 라벨링하고, one-hot category override 시 top50이 의도대로 이동하는지 봅니다.
- 카테고리 cosine 정규화: 컬럼별 p50/p95/p99를 측정해 raw cosine 대신 percentile 또는 z-score 정규화를 검토해야 합니다.
- 모델 비교 기준: `text-embedding-3-large`, BGE-M3, multilingual-e5-large는 cosine 분포가 아니라 top50 정답률, counterfactual 분기력, 지역/직업 hard case 재현율로 비교합니다. OpenAI는 `large`가 MIRACL/MTEB 평균에서 `small`보다 높고 dimension 단축도 지원합니다. 참고: [OpenAI embedding update](https://openai.com/index/new-embedding-models-and-api-updates/)
- 저장소 전략: full 6개 파일을 만들더라도 요청 시 모든 카테고리를 매번 dot 하지 말고, weight 상위 카테고리만 lazy mmap으로 읽는 구조가 더 합리적입니다.