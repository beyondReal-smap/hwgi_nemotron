# Part 3: 설문 생성 마법사 — Phase 3

> master: [../master.md](../master.md)
> 선행 Part: part2 | 후속 Part: part4
> 담당 Phase: 3 | 변경 파일: 6개 | 상태: 초안

## 목표

- `/surveys/new`에서 4-step 마법사로 Survey + Question 생성 → `POST /api/surveys`로 draft 저장 → Step 4 마지막의 "시뮬레이션 시작" 버튼 클릭 시 `POST /api/surveys/:id/run` 트리거 (실제 실행은 part4 구현, 여기선 호출만).

## 전제 조건

- [ ] part2 완료 (`/api/surveys` CRUD, `/api/segments` 목록·조회 동작)
- [ ] part1의 `PersonaFilterPanel`, `PersonaCardGrid` 재사용 가능 형태로 export

## 작업 목록

- [ ] `WizardShell.tsx` — 4-step 진행 인디케이터 + 이전/다음 + 최종 제출 버튼 + 단계별 검증
- [ ] `StepBasic.tsx` — 제목/설명/목적 입력 (text counter, validation)
- [ ] `StepTargets.tsx` — part1 필터 패널 재임베드 + 저장된 세그먼트 dropdown + 미리보기 분포 차트 + 샘플링 옵션
- [ ] `StepQuestions.tsx` — 질문 추가/편집/삭제 + Drag & Drop 순서 변경 + 유형별 입력 (객관식/척도/주관식/NPS) + 실시간 미리보기
- [ ] `StepExecution.tsx` — LLM 모델·temperature·reasoning 토글 + 예상 토큰·비용 계산
- [ ] `app/surveys/new/page.tsx` — 마법사 컨테이너 (상태 보관 + API 호출 흐름)

## 변경 예시 (핵심 시그니처만)

**`apps/web/components/wizard/WizardShell.tsx` — 신규**
```tsx
type Step = 1 | 2 | 3 | 4;

type WizardState = {
  basic: { title: string; description: string; objective: string };
  targets: TargetFilter & { previewPersonas: PersonaCard[]; previewTotal: number };
  questions: Question[];
  execution: ExecutionConfig;
};

export function WizardShell({
  step, setStep, state, setState, onSubmit
}: {
  step: Step;
  setStep: (s: Step) => void;
  state: WizardState;
  setState: (s: WizardState) => void;
  onSubmit: () => Promise<void>;
}) {
  // SectionCard 1개 + 상단 stepper(1·2·3·4) + 하단 액션 바
  // 단계별 validate(state) → 실패 시 "다음" 비활성
  // step === 4 + validate 통과 → "시뮬레이션 시작" 버튼
}
```

**`apps/web/components/wizard/StepBasic.tsx` — 신규**
```tsx
// 입력 3종 + 글자수 카운터(20~500)
// objective는 LLM 응답 품질 향상에 활용된다는 주석 헬퍼 텍스트
```

**`apps/web/components/wizard/StepTargets.tsx` — 신규**
```tsx
// 좌: PersonaFilterPanel (part1 재사용) + 저장된 세그먼트 select
// 우상: 미리보기 분포 — sex/age/province 미니 차트 (part1의 distribution 활용)
// 우하: 샘플링 옵션 (전체/랜덤 N/비례) + sample_size input
// "이 조건으로 N명 선별" 확정 → state.targets에 persona_uuids[] 스냅샷
```

**`apps/web/components/wizard/StepQuestions.tsx` — 신규**
```tsx
// 좌측: 질문 리스트 (DnD — @dnd-kit/sortable 권장, 미설치 시 react-beautiful-dnd)
//   각 카드: 유형 뱃지 + 텍스트 + 편집/삭제 아이콘
// 우측: 선택된 질문 편집 폼
//   유형: select (single/multi/scale/open/nps)
//   유형별 입력:
//     - single/multi: 선택지 input list (+ 추가 / − 삭제)
//     - scale: scale_min/scale_max + label_low/label_high (옵션)
//     - open: 추가 입력 없음
//     - nps: 자동 0-10
// 하단: 미리보기 — 실제 페르소나가 받게 될 질문 카드 형태
```

**`apps/web/components/wizard/StepExecution.tsx` — 신규**
```tsx
// LLM provider: anthropic/sllm
// model: anthropic이면 claude-haiku-4-5 / claude-sonnet-4-6, sllm이면 qwen3.6-27b
// temperature 슬라이더 (0~2)
// include_reasoning 토글
// 예상 비용 계산:
//   personas = state.targets.sample_size
//   questions = state.questions.length
//   total_calls = personas * questions
//   estimated_tokens = total_calls * (300 input + 100 output)
//   cost = estimated_tokens * model_unit_price
// "시뮬레이션 시작" 버튼 → onSubmit (마법사 컨테이너에서 createSurvey + runSurvey 호출)
```

**`apps/web/app/surveys/new/page.tsx` — 신규**
```tsx
"use client";

export default function NewSurveyPage() {
  const [step, setStep] = useState<Step>(1);
  const [state, setState] = useState<WizardState>(initialState);

  async function handleSubmit() {
    // 1) POST /api/surveys (draft 생성)
    const survey = await createSurvey({
      title: state.basic.title, ...,
      target_filter: state.targets,
      execution: state.execution,
      questions: state.questions,
    });
    // 2) POST /api/surveys/:id/run (part4에서 구현, 여기선 호출만)
    await fetch(`/api/surveys/${survey.id}/run`, { method: "POST" });
    // 3) /surveys/:id/progress 로 이동
    router.push(`/surveys/${survey.id}/progress`);
  }

  return (
    <div className="min-h-screen bg-vellum">
      <SiteHeader />
      <main className="max-w-[1440px] mx-auto p-4 lg:p-8">
        <WizardShell step={step} setStep={setStep} state={state} setState={setState} onSubmit={handleSubmit} />
      </main>
      <SiteFooter />
    </div>
  );
}
```

## UI 디테일 (한화 토큰 준수)

- 모든 SectionCard: `bg-snow + border-l-4 border-l-terra` 헤더
- Stepper 인디케이터: 현재 단계 → `text-terra font-medium`, 완료 → `text-graphite`, 대기 → `text-stone`
- 다음/제출 버튼: `bg-ink text-snow hover:bg-onyx`
- 이전 버튼: `bg-snow border border-parchment text-graphite`
- 단계 검증 실패 토스트: `bg-terra/10 border border-terra/30 text-ink`

## 검증

```bash
cd apps/web && npx tsc --noEmit && pnpm build
# 수동 E2E
# 1. http://localhost:5101/surveys/new 접근 → 200
# 2. Step 1 → 2 → 3 → 4 순회, 각 단계 validation 동작 확인
# 3. Step 4 "시뮬레이션 시작" → /api/surveys POST 후 /surveys/:id/progress 이동
```

## 완료 기준

- [ ] 4 step 마법사가 정상 동작 (이전/다음 + 단계별 검증)
- [ ] Step 3에서 객관식·다중선택·척도·주관식·NPS 5종 질문 모두 추가 가능
- [ ] Step 4의 비용 산출이 실제 호출 수와 일치 (sample_size × questions)
- [ ] 제출 시 `Survey` 생성됨 + `/surveys/:id/progress`로 이동 (run API는 part4에서 실제 구현, 여기선 200/202 호출만 확인)
- [ ] master Phase 맵 상태 ⬜ → ✅
- [ ] 빌드 + pm2 restart 성공
