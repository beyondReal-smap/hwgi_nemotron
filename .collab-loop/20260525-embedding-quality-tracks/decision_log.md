# Decision Log — 임베딩·매칭 품질 트랙

## 세션 메타
- 시작: 2026-05-25
- 호스트: Claude (Opus 4.7)
- 토론 상대: Codex (codex-cli 0.133.0)
- 라운드: 2회 (미합의 0건으로 종료)
- 최종 산출물: `proposal_v3_final.md`

## 라운드 산출물
- `proposal_v1.md` — Claude 초안 (3개 트랙 진단·우선순위)
- `packet_round1.md` → `reply_round1_codex.md` — Codex critique (8건 합의 + 신규 1건)
- `proposal_v2.md` — v1 → v2 (큰 수정: 진단 재정의 + Track 4 신규)
- `packet_round2.md` → `reply_round2_codex.md` — Round 2 디테일 합의
- `proposal_v3_final.md` — v3 최종본

## 핵심 변경 (v1 → v3)

| 항목 | v1 | v3 | 변경 사유 (Codex critique) |
|---|---|---|---|
| Track 2 진단 | "카테고리 정보 부재" | **"가중 제어 부재"** | `embeddings_1m_v2.npy`가 combined 모드 (`scripts/embed_personas.py:15`)라 카테고리 텍스트 이미 포함 |
| Track 2 도입 방식 | 2-A full (6 컬럼 × 1M, 35GB) 즉시 | **pilot** (10만 샘플, float16, family 1개 우선) | 효과 미지수 → 작게 시작 |
| Track 2 정규화 | 미고려 | **z-score 기본** | 컬럼별 cosine 분포 차이가 LLM 의도 왜곡 가능 |
| 신규 Track 4 | — | **Query multi-vector (max 후보 + weighted 랭킹 2단계)** | 데이터 재생성 0, 단기 효과 |
| UX 라벨 | "무직(주부 포함)" 일괄 | **context 기반 추론 + display/원본 분리** | 30대 여성 한정 가설, 일반화 약함. LLM 입력에 표시 라벨 섞이면 톤 오염 |
| Track 1 stop-list 확장 | 효과 낮음 (가설) | **명시 보류** | 화물차/무직 stop은 실제 신호 삭제 |
| Track 3 평가 기준 | "cosine spread 확대" | **top-k/known-target/분기력** | E5 모델 카드 cosine 0.7~1.0이 정상, 순위가 중요 |
| LLM 카테고리 가중치 | 그대로 사용 | **clip + temperature** | 추정 정확도 미검증 |
| 측정 방식 | 단순 비교 | **4셀 분리** (baseline / T4 / T2 / T4+T2) | 효과 분리 위해 |

## 신규 발견 (v1엔 없었음)

1. **메인 임베딩이 combined 모드** — Track 2의 가치 재평가
2. **무직 통계** — 30대 여성 한정 시 주부 35.8% (Codex 100만 행 분석)
3. **Query multi-vector**가 데이터 재생성 0인 단기 후보
4. **BGE-M3는 hybrid** (dense+sparse+multi-vector+rerank)이 본질, 단순 모델 교체 아님
5. **캐시 키 메타** — `schema_version`, `pool_method`, `embedding_model`, 축별 텍스트 해시 포함

## 보류 항목 (검증 후 확정)

| 항목 | 확정 방법 | 검증 시점 |
|---|---|---|
| Track 2 카테고리 cosine 정규화 (raw vs z-score) | Step 2-a 컬럼별 분포 측정 | pilot 첫 단계 |
| Full 확장 (10만 → 100만) | Step 3 4셀 측정 결과 (known-target 22/22, top1 일치율 ≥80%, 분기력) | pilot 후 |
| Track 3 진행 여부 | Track 2/4 효과 측정 후 한계 잔존 시 | 향후 |

## 남은 리스크

- 메인 임베딩이 combined 모드라 Track 2 marginal 효과가 작을 가능성 → 4셀 측정에서 의미 향상 없으면 폐기
- LLM 카테고리 가중치 추정 정확도 미검증 → stress set 12~24개로 측정. top1 < 80%면 비중 조정
- Track 4 도입 시 query embedding 캐시 무효화 (1회성 비용)
- 평가 인프라(평가 스크립트, stress set, feature flag) 준비 비용 — 추정 4~8시간

## 추가 루프 필요 여부

- 핵심 설계 합의 완료, **Round 3 불필요**
- 다음 액션: Step 0 (평가 인프라 + stress set 라벨링) 사용자 승인 → Step 1·2 pilot 병렬 진행
- pilot 결과 측정 후 full 확장 여부 사용자 결정

## 외부 레퍼런스 (Codex 인용)

- E5 모델 카드 — cosine 분포의 정상 패턴
- BGE-M3 모델 카드 — hybrid retrieval
- OpenAI embedding update — large vs small MIRACL/MTEB 비교
