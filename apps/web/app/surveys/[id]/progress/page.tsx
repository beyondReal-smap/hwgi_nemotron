"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { SurveyProgress } from "@/components/SurveyProgress";
import {
  getSurvey,
  getSurveyStatus,
  type Survey,
  type SurveyStatusResponse,
} from "@/lib/api";

/**
 * /surveys/:id/progress — 실시간 진행 모니터링 (polling).
 *
 * 동작:
 *  - 2초 간격 polling
 *  - 완료/실패 도달 시 3초 추가 polling 후 자동 중단 (마지막 갱신 보장)
 *  - 완료 시 CTA 2종 노출 (응답 결과 / 차트 리포트)
 *  - 재시도 트리거 시 즉시 1회 갱신 후 polling 재개
 */

const POLL_INTERVAL_MS = 2000;
const POLL_TAIL_DELAY_MS = 3000;

export default function ProgressPage() {
  const params = useParams<{ id: string }>();
  const surveyId = params.id;
  const router = useRouter();

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [status, setStatus] = useState<SurveyStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stoppedRef = useRef(false);
  const tailTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1) Survey 메타 1회 로드 (제목 표시 + 검증용)
  useEffect(() => {
    getSurvey(surveyId)
      .then(setSurvey)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [surveyId]);

  // 2) status polling
  const fetchStatus = useCallback(async () => {
    try {
      const r = await getSurveyStatus(surveyId);
      setStatus(r);
      // 종료 상태 도달 시 추가 1회 polling 예약 후 중단
      if (
        (r.survey_status === "completed" || r.survey_status === "failed") &&
        !stoppedRef.current &&
        !tailTimerRef.current
      ) {
        tailTimerRef.current = setTimeout(() => {
          stoppedRef.current = true;
        }, POLL_TAIL_DELAY_MS);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [surveyId]);

  useEffect(() => {
    stoppedRef.current = false;
    fetchStatus();
    const handle = setInterval(() => {
      if (stoppedRef.current) {
        clearInterval(handle);
        return;
      }
      fetchStatus();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(handle);
      if (tailTimerRef.current) clearTimeout(tailTimerRef.current);
      stoppedRef.current = true;
    };
  }, [fetchStatus]);

  function handleRetried() {
    // 재시도 트리거 후 즉시 1회 + polling 재개
    stoppedRef.current = false;
    if (tailTimerRef.current) {
      clearTimeout(tailTimerRef.current);
      tailTimerRef.current = null;
    }
    fetchStatus();
  }

  const isDone =
    status?.survey_status === "completed" || status?.survey_status === "failed";

  return (
    <div className="min-h-screen bg-vellum text-ink flex flex-col">
      <SiteHeader />
      <main className="flex-1 max-w-[1100px] w-full mx-auto p-4 lg:p-8">
        {/* 페이지 헤더 */}
        <header className="flex flex-col gap-1.5 mb-6">
          <p className="text-overline text-dusty">설문 시뮬레이션</p>
          <h1 className="text-display text-ink tracking-tight truncate">
            {survey?.title || "진행 모니터링"}
          </h1>
          {survey && (
            <p className="text-body text-graphite">
              {survey.persona_uuids.length.toLocaleString()}명 × {survey.questions.length}질문 ·
              모델 <span className="font-mono">{survey.execution.model}</span> ·
              temperature{" "}
              <span className="font-mono">{survey.execution.temperature}</span>
            </p>
          )}
        </header>

        {/* 에러 */}
        {error && (
          <div
            role="alert"
            className="mb-4 bg-terra/10 border border-terra/30 text-ink px-4 py-3 rounded-[9.6px]"
          >
            <p className="font-medium mb-1">조회 실패</p>
            <p className="text-caption text-graphite">{error}</p>
          </div>
        )}

        {/* 진행 위젯 */}
        {status ? (
          <SurveyProgress status={status} onRetried={handleRetried} />
        ) : (
          <ProgressSkeleton />
        )}

        {/* 완료 CTA */}
        {isDone && status && (
          <section className="mt-6 bg-azure/30 border border-azure rounded-[9.6px] px-5 py-4">
            <p className="text-body text-ink font-medium mb-1">
              ✓ 시뮬레이션{" "}
              {status.survey_status === "completed" ? "완료" : "종료 (일부 실패)"}
            </p>
            <p className="text-body-sm text-graphite mb-3">
              {status.counts.completed.toLocaleString()}건 처리됨
              {status.counts.failed > 0 && (
                <> · 실패 {status.counts.failed.toLocaleString()}건</>
              )}{" "}
              · 누적 토큰 {status.total_tokens.toLocaleString()}
              {status.avg_response_seconds !== null && (
                <> · 평균 {status.avg_response_seconds.toFixed(1)}초</>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/surveys/${surveyId}/responses`}
                className="px-4 py-2 text-body-sm font-medium text-snow bg-ink rounded-[9.6px]
                           hover:bg-onyx active:bg-graphite transition-colors"
              >
                응답 결과 보기 →
              </Link>
              <Link
                href={`/surveys/${surveyId}/report`}
                className="px-4 py-2 text-body-sm font-medium text-graphite bg-snow border border-parchment rounded-[9.6px]
                           hover:border-terra hover:text-terra transition-colors"
              >
                차트 리포트 보기
              </Link>
              <button
                type="button"
                onClick={() => router.push("/surveys/new")}
                className="px-4 py-2 text-body-sm text-graphite hover:text-terra transition-colors"
              >
                새 설문 만들기
              </button>
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

// ============================================================
// 로딩 스켈레톤
// ============================================================

function ProgressSkeleton() {
  return (
    <section
      className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden animate-pulse"
      aria-busy="true"
    >
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4">
        <div className="h-5 w-32 bg-parchment rounded" />
        <div className="h-3 w-48 bg-parchment rounded mt-2" />
      </header>
      <div className="p-5 flex flex-col gap-5">
        <div className="h-2 bg-parchment rounded-full" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-20 bg-snow border border-parchment rounded-[9.6px]"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
