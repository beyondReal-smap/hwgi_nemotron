# Part 6: 응답 조회 + 차트 리포트 — Phase 6-7

> master: [../master.md](../master.md)
> 선행 Part: part5 | 후속 Part: -
> 담당 Phase: 6-7 | 변경 파일: 6개 | 상태: 초안

## 목표

- **Phase 6** `/surveys/:id/responses`: 페르소나별/질문별 두 가지 뷰로 응답을 조회. 각 답변의 LLM reasoning 펼쳐보기.
- **Phase 7** `/surveys/:id/report`: 질문 유형별 차트(객관식 도넛/막대, 척도 히스토그램, 주관식 인용 카드). 응답자 분포 요약. CSV/JSON export.

## 전제 조건

- [ ] part4 완료 (모든 ResponseSession 완성)
- [ ] part5 완료 (survey.status == "completed" 인지 가능)
- [ ] 기존 `KoreaMap`, `RegionChart`, recharts `LabelList` 패턴 숙지 (overview에서 적용 완료)

## 작업 목록

### Phase 6 — 응답 조회

- [ ] `routes/survey_responses.py` — `GET /api/surveys/:id/responses` (페르소나별 + 페이지네이션 + 페르소나 메타 join)
- [ ] `components/ResponsesByPersona.tsx` — 좌 페르소나 리스트(검색) / 우 답변 + reasoning
- [ ] `components/ResponsesByQuestion.tsx` — 질문 선택 → 모든 페르소나 답변 표
- [ ] `app/surveys/[id]/responses/page.tsx` — 뷰 토글 + URL state(`?view=persona|question`)

### Phase 7 — 차트 리포트

- [ ] `routes/survey_report.py` — `GET /api/surveys/:id/report` (질문별 집계 데이터)
- [ ] `components/ReportChartChoice.tsx` — 객관식 도넛(≤4 선택지) / 막대(>4)
- [ ] `components/ReportChartScale.tsx` — 척도 히스토그램 + 평균/중앙값
- [ ] `components/ReportOpenEnded.tsx` — 주관식 인용 카드 (대표 응답 5건 + 글자수 분포)
- [ ] `app/surveys/[id]/report/page.tsx` — 차트들 정렬 + 응답자 분포 + CSV/JSON export 버튼

## 변경 예시 (핵심 시그니처만)

### Phase 6 — 응답 조회

**`apps/api/routes/survey_responses.py` — 신규**
```python
class PersonaWithSession(BaseModel):
    persona_uuid: str
    sex: str
    age: int
    province: str
    occupation: str
    persona: str
    session: ResponseSession             # 답변 포함

class ResponsesResponse(BaseModel):
    survey_id: str
    total_personas: int
    page: int
    page_size: int
    items: list[PersonaWithSession]

@router.get("/{survey_id}/responses", response_model=ResponsesResponse)
def get_responses(survey_id: str, page: int = 1, page_size: int = 20, q: str | None = None) -> ResponsesResponse:
    """페르소나 메타(store) + ResponseSession join 후 페이지네이션. q는 페르소나 텍스트 부분 매칭."""
    ...
```

**`apps/web/components/ResponsesByPersona.tsx` — 신규**
```tsx
// 12-col 분할
// 좌 4col: SectionCard '페르소나 목록' + 검색 input + 가상화 목록 (react-window 사용 또는 페이지네이션)
//   각 행: persona 라벨 (성별·나이·지역·직업)
//   선택된 행: bg-snow + 좌측 terra bar
// 우 8col: SectionCard '응답 상세'
//   상단: 페르소나 프로필 요약 (3-line)
//   본문: 질문 카드 N개 — 질문 텍스트 + 답변 + "추론 보기" 토글 (펼치면 reasoning + confidence)
//
// 빈 상태: "왼쪽에서 페르소나를 선택하세요"
```

**`apps/web/components/ResponsesByQuestion.tsx` — 신규**
```tsx
// 상단: 질문 select (dropdown, 질문 1·2·3...)
// 하단:
//   객관식·NPS·척도: 선택지·점수별 그룹화 → "응답자 명단" 테이블
//   주관식: 답변 카드 리스트 (답변 텍스트 + 페르소나 라벨 + 확신도 점수)
```

**`apps/web/app/surveys/[id]/responses/page.tsx` — 신규**
```tsx
const [view, setView] = useState<"persona" | "question">("persona");
// URL과 동기화: useSearchParams + replaceState

return (
  <main className="max-w-[1440px] mx-auto p-4 lg:p-8">
    {/* 헤더 — survey.title + 응답 N건 통계 */}
    <SectionCard title={survey.title} sub={`${total} 페르소나 × ${survey.questions.length} 질문`}>
      <Toggle value={view} onChange={setView}
              options={[{value:"persona",label:"페르소나별"},{value:"question",label:"질문별"}]} />
    </SectionCard>

    {view === "persona" ? <ResponsesByPersona ... /> : <ResponsesByQuestion ... />}
  </main>
);
```

### Phase 7 — 차트 리포트

