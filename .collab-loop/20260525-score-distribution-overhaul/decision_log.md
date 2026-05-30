# Decision Log — 점수 산출·대상자 확정 로직 고도화

## 세션 메타
- 시작: 2026-05-25
- 호스트: Claude (Opus 4.7)
- 토론 상대: Codex (codex-cli 0.133.0)
- 라운드: 2회 (미합의 0건으로 종료)
- 최종 산출물: `proposal_v3_final.md`

## 라운드 산출물
- `proposal_v1.md` — Claude 초안 (진단 + 5개 안)
- `packet_round1.md` → `reply_round1_codex.md` — Codex critique
- `proposal_v2.md` — v1 → v2 통합 (Codex P1 합의 7건 반영)
- `packet_round2.md` → `reply_round2_codex.md` — Codex 디테일 합의
- `proposal_v3_final.md` — v3 최종본 (Round 2 결과 통합)

## 핵심 변경 (v1 → v3)

| 항목 | v1 안 | v3 최종 | 변경 사유 (Codex critique) |
|---|---|---|---|
| score 필드 | display_score로 백분위 노출 | **raw 유지, percentile_score 별도** | opinions.py·PersonaList.tsx의 80/65/40 컷이 raw 기준 |
| Cohort 정의 | 순위 기반 일원화 | **현재 absolute + 폴백 유지** | target absolute 변동(525/718/38,514)이 raw 분포의 핵심 signal |
| rule_bonus | 음수 페널티 (-0.1) | **명시 차원만 분모 정규화 + 하한값** | 음수는 과함, 정규화가 안정 |
| 적용 순서 | 단일 변경 | **PR-1(P0+P1+P2) → 검증 → PR-2(P3+P4)** | 점수 의미 변경은 백테스트 후 별도 PR |
| 품질 게이트 | 미고려 | **경고 배지 추가** (분포 좁음 등) | cb6ef5fd 같은 비정상 분포 자동 감지 |
| 새 발견 | — | **query 텍스트의 "보험" 키워드가 보험 종사자 과매칭** | 상위 페르소나 데이터에서 실증 |

## 보류 항목 (검증 후 확정)

| 항목 | 확정 방법 | 검증 시점 |
|---|---|---|
| `RULE_BONUS_FLOOR` (0.05/0.1/0.2) | Plan A 백테스트 — std, p99-p50, Known-target 통과율 비교 | PR-2 착수 전 |
| `core_low_lift` 임계값 | Plan C — 정상 케이스의 core_lift 실측 분포 | PR-2 P4 착수 전 |
| 캐싱 전략 | 사용 패턴 데이터 확보 후 검토 | PR-1 운영 1개월 후 |

## 남은 리스크

- **임베딩 자체의 변별력 한계**: percentile 변환은 표시 문제만 해결, raw cosine이 좁은 분포라면 본질적 변별력 확보 X. **별도 트랙(Query de-noising, Category 임베딩, 임베딩 모델 교체)이 본질 해결책**. PR-1·PR-2와 무관하게 우선순위 검토 필요.
- **A/B 비교의 안 간 절대 격차**: percentile은 모든 안에서 0~100 균등 → 안 간 차이는 raw 평균·lift·고정 컷 인원에 의존. UI가 이 정보를 충분히 노출하지 못하면 사용자가 percentile만 보고 안 간 차이를 놓칠 수 있음.

## 추가 루프 필요 여부

- 핵심 설계 합의 완료, **Round 3 불필요**
- 사용자 승인 후 바로 PR-1 구현 착수 가능
- PR-1 배포 후 Plan A/C 검증 결과를 사용자에게 보고 → PR-2 진행 여부 결정

## 외부 레퍼런스 (Codex 인용)

- Mansoury et al., 2019 — 백분위 변환의 분포 평탄화 효과
- scikit-learn calibration / arxiv 2408.11596 — 백분위는 확률적 의미 별도 보정 필요
- Elastic / Lucene scoring — raw relevance score를 절대 퍼센트로 쓰지 말 것
