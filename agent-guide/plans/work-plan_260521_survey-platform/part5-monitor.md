# Part 5: 진행 모니터링 — Phase 5

> master: [../master.md](../master.md)
> 선행 Part: part4 | 후속 Part: part6
> 담당 Phase: 5 | 변경 파일: 3개 | 상태: 초안

## 목표

- `/surveys/:id/progress`에서 polling으로 실시간 진행률, 처리된 페르소나 수, 평균 응답 시간, 누적 토큰, 에러 페르소나 목록을 표시. 완료 시 결과 페이지로 CTA 노출.

## 전제 조건

- [ ] part4 완료 (`survey_repo.count_sessions`, `survey_repo.list_sessions` 동작)
- [ ] 기존 `components/AnalysisProgress.tsx` 패턴 (UX/디자인) 숙지

## 작업 목록

- [ ] `routes/survey_progress.py` — `GET /api/surveys/:id/status` (집계 통계 반환)
- [ ] `components/SurveyProgress.tsx` — 진행 바 + 통계 카드 + 에러 목록 + "재시도" 액션
- [ ] `app/surveys/[id]/progress/page.tsx` — 2초 polling + 완료 시 CTA

## 변경 예시 (핵심 시그니처만)

**`apps/api/routes/survey_progress.py` — 신규**
```python
from fastapi import APIRouter, HTTPException
from services import survey_repo

router = APIRouter(prefix="/api/surveys", tags=["survey_progress"])

class SurveyStatusResponse(BaseModel):
    survey_id: str
    survey_status: SurveyStatus
    total: int
    counts: dict[str, int]            # {"pending": N, "running": N, "completed": N, "failed": N}
    completed_ratio: float            # completed / total
    failed_personas: list[dict]       # [{persona_uuid, error, ...}] 최대 50개
    avg_response_seconds: float | None
    total_tokens: int

@router.get("/{survey_id}/status", response_model=SurveyStatusResponse)
def survey_status(survey_id: str) -> SurveyStatusResponse:
    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        raise HTTPException(404)
    sessions = survey_repo.list_sessions(survey_id)
    total = len(survey.persona_uuids)
    counts = {"pending":0,"running":0,"completed":0,"failed":0}
    durations = []
    tokens = 0
    failed = []
    for s in sessions:
        counts[s.status] = counts.get(s.status, 0) + 1
        if s.status == "completed" and s.started_at and s.completed_at:
            durations.append((s.completed_at - s.started_at).total_seconds())
        if s.status == "failed":
            failed.append({"persona_uuid": s.persona_uuid, "error": s.error})
        tokens += s.total_tokens
    return SurveyStatusResponse(
        survey_id=survey_id,
        survey_status=survey.status,
        total=total,
        counts=counts,
        completed_ratio=counts["completed"] / max(total, 1),
        failed_personas=failed[:50],
        avg_response_seconds=sum(durations) / len(durations) if durations else None,
        total_tokens=tokens,
    )

@router.post("/{survey_id}/retry-failed", status_code=202)
def retry_failed(survey_id: str, bg: BackgroundTasks) -> dict:
    """failed 상태 세션만 재실행."""
    # 1) failed 세션의 persona_uuid 수집
    # 2) survey 임시 복사본에 persona_uuids = failed_uuids로 설정
    # 3) bg.add_task(asyncio.run, run_survey(temp_survey))
    ...
```

