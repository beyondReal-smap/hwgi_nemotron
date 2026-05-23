"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { ReportChartChoice } from "@/components/ReportChartChoice";
import { ReportChartScale } from "@/components/ReportChartScale";
import { ReportOpenEnded } from "@/components/ReportOpenEnded";
import {
  getSurveyReport,
  getSurveyReportCsvUrl,
  type QuestionReport,
  type ReportResponse,
} from "@/lib/api";

/**
 * /surveys/:id/report — 차트 리포트.
 *
 * 구성:
 *  - 페이지 헤더 (설문 제목 + 요약)
 *  - 응답자 분포 (sex/age/province 미니 차트)
 *  - 질문별 차트 (질문 유형에 따라 ReportChartChoice/Scale/OpenEnded)
 *  - CSV export 버튼
 */

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const surveyId = params.id;

  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSurveyReport(surveyId)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [surveyId]);

  return (
    <div className="min-h-screen bg-vellum text-ink flex flex-col">
      <SiteHeader />
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 lg:p-8">
        {/* 페이지 헤더 */}
        <header className="flex flex-col gap-1.5 mb-6">
          <p className="text-overline text-dusty">차트 리포트</p>
          <h1 className="text-display text-ink tracking-tight truncate">
            {report?.survey.title || "리포트"}
          </h1>
          {report && (
            <p className="text-body text-graphite">
              완료 <span className="font-mono">{report.summary.total_completed.toLocaleString()}</span>명
              {report.summary.total_failed > 0 && (
                <> · 실패 <span className="font-mono text-terra">
                  {report.summary.total_failed}
                </span></>
              )}
              {" · 질문 "}
              <span className="font-mono">{report.survey.questions.length}</span>개
              {" · 누적 토큰 "}
              <span className="font-mono">{report.summary.total_tokens.toLocaleString()}</span>
              {report.summary.avg_response_seconds !== null && (
                <>
                  {" · 평균 응답 "}
                  <span className="font-mono">
                    {report.summary.avg_response_seconds.toFixed(1)}
                  </span>
                  초
                </>
              )}
            </p>
          )}
        </header>

        {/* 액션 바 */}
        <section className="mb-6 bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
          <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-body-sm text-graphite">
              질문 유형별 차트 · 응답자 분포 · CSV export
            </p>
            <div className="flex items-center gap-2">
              <Link
                href={`/surveys/${surveyId}/responses`}
                className="px-3 py-1.5 text-caption text-graphite bg-snow border border-parchment rounded-[9.6px]
                           hover:border-terra hover:text-terra transition-colors"
              >
                ← 응답 결과
              </Link>
              <a
                href={getSurveyReportCsvUrl(surveyId)}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-1.5 text-caption font-medium text-snow bg-ink rounded-[9.6px]
                           hover:bg-onyx active:bg-graphite transition-colors"
              >
                CSV 내려받기 ↓
              </a>
            </div>
          </header>
        </section>

        {/* 에러 */}
        {error && (
          <div
            role="alert"
            className="mb-4 bg-terra/10 border border-terra/30 text-ink px-4 py-3 rounded-[9.6px]"
          >
            <p className="font-medium mb-1">리포트 조회 실패</p>
            <p className="text-caption text-graphite">{error}</p>
          </div>
        )}

        {/* 본문 */}
        {loading && <ReportSkeleton />}
        {report && (
          <div className="flex flex-col gap-6">
            <OverallCommentaryCard
              text={report.overall_commentary}
              status={report.survey.status}
            />
            <RespondentDistributionCard report={report} />
            {report.questions.map((q) => (
              <QuestionChart key={q.question_id} q={q} />
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

// ============================================================
// 전체 총평 — 설문 완료 시 1회 생성된 마크다운 (없으면 안내 카드)
// ============================================================

function OverallCommentaryCard({
  text,
  status,
}: {
  text: string | null;
  status: string;
}) {
  // 캐시 미스 시 노출 문구는 설문 상태에 따라 다름
  // - completed인데 비어있음: 생성 중이거나 LLM 실패 — 새로고침 안내
  // - running/pending: 아직 일러
  // - failed: 응답 없음
  const placeholder =
    status === "completed"
      ? "총평 생성 중입니다. 잠시 후 새로고침해 주세요."
      : status === "running" || status === "pending"
        ? "응답 수집이 끝나면 총평이 자동 생성됩니다."
        : "총평을 생성할 만한 응답이 없습니다.";

  return (
    <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4">
        <h2 className="text-title text-ink">총평</h2>
        <p className="text-body-sm text-dusty mt-1">
          Claude가 응답 분포·핵심 발견·시사점을 한눈에 정리
        </p>
      </header>
      <div className="px-5 py-4">
        {text ? (
          <div
            className="prose max-w-none text-[14px] sm:text-[15px] leading-7 break-words
                       prose-headings:text-ink prose-headings:tracking-tight
                       prose-h2:text-[16px] sm:prose-h2:text-[17px] prose-h2:font-semibold prose-h2:mt-4 prose-h2:mb-2 prose-h2:pb-1.5 prose-h2:border-b prose-h2:border-parchment
                       prose-h2:first:mt-0
                       prose-h3:text-[14px] prose-h3:font-semibold prose-h3:mt-3 prose-h3:mb-1.5
                       prose-p:my-2 prose-p:text-graphite prose-p:leading-7
                       prose-ul:my-2 prose-li:my-1 prose-li:text-graphite
                       prose-strong:text-ink prose-strong:font-semibold"
          >
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-body-sm text-dusty">{placeholder}</p>
        )}
      </div>
    </section>
  );
}

// ============================================================
// 응답자 분포 — sex / age / province 미니 카드
// ============================================================

function RespondentDistributionCard({ report }: { report: ReportResponse }) {
  const total = report.summary.total_completed;
  const dist = report.respondent_distribution;
  return (
    <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4">
        <h2 className="text-title text-ink">응답자 분포</h2>
        <p className="text-body-sm text-dusty mt-1">
          {total.toLocaleString()}명 완료 기준
        </p>
      </header>
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <DistMiniCard label="성별" counts={dist.sex} total={total} />
        <DistMiniCard
          label="연령대"
          counts={Object.fromEntries(dist.age_bins.map((b) => [b.label, b.count]))}
          total={total}
          maxRows={6}
        />
        <DistMiniCard
          label="시도 Top 5"
          counts={Object.fromEntries(
            Object.entries(dist.province).sort((a, b) => b[1] - a[1]).slice(0, 5),
          )}
          total={total}
        />
      </div>
    </section>
  );
}

function DistMiniCard({
  label,
  counts,
  total,
  maxRows = 6,
}: {
  label: string;
  counts: Record<string, number>;
  total: number;
  maxRows?: number;
}) {
  const entries = Object.entries(counts).slice(0, maxRows);
  const max = entries.reduce((m, [, v]) => Math.max(m, v), 0);
  return (
    <div className="bg-snow border border-parchment rounded-[9.6px] px-3 py-2">
      <p className="text-overline text-dusty mb-1.5">{label}</p>
      <ul className="space-y-1">
        {entries.length === 0 && (
          <li className="text-caption text-stone">데이터 없음</li>
        )}
        {entries.map(([k, v]) => {
          const pct = total ? (v / total) * 100 : 0;
          const bar = max ? (v / max) * 100 : 0;
          return (
            <li key={k}>
              <div className="flex items-baseline justify-between gap-2 text-caption mb-0.5">
                <span className="text-graphite truncate">{k}</span>
                <span className="text-ink font-mono tabular-nums shrink-0">
                  {v.toLocaleString()}
                  <span className="text-dusty ml-1">({pct.toFixed(1)}%)</span>
                </span>
              </div>
              <div className="h-1 bg-parchment rounded-full overflow-hidden">
                <div className="h-full bg-terra/80" style={{ width: `${bar}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================================
// 질문 유형별 차트 분기
// ============================================================

function QuestionChart({ q }: { q: QuestionReport }) {
  if (q.type === "single_choice" || q.type === "multi_choice") {
    return <ReportChartChoice q={q} />;
  }
  if (q.type === "scale" || q.type === "nps") {
    return <ReportChartScale q={q} />;
  }
  // open_ended
  return <ReportOpenEnded q={q} />;
}

// ============================================================
// 스켈레톤
// ============================================================

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="h-40 bg-snow border border-parchment rounded-[9.6px]" />
      <div className="h-72 bg-snow border border-parchment rounded-[9.6px]" />
      <div className="h-72 bg-snow border border-parchment rounded-[9.6px]" />
    </div>
  );
}
