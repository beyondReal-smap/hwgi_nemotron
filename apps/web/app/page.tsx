"use client";

import { useState } from "react";
import { InputForm } from "@/components/InputForm";
import { ScoreCard } from "@/components/ScoreCard";
import { PersonaList } from "@/components/PersonaList";
import { ReportPanel } from "@/components/ReportPanel";
import { PopulationStatsPanel } from "@/components/PopulationStatsPanel";
import { KoreaMap } from "@/components/KoreaMap";
import { DistrictTopTable } from "@/components/DistrictTopTable";
import {
  PastSimulationsPanel,
  SurveyCta,
} from "@/components/PastSimulationsPanel";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { HistoryList } from "@/components/HistoryList";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";
import {
  getAnalysis,
  type AnalysisDetail,
  type AnalyzeResponse,
} from "@/lib/api";

type Mode = "new" | "history";

export default function Page() {
  const [mode, setMode] = useState<Mode>("new");
  // 새 분석 결과(AnalyzeResponse) 또는 이력 상세(AnalysisDetail).
  // 두 타입 모두 AnalyzeResponse의 필드를 공유하므로 union으로.
  const [result, setResult] = useState<AnalyzeResponse | AnalysisDetail | null>(
    null,
  );
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 새 분석 완료 시 — 이력 선택 상태 초기화하여 카드 표시 일관 유지
  function handleNewResult(r: AnalyzeResponse) {
    setSelectedHistoryId(null);
    setResult(r);
  }

  // 이력 항목 선택 시 — 상세 fetch 후 결과 영역에 표시
  async function handleHistorySelect(id: string) {
    if (id === selectedHistoryId) return;
    setSelectedHistoryId(id);
    setHistoryLoading(true);
    setError(null);
    try {
      const detail = await getAnalysis(id);
      setResult(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  // 모드 전환 시 result는 유지하되, 모드 일관성을 위해 선택 상태 정리
  function handleModeChange(next: Mode) {
    setMode(next);
    setError(null);
  }

  // 이력에서 항목이 삭제되었을 때 — 현재 보고 있던 분석이면 결과 영역 정리
  function handleHistoryDeleted(id: string) {
    if (id === selectedHistoryId) {
      setSelectedHistoryId(null);
      setResult(null);
    }
  }

  // 전체 삭제 — 무조건 결과 영역 비움
  function handleHistoryDeletedAll() {
    setSelectedHistoryId(null);
    setResult(null);
  }

  const showResult = !analyzeLoading && !historyLoading && !!result;
  const showEmpty =
    !analyzeLoading && !historyLoading && !result && !error;
  const pastSimulations =
    result && "simulations" in result ? result.simulations ?? [] : [];

  return (
    <div className="min-h-screen bg-vellum text-ink flex flex-col">
      <SiteHeader />

      <main className="flex-1 max-w-[1440px] w-full mx-auto p-3 sm:p-4 lg:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-[440px_minmax(0,1fr)] gap-4 sm:gap-5 lg:gap-8">
          {/* 좌측: 모드 탭 + InputForm 또는 HistoryList */}
          <aside className="lg:sticky lg:top-24 lg:self-start lg:h-[calc(100vh-7rem)]">
            <div className="bg-vellum border border-parchment rounded-[9.6px] lg:h-full flex flex-col overflow-hidden">
              <ModeTabs value={mode} onChange={handleModeChange} />

              <div
                className={`flex-1 min-h-0 ${
                  mode === "new" ? "p-5 lg:overflow-y-auto" : ""
                }`}
              >
                {/* key를 mode로 두어 전환 시 fade-slide 애니메이션이 다시 트리거되도록 */}
                <div
                  key={mode}
                  className={
                    mode === "new"
                      ? "anim-fade-slide-right h-full"
                      : "anim-fade-slide-left h-full"
                  }
                >
                  {mode === "new" ? (
                    <InputForm
                      onResult={handleNewResult}
                      onLoadingChange={setAnalyzeLoading}
                      onError={setError}
                    />
                  ) : (
                    <HistoryList
                      selectedId={selectedHistoryId}
                      onSelect={handleHistorySelect}
                      onDeleted={handleHistoryDeleted}
                      onDeletedAll={handleHistoryDeletedAll}
                    />
                  )}
                </div>
              </div>
            </div>
          </aside>

          {/* 우측: 결과 */}
          <section className="flex flex-col gap-5 min-w-0">
            {error && (
              <div className="anim-fade-slide-up">
                <ErrorBanner message={error} />
              </div>
            )}
            {analyzeLoading && (
              <div className="anim-fade-in">
                <AnalysisProgress />
              </div>
            )}
            {historyLoading && (
              <div className="anim-fade-in">
                <HistoryLoading />
              </div>
            )}
            {showEmpty && (
              <div key={`empty-${mode}`} className="anim-fade-slide-up">
                <EmptyState mode={mode} />
              </div>
            )}
            {showResult && result && (
              <>
                <ScoreCard result={result} />
                <PersonaList
                  personas={result.top_personas}
                  opinions={result.top_opinions ?? []}
                  variant="top"
                />
                {result.bottom_personas &&
                  result.bottom_personas.length > 0 && (
                    <PersonaList
                      personas={result.bottom_personas}
                      opinions={result.bottom_opinions ?? []}
                      variant="bottom"
                    />
                  )}
                {result.population_stats?.districts_full &&
                  result.population_stats.districts_full.length > 0 && (
                    <>
                      <KoreaMap
                        districts={result.population_stats.districts_full}
                      />
                      <DistrictTopTable
                        districts={result.population_stats.districts_full}
                      />
                    </>
                  )}
                <PopulationStatsPanel stats={result.population_stats} />
                <ReportPanel markdown={result.report_md} />
                <SurveyCta analysisId={result.analysis_id} />
                {pastSimulations.length > 0 && (
                  <PastSimulationsPanel simulations={pastSimulations} />
                )}
              </>
            )}
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

// ============================================================
// 모드 탭 — 좌측 컬럼 상단 세그먼트 토글
// ============================================================

function ModeTabs({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
}) {
  // active indicator가 두 탭 사이를 슬라이드하도록 — 컨테이너에 단일 막대 배치
  return (
    <div
      role="tablist"
      aria-label="좌측 패널 모드"
      className="relative grid grid-cols-2 border-b border-parchment bg-snow shrink-0"
    >
      <ModeTab
        active={value === "new"}
        onClick={() => onChange("new")}
        label="새 분석"
        hint="약관·상품설명서 입력"
      />
      <ModeTab
        active={value === "history"}
        onClick={() => onChange("history")}
        label="이력 조회"
        hint="과거 분석 다시 보기"
      />
      {/* 슬라이딩 indicator — 50% 너비 막대가 좌/우로 translateX */}
      <span
        aria-hidden
        className="tab-active-pill pointer-events-none absolute -bottom-[1px] left-0 h-[2px] w-1/2 px-3"
        style={{
          transform: `translateX(${value === "new" ? "0%" : "100%"})`,
        }}
      >
        <span className="block h-full w-full rounded-full bg-terra" />
      </span>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={`${label} — ${hint}`}
      onClick={onClick}
      className={`relative min-h-[48px] px-3 sm:px-4 py-3 text-left transition-[color,background-color] duration-200 ease-out
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-azure
                  ${
                    active
                      ? "bg-vellum text-ink"
                      : "text-graphite hover:bg-vellum/60 hover:text-ink"
                  }`}
    >
      <p
        className={`text-body-sm leading-tight truncate transition-[font-weight,color] duration-200 ${
          active ? "font-semibold" : "font-medium"
        }`}
      >
        {label}
      </p>
      {/* hint(부제) — 모바일에서는 숨김, sm+ 에서만 노출 */}
      <p className="hidden sm:block text-caption text-dusty mt-0.5 leading-tight truncate">
        {hint}
      </p>
    </button>
  );
}

// ============================================================
// 보조 컴포넌트
// ============================================================

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="bg-terra/10 border border-terra/30 text-ink rounded-[9.6px] p-5"
    >
      <p className="text-heading font-semibold mb-1">
        분석 중 문제가 발생했습니다
      </p>
      <p className="text-body-sm text-graphite">{message}</p>
    </div>
  );
}

function EmptyState({ mode }: { mode: Mode }) {
  if (mode === "history") {
    return (
      <div className="border border-dashed border-parchment rounded-[9.6px] p-10 sm:p-16 text-center bg-vellum">
        <div className="mx-auto mb-5 h-10 w-10 rounded-full border border-azure bg-azure/30" />
        <p className="text-title text-ink">왼쪽에서 분석 이력을 선택하세요.</p>
        <p className="text-body-sm text-dusty mt-2">
          과거 분석 결과·페르소나·시뮬레이션을 다시 확인할 수 있습니다.
        </p>
      </div>
    );
  }
  return (
    <div className="border border-dashed border-parchment rounded-[9.6px] p-10 sm:p-16 text-center bg-vellum">
      <div className="mx-auto mb-5 h-10 w-10 rounded-full border border-terra/30 bg-terra/10" />
      <p className="text-title text-ink">
        왼쪽에 상품설명서·약관을 입력하고 분석을 시작하세요.
      </p>
      <p className="text-body-sm text-dusty mt-2">
        파일 업로드 (TXT · PDF · DOCX · HWP · HWPX) 또는 직접 붙여넣기 모두
        가능합니다.
      </p>
    </div>
  );
}

function HistoryLoading() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="h-24 bg-vellum border border-parchment rounded-[9.6px] animate-pulse" />
      <div className="h-64 bg-vellum border border-parchment rounded-[9.6px] animate-pulse" />
      <div className="h-96 bg-vellum border border-parchment rounded-[9.6px] animate-pulse" />
      <p className="text-center text-body-sm text-dusty">
        이력 상세를 불러오는 중...
      </p>
    </div>
  );
}
