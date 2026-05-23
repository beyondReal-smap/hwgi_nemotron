"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { ResponsesByPersona } from "@/components/ResponsesByPersona";
import { ResponsesByQuestion } from "@/components/ResponsesByQuestion";
import {
  getSurvey,
  getSurveyResponses,
  type ResponsesResponse,
  type Survey,
} from "@/lib/api";

/**
 * /surveys/:id/responses — 응답 결과 조회.
 *
 * 두 뷰 토글:
 *  - persona: 페르소나별 (좌 목록 / 우 답변)
 *  - question: 질문별 (질문 선택 → 모든 답변)
 *
 * 페이지네이션은 페르소나 100명 이하 MVP 가정 — 1페이지에 100명까지.
 * 검색 q는 페르소나 텍스트 부분 매칭.
 */

type View = "persona" | "question";

export default function ResponsesPage() {
  const params = useParams<{ id: string }>();
  const surveyId = params.id;

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [responses, setResponses] = useState<ResponsesResponse | null>(null);
  const [view, setView] = useState<View>("persona");
  const [searchQ, setSearchQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getSurvey(surveyId),
      getSurveyResponses(surveyId, { page: 1, page_size: 100, q: searchQ || undefined }),
    ])
      .then(([s, r]) => {
        if (cancelled) return;
        setSurvey(s);
        setResponses(r);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [surveyId, searchQ]);

  return (
    <div className="min-h-screen bg-vellum text-ink flex flex-col">
      <SiteHeader />
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 lg:p-8">
        {/* 페이지 헤더 */}
        <header className="flex flex-col gap-1.5 mb-6">
          <p className="text-overline text-dusty">설문 응답</p>
          <h1 className="text-display text-ink tracking-tight truncate">
            {survey?.title || "응답 결과"}
          </h1>
          {survey && responses && (
            <p className="text-body text-graphite">
              완료 <span className="font-mono">{responses.completed}</span>명
              {responses.failed > 0 && (
                <> · 실패 <span className="font-mono text-terra">{responses.failed}</span></>
              )}
              {" · "}질문 <span className="font-mono">{survey.questions.length}</span>개
            </p>
          )}
        </header>

        {error && (
          <div
            role="alert"
            className="mb-4 bg-terra/10 border border-terra/30 text-ink px-4 py-3 rounded-[9.6px]"
          >
            <p className="font-medium mb-1">조회 실패</p>
            <p className="text-caption text-graphite">{error}</p>
          </div>
        )}

        {/* 컨트롤 — 뷰 토글 + 검색 + 리포트 링크 */}
        <section className="mb-4 bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
          <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4 flex items-start justify-between gap-3 flex-wrap">
            <ViewToggle value={view} onChange={setView} />
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="페르소나 검색 (텍스트 부분 일치)"
                className="px-3 py-2 bg-vellum border border-onyx/15 rounded-[9.6px]
                           text-body-sm text-ink placeholder:text-stone w-72
                           focus:outline-none focus:ring-2 focus:ring-azure"
              />
              <Link
                href={`/surveys/${surveyId}/report`}
                className="px-4 py-2 text-body-sm font-medium text-graphite bg-snow border border-parchment rounded-[9.6px]
                           hover:border-terra hover:text-terra transition-colors"
              >
                차트 리포트 →
              </Link>
            </div>
          </header>
        </section>

        {/* 본문 */}
        {loading ? (
          <div className="bg-snow border border-parchment rounded-[9.6px] p-8 text-center text-body-sm text-graphite animate-pulse">
            응답을 불러오는 중…
          </div>
        ) : responses && survey ? (
          view === "persona" ? (
            <ResponsesByPersona items={responses.items} questions={survey.questions} />
          ) : (
            <ResponsesByQuestion items={responses.items} questions={survey.questions} />
          )
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: View;
  onChange: (v: View) => void;
}) {
  const opts: { value: View; label: string; sub: string }[] = [
    { value: "persona", label: "페르소나별", sub: "한 사람의 모든 답변" },
    { value: "question", label: "질문별", sub: "한 질문의 모든 답변" },
  ];
  return (
    <div role="tablist" aria-label="뷰 전환" className="inline-flex bg-vellum border border-parchment rounded-[9.6px] p-0.5">
      {opts.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 text-body-sm rounded-[7px] transition-colors ${
              active
                ? "bg-snow text-ink font-medium border border-parchment"
                : "text-graphite hover:text-ink"
            }`}
            title={o.sub}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