**`apps/api/routes/survey_report.py` — 신규**
```python
class QuestionReport(BaseModel):
    question_id: str
    type: QuestionType
    text: str
    total_responses: int
    # 유형별 집계 (해당 필드만 채움)
    choice_distribution: dict[str, int] | None = None       # {"옵션A": 32, "옵션B": 18, ...}
    scale_histogram: list[int] | None = None                # [score N대비 count] (scale_min~max)
    scale_mean: float | None = None
    scale_median: float | None = None
    open_ended_samples: list[dict] | None = None            # [{persona_uuid, answer, confidence, ...}] 상위 5건
    avg_confidence: float

class ReportResponse(BaseModel):
    survey: Survey
    respondent_distribution: dict                            # sex/age_bins/province (응답 완료자 기준)
    questions: list[QuestionReport]
    summary: dict                                            # {total_responses: N, total_tokens: M}

@router.get("/{survey_id}/report", response_model=ReportResponse)
def get_report(survey_id: str) -> ReportResponse:
    """전체 세션 집계. 백엔드에서 사전 가공해 프론트 데이터 변환 부담 제거."""
    # 완료된 세션만 집계, 실패는 제외
    ...
```

**`apps/web/components/ReportChartChoice.tsx` — 신규**
```tsx
// SectionCard로 감싸진 단일 질문 차트
// dem.bins.length ≤ 4 → 도넛 (recharts Pie + 도넛 segment 라벨 %)
// > 4 → 가로 막대 (LabelList: count · pct)
// 색상: terra → azure → graphite 단계
// 하단: 평균 confidence + 총 응답자 수
```

**`apps/web/components/ReportChartScale.tsx` — 신규**
```tsx
// 척도 히스토그램 (세로 막대)
// X축: scale_min~max (label은 옵션 텍스트가 있으면 사용)
// 위에 평균·중앙값 라인 어노테이션
// 막대 상단 LabelList로 count 표시
```

**`apps/web/components/ReportOpenEnded.tsx` — 신규**
```tsx
// 주관식
// - 상단: 응답 글자수 분포 미니 차트 (1줄)
// - 본문: 대표 응답 5건 (상위 confidence)
//   각 카드: 응답 텍스트(line-clamp-4 expandable) + 페르소나 라벨 + confidence %
// - 하단: 워드 클라우드는 Phase 2 (이번 MVP 제외)
```

**`apps/web/app/surveys/[id]/report/page.tsx` — 신규**
```tsx
// 1. 응답자 분포 (overview 패턴 재사용 — 도넛 sex + 막대 age + 막대 province 미니 3개)
// 2. 질문별 차트 (questions.map → 유형 분기로 ReportChartChoice / Scale / OpenEnded 렌더)
// 3. 상단 액션:
//   - CSV export: GET /api/surveys/:id/report/export.csv (응답 raw 데이터)
//   - JSON 복사: 클립보드로 ReportResponse json
//   - 공유 링크: 현재 URL 복사 (인증 없으니 단순 URL)
```

## 디자인 가이드

- 각 차트는 `SectionCard`로 감싸기 (title=질문 텍스트, sub=`유형 · N명 응답`)
- 차트 사이 gap-6
- 빈 응답(0건) → SectionCard 안에 "응답 없음" 상태 (empty state 일러스트 없이 텍스트만)
- export 버튼: SectionCard header `action`에 작은 ghost 버튼

## CSV export 포맷

```csv
persona_uuid,sex,age,province,occupation,question_1_answer,question_1_reasoning,question_1_confidence,...,total_tokens
abc123,남자,42,서울,개발자,1,"커피가 더 익숙해서",0.82,...,1234
```

- 객관식: 선택지 번호 + 텍스트 (예: `"1: 커피"`)
- 다중선택: `"1,3"` 콤마 결합
- 척도: 점수 정수
- 주관식: 따옴표 escape

## 검증

```bash
.venv/bin/python -c "from routes.survey_responses import get_responses; from routes.survey_report import get_report; print('OK')"

# API 스모크 (완료된 설문 대상)
curl -s "http://localhost:5101/api/surveys/{completed_id}/responses?page=1&page_size=10" | jq '.total_personas, (.items|length)'
curl -s "http://localhost:5101/api/surveys/{completed_id}/report" | jq '.questions | length, .summary'

# 프론트 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5101/surveys/{id}/responses
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5101/surveys/{id}/report
```

## 완료 기준

- [ ] `/responses` 페르소나별 뷰 좌/우 분할, 검색·페이지네이션·reasoning 토글 동작
- [ ] `/responses` 질문별 뷰 — 질문 선택 → 모든 답변 표시
- [ ] `/report` 질문 5종 유형(single/multi/scale/open/nps) 모두 적절한 차트로 렌더
- [ ] CSV export 다운로드 가능 + 데이터 일관성 (페르소나 1명 = 1행)
- [ ] master Phase 맵 상태 ⬜ → ✅
- [ ] 빌드 + pm2 restart 성공
- [ ] **전체 E2E**: master "전체 검증 계획"의 E2E 시나리오 (1)→(2)→(3) 완주
