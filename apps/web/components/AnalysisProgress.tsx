"use client";

import { useEffect, useState } from "react";

type Stage = {
  /** 표시 라벨 */
  label: string;
  /** 부가 설명 (선택) */
  hint?: string;
  /** 이 단계가 끝나는 시점 (초) */
  endAt: number;
};

type Props = {
  /** 단계 정의 — 시간 순서 */
  stages?: Stage[];
  /** 전체 ETA(초). stages 마지막 endAt과 일치시키는 것이 일반적. */
  totalEta?: number;
  /** 상단 타이틀 */
  title?: string;
};

const DEFAULT_STAGES: Stage[] = [
  {
    label: "상품 소구점 분석",
    hint: "약관에서 타겟 키워드·연령·성별·카테고리 가중치 추출",
    endAt: 9,
  },
  {
    label: "100만 명 페르소나 전체 매칭",
    hint: "쿼리 임베딩 → 코사인 유사도 + 룰 보너스 + 카테고리 가중치",
    endAt: 12,
  },
  {
    label: "Cohort 분할 + 인구통계 집계",
    hint: "핵심/타겟/관심 cohort + Nemotron 11개 컬럼 분포",
    endAt: 14,
  },
  {
    label: "페르소나 의견 생성 (상·하위 대표 각 20명 병렬)",
    hint: "상·하위 100명 매칭 및 대표 각 20명 대상 의견 생성",
    endAt: 60,
  },
  {
    label: "마케팅 리포트 작성",
    hint: "모집단 통계 기반 영업 화법 · 공략 지역 · 비타겟 분석",
    endAt: 75,
  },
];

export function AnalysisProgress({
  stages = DEFAULT_STAGES,
  totalEta,
  title = "분석 진행 중",
}: Props) {
  const eta = totalEta ?? stages[stages.length - 1]?.endAt ?? 30;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t0 = performance.now();
    const interval = setInterval(() => {
      setElapsed((performance.now() - t0) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // 진행률: 95%에서 멈춰 실제 완료 시 100% (완료 시 부모가 컴포넌트 unmount)
  const progress = Math.min(elapsed / eta, 0.95);
  const currentIdx = stages.findIndex((s) => elapsed < s.endAt);
  const activeStage = currentIdx === -1 ? stages.length - 1 : currentIdx;

  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden"
    >
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-title text-ink">⏳ {title}</h2>
          <p className="text-body-sm text-dusty num-tabular">
            {elapsed.toFixed(1)}초 / 약 {eta}초
          </p>
        </div>
        <p className="text-body-sm text-dusty mt-1">
          100만 명 합성 페르소나 전체에 대한 인구통계 분석을 진행합니다
        </p>
      </header>

      {/* 진행 막대 */}
      <div className="px-5 pt-4">
        <div
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 bg-snow border border-parchment rounded-full overflow-hidden"
        >
          <div
            className="h-full bg-terra transition-all duration-200 ease-out"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <p className="text-overline text-stone mt-1 num-tabular text-right">
          {Math.round(progress * 100)}%
        </p>
      </div>

      {/* 단계 리스트 */}
      <ul className="px-5 pb-5 space-y-3">
        {stages.map((s, i) => {
          const isDone = i < activeStage;
          const isActive = i === activeStage;
          return (
            <li key={s.label} className="flex items-start gap-3">
              <StageIcon done={isDone} active={isActive} />
              <div className="flex-1 min-w-0">
                <p
                  className={`text-body-sm font-medium leading-tight transition-colors ${
                    isDone
                      ? "text-stone line-through"
                      : isActive
                        ? "text-ink"
                        : "text-dusty"
                  }`}
                >
                  {s.label}
                  {isActive && (
                    <span className="ml-2 text-terra animate-pulse">●</span>
                  )}
                </p>
                {s.hint && (
                  <p
                    className={`text-caption mt-0.5 ${
                      isActive ? "text-graphite" : "text-stone"
                    }`}
                  >
                    {s.hint}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StageIcon({ done, active }: { done: boolean; active: boolean }) {
  if (done) {
    return (
      <span
        className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-terra/20 border border-terra/40 flex items-center justify-center"
        aria-label="완료"
      >
        <svg
          viewBox="0 0 16 16"
          className="w-3 h-3 text-terra"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      </span>
    );
  }
  if (active) {
    return (
      <span
        className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-azure/40 border border-azure flex items-center justify-center"
        aria-label="진행 중"
      >
        <span className="w-2 h-2 rounded-full bg-ink animate-pulse" />
      </span>
    );
  }
  return (
    <span
      className="shrink-0 mt-0.5 w-5 h-5 rounded-full border border-parchment bg-snow"
      aria-label="대기"
    />
  );
}
