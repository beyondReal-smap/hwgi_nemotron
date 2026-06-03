"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SiteFooter } from "@/components/SiteHeader";
import { WizardContainer } from "@/components/wizard/WizardContainer";
import { SurveyHistoryList } from "@/components/SurveyHistoryList";

/**
 * /surveys — 설문 통합 페이지.
 *
 * 모드 토글: ?mode=new (마법사) | ?mode=history (이력 목록)
 * URL state로 동기화 — 새로고침/공유 시에도 모드 유지.
 *
 * 분석 탭(/)의 ModeTabs 패턴과 일관성 유지.
 */

type Mode = "new" | "history";

function SurveysContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = (searchParams.get("mode") ?? "new") as Mode;
  const [mode, setMode] = useState<Mode>(initial === "history" ? "history" : "new");

  // 모드 변경 → URL 동기화
  function handleModeChange(next: Mode) {
    setMode(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", next);
    router.replace(`/surveys?${params.toString()}`, { scroll: false });
  }

  // URL ?mode= 변경 시 → state 동기화 (브라우저 back/forward 대응)
  useEffect(() => {
    const urlMode = searchParams.get("mode");
    if (urlMode === "history" && mode !== "history") setMode("history");
    else if (urlMode === "new" && mode !== "new") setMode("new");
    // mode를 deps에 두면 무한 루프 발생 가능 — eslint disable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <main className="flex-1 max-w-[1440px] w-full mx-auto p-3 sm:p-4 lg:p-8">
      {/* 페이지 헤더 */}
      <header className="flex flex-col gap-1.5 mb-4 sm:mb-6">
        <p className="text-overline text-dusty">설문 시뮬레이션</p>
        <h1 className="text-display text-ink tracking-tight">설문 만들기 · 이력</h1>
        <p className="text-body text-graphite">
          {mode === "new"
            ? "대상 페르소나를 선별하고 질문을 설계하면, LLM이 각 페르소나의 입장에서 응답을 생성합니다."
            : "지금까지 만든 설문을 확인하고 응답·리포트로 이동할 수 있습니다."}
        </p>
      </header>

      {/* 모드 탭 — 제목은 스크롤로 사라지고, 탭은 헤더 바로 아래까지 올라가 sticky 고정 */}
      <div className="sticky top-14 sm:top-16 lg:top-20 z-20 -mx-3 sm:-mx-4 lg:-mx-8 px-3 sm:px-4 lg:px-8 py-2 flex justify-center bg-vellum/90 backdrop-blur border-y border-parchment">
        <ModeTabs value={mode} onChange={handleModeChange} />
      </div>

      {/* 컨텐츠 — mode 변경 시 key 교체로 fade-slide.
          콘텐츠(마법사·이력)가 짧아도 탭이 헤더 바로 아래까지 올라가도록 최소 높이로 스크롤 공간 확보.
          값 ≈ 100dvh − (헤더 + 탭 바). 정확히 맞으면 탭이 헤더에 붙는 시점에 스크롤이 끝나 콘텐츠가 탭 뒤로 가려지지 않는다. */}
      <div className="mt-4 min-h-[calc(100dvh-8rem)] lg:min-h-[calc(100dvh-9.5rem)]">
        <div
          key={mode}
          className={
            mode === "new" ? "anim-fade-slide-right" : "anim-fade-slide-left"
          }
        >
          {mode === "new" ? <WizardContainer /> : <SurveyHistoryList />}
        </div>
      </div>
    </main>
  );
}

export default function SurveysPage() {
  return (
    <div className="min-h-screen bg-vellum text-ink flex flex-col">
      <Suspense fallback={<div className="flex-1" />}>
        <SurveysContent />
      </Suspense>
      <SiteFooter />
    </div>
  );
}

// ============================================================
// 모드 탭 — 분석 탭(/)의 ModeTabs와 시각적으로 동일
// ============================================================

function ModeTabs({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
}) {
  const tabs: { value: Mode; label: string; sub: string }[] = [
    { value: "new", label: "새 설문 만들기", sub: "4단계 마법사" },
    { value: "history", label: "설문 이력", sub: "지금까지 만든 설문" },
  ];
  const activeIdx = tabs.findIndex((t) => t.value === value);
  return (
    <div
      role="tablist"
      aria-label="설문 모드"
      className="relative inline-grid grid-cols-2 w-full sm:w-auto bg-vellum border border-parchment rounded-[9.6px] p-0.5"
    >
      {/* 슬라이딩 배경 pill — grid가 두 버튼을 균등 분할하므로 width 50% + translateX로 정렬 보장 */}
      <span
        aria-hidden
        className="tab-active-pill absolute top-0.5 bottom-0.5 left-0.5 rounded-[7px]
                   bg-snow border border-parchment"
        style={{
          width: `calc((100% - 0.25rem) / ${tabs.length})`,
          transform: `translateX(${activeIdx * 100}%)`,
        }}
      />
      {tabs.map((t) => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={`relative z-[1] min-h-[44px] w-full
                        px-4 sm:px-6 py-2 text-body-sm rounded-[7px] text-center
                        transition-[color,font-weight,transform] duration-200 ease-out
                        active:scale-[0.97] motion-reduce:active:scale-100
                        ${
                          active
                            ? "text-ink font-medium"
                            : "text-graphite hover:text-ink"
                        }`}
            title={t.sub}
          >
            <span className="truncate block">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