**`apps/web/components/SurveyProgress.tsx` — 신규**
```tsx
type Props = { status: SurveyStatusResponse };

export function SurveyProgress({ status }: Props) {
  const pct = status.completed_ratio * 100;
  return (
    <SectionCard title="진행 현황" sub={`총 ${status.total}명 대상`}>
      {/* 진행 바 — terra */}
      <div className="h-2 bg-parchment rounded-full overflow-hidden">
        <div className="h-full bg-terra transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-caption text-graphite mt-2 tabular-nums">
        {status.counts.completed}/{status.total} 완료
        ({pct.toFixed(1)}%)
        {status.counts.running > 0 && ` · 진행 중 ${status.counts.running}`}
        {status.counts.failed > 0 && <span className="text-terra"> · 실패 {status.counts.failed}</span>}
      </p>

      {/* 통계 4 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <Stat label="평균 응답" value={status.avg_response_seconds?.toFixed(1) ?? "-"} suffix="초" />
        <Stat label="누적 토큰" value={status.total_tokens.toLocaleString()} />
        <Stat label="완료" value={status.counts.completed.toString()} suffix="명" />
        <Stat label="실패" value={status.counts.failed.toString()} suffix="명" />
      </div>

      {/* 에러 목록 + 재시도 */}
      {status.failed_personas.length > 0 && (
        <FailedList items={status.failed_personas} surveyId={status.survey_id} />
      )}
    </SectionCard>
  );
}
```

**`apps/web/app/surveys/[id]/progress/page.tsx` — 신규**
```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSurveyStatus } from "@/lib/api";

const POLL_INTERVAL_MS = 2000;
const POLL_STOP_AT_COMPLETION_AFTER_MS = 3000;   // 완료 후 3초 뒤 polling 중단

export default function ProgressPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<SurveyStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stopTimer: NodeJS.Timeout | null = null;

    async function tick() {
      try {
        const s = await getSurveyStatus(id);
        if (cancelled) return;
        setStatus(s);
        if (s.survey_status === "completed" || s.survey_status === "failed") {
          if (!stopTimer) stopTimer = setTimeout(() => { cancelled = true; }, POLL_STOP_AT_COMPLETION_AFTER_MS);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    tick();
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(handle); if (stopTimer) clearTimeout(stopTimer); };
  }, [id]);

  return (
    <div className="min-h-screen bg-vellum">
      <SiteHeader />
      <main className="max-w-[1100px] mx-auto p-4 lg:p-8">
        {status && <SurveyProgress status={status} />}
        {status?.survey_status === "completed" && (
          <div className="mt-6 flex gap-3">
            <button onClick={() => router.push(`/surveys/${id}/responses`)}
                    className="px-5 py-2.5 bg-ink text-snow rounded-[9.6px] hover:bg-onyx">
              응답 결과 보기
            </button>
            <button onClick={() => router.push(`/surveys/${id}/report`)}
                    className="px-5 py-2.5 bg-snow border border-parchment text-graphite rounded-[9.6px] hover:border-terra hover:text-terra">
              차트 리포트 보기
            </button>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
```

## UI 디테일

- 진행 바: `h-2 bg-parchment` 트랙 + `bg-terra` 채움, 부드러운 width 트랜지션
- 통계 카드: `MetaCard` 패턴 재사용 (overview의 MetaCard 추출 또는 인라인)
- 에러 행: 좌측에 `border-l-2 border-l-terra` 강조 + 페르소나 라벨 + 에러 메시지 + 재시도 버튼
- 완료 시 페이지 상단 banner: `bg-azure/30 border border-azure rounded-[9.6px] px-4 py-3` "시뮬레이션 완료! N건 처리, 평균 X.X초"

## 검증

```bash
# 백엔드
.venv/bin/python -c "from routes.survey_progress import survey_status; print('OK')"
curl -s http://localhost:5101/api/surveys/{id}/status | jq '.counts, .completed_ratio'

# 프론트: /surveys/{id}/progress 200 + 2초 간격으로 status 갱신
# 완료 시 CTA 2종 노출
```

## 완료 기준

- [ ] polling 2초 간격으로 status 갱신, 완료 후 3초 뒤 자동 중단
- [ ] 진행 바·통계 4종·에러 목록 모두 표시
- [ ] 실패 페르소나 재시도 액션 트리거 가능 (성공 시 다시 running 상태)
- [ ] master Phase 맵 상태 ⬜ → ✅
- [ ] 빌드 + pm2 restart 성공
