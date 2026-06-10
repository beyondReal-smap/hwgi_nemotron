"use client";

import { useState } from "react";
import { InputForm } from "@/components/InputForm";
import { ScoreCard } from "@/components/ScoreCard";
import { ScoreDriverWaterfall } from "@/components/ScoreDriverWaterfall";
import { SegmentDiscoveryPanel } from "@/components/SegmentDiscoveryPanel";
import { ObjectionPanel } from "@/components/ObjectionPanel";
import { WhatIfLab } from "@/components/WhatIfLab";
import { PersonaList } from "@/components/PersonaList";
import { ReportPanel } from "@/components/ReportPanel";
import { PopulationStatsPanel } from "@/components/PopulationStatsPanel";
import { OpinionInsightsPanel } from "@/components/OpinionInsightsPanel";
import dynamic from "next/dynamic";
import { DistrictTopTable } from "@/components/DistrictTopTable";
import { PastSimulationsPanel } from "@/components/PastSimulationsPanel";
import { NextActionsPanel } from "@/components/NextActionsPanel";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { HistoryList } from "@/components/HistoryList";
import { SiteFooter } from "@/components/SiteHeader";
import { ExecutiveSummary } from "@/components/ExecutiveSummary";
import { TrustPanel } from "@/components/TrustPanel";
import {
  getAnalysis,
  listAnalyses,
  type AnalysisDetail,
  type AnalyzeResponse,
} from "@/lib/api";

// KoreaMap은 topojson-client + Kakao Maps SDK 로더를 포함해 무겁고, 분석 결과가 나온 뒤에만
// 렌더되므로 next/dynamic으로 초기 번들에서 분리한다(ssr:false — Kakao SDK는 브라우저 전용).
const KoreaMap = dynamic(
  () => import("@/components/KoreaMap").then((m) => m.KoreaMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[360px] sm:h-[460px] lg:h-[520px] bg-snow border border-parchment rounded-[9.6px] animate-pulse motion-reduce:animate-none" />
    ),
  },
);

// 임시 숨김(요청): 점수 DNA·고객 반응 핵심(VOC)·이탈 사유 패널.
// true로 바꾸면 즉시 복원된다(import·컴포넌트는 모두 보존).
const SHOW_INSIGHT_PANELS: boolean = false;
// 숨은 황금 세그먼트 — 마케팅 평가 대비 재활성화(2026-06-10 승인). DNA·VOC와 분리 운용.
const SHOW_SEGMENT_PANEL: boolean = true;

// "예시 분석 바로 보기" 시드 — 치아보험 분석(누구나 공감하는 상품 + 뚜렷한 반응층).
// 이력에서 삭제됐다면 최신 이력으로 폴백한다.
const DEMO_ANALYSIS_ID = "1c379239-9021-4f32-ac8d-7c138c4cf0be";

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

  // "예시 분석 바로 보기" — 빈 화면 대신 준비된 시드 분석을 즉시 로드(첫 30초 와우).
  // 시드가 삭제됐으면 최신 이력으로 폴백, 이력 자체가 없으면 안내 에러.
  async function handleShowExample() {
    setHistoryLoading(true);
    setError(null);
    try {
      let detail: AnalysisDetail;
      try {
        detail = await getAnalysis(DEMO_ANALYSIS_ID);
      } catch {
        const list = await listAnalyses(1);
        if (list.items.length === 0) {
          throw new Error(
            "아직 저장된 분석이 없습니다. 왼쪽에 상품 설명을 입력해 첫 분석을 시작해 보세요.",
          );
        }
        detail = await getAnalysis(list.items[0].id);
      }
      setSelectedHistoryId(null);
      setResult(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-3 sm:p-4 lg:p-8">
        <header className="flex flex-col gap-1.5 mb-6">
          <p className="text-overline text-dusty">타겟 페르소나 분석</p>
          <h1 className="text-display text-ink tracking-tight">어떤 타겟에 반응할까</h1>
          <p className="text-body text-graphite">
            상품 설명서나 마케팅 카피로 반응할 타겟과 공략 지역을 찾고, 이전 분석을 다시 열어볼 수 있습니다.
          </p>
        </header>

        {/* 모드 탭 — 제목은 스크롤로 사라지고, 탭은 헤더 바로 아래까지 올라가 sticky 고정 */}
        <div className="sticky top-14 sm:top-16 lg:top-20 z-20 -mx-3 sm:-mx-4 lg:-mx-8 px-3 sm:px-4 lg:px-8 py-2 flex justify-center bg-vellum/90 backdrop-blur border-y border-parchment">
          <ModeTabs value={mode} onChange={handleModeChange} />
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[440px_minmax(0,1fr)] gap-4 sm:gap-5 lg:gap-8">
          {/* 좌측: InputForm 또는 HistoryList */}
          <aside>
            <div className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
              <div className={mode === "new" ? "p-5" : ""}>
                {/* key를 mode로 두어 전환 시 fade-slide 애니메이션이 다시 트리거되도록 */}
                <div
                  key={mode}
                  role="tabpanel"
                  id={`mode-panel-${mode}`}
                  aria-labelledby={`mode-tab-${mode}`}
                  tabIndex={0}
                  className={
                    mode === "new"
                      ? "anim-fade-slide-right"
                      : "anim-fade-slide-left"
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
                <EmptyState mode={mode} onShowExample={handleShowExample} />
              </div>
            )}
            {showResult && result && (
              <>
                <ExecutiveSummary result={result} />
                <ScoreCard result={result} />
                {/* 점수 DNA·고객 반응 핵심(VOC)·이탈 사유 — 요청으로 임시 숨김(SHOW_INSIGHT_PANELS) */}
                {SHOW_INSIGHT_PANELS && (
                  <>
                    <ScoreDriverWaterfall stats={result.population_stats} />
                    <OpinionInsightsPanel
                      opinions={[
                        ...(result.top_opinions ?? []),
                        ...(result.mid_opinions ?? []),
                        ...(result.bottom_opinions ?? []),
                      ]}
                    />
                    <ObjectionPanel
                      personas={result.bottom_personas}
                      opinions={result.bottom_opinions ?? []}
                    />
                  </>
                )}
                <PersonaList
                  personas={result.top_personas}
                  opinions={result.top_opinions ?? []}
                  variant="top"
                />
                {result.mid_personas && result.mid_personas.length > 0 && (
                  <PersonaList
                    personas={result.mid_personas}
                    opinions={result.mid_opinions ?? []}
                    variant="mid"
                  />
                )}
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
                {/* 숨은 황금 세그먼트 — 마이크로 타겟 발굴(마케팅 평가 핵심) */}
                {SHOW_SEGMENT_PANEL && (
                  <SegmentDiscoveryPanel segments={result.segments} />
                )}
                <PopulationStatsPanel stats={result.population_stats} />
                {/* 리포트는 가장 오래 걸리는 단계 — 스트리밍 중이면 스켈레톤, 도착하면 교체 */}
                {result.report_md ? (
                  <ReportPanel markdown={result.report_md} />
                ) : result.analysis_id === "pending" ? (
                  <ReportSkeleton />
                ) : null}
                {/* What-if 실험실 — '다음 분석 제안' 바로 위에 배치. 저장된 분석(analysis_id)이 있어야 재점수 가능 */}
                {result.analysis_id !== "pending" && (
                  <WhatIfLab
                    analysisId={result.analysis_id}
                    baseStats={result.population_stats}
                    baseSellingPoints={result.selling_points}
                  />
                )}
                <NextActionsPanel result={result} />
                {pastSimulations.length > 0 && (
                  <PastSimulationsPanel simulations={pastSimulations} />
                )}
                <TrustPanel />
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
  const tabs: { value: Mode; label: string; sub: string }[] = [
    { value: "new", label: "새 분석", sub: "약관·상품설명서 입력" },
    { value: "history", label: "이력 조회", sub: "과거 분석 다시 보기" },
  ];
  const activeIdx = tabs.findIndex((t) => t.value === value);
  // WAI-ARIA tabs 키보드 패턴: 좌우 화살표로 인접 탭 이동(끝에서 순환)
  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const nextIdx = (activeIdx + dir + tabs.length) % tabs.length;
    onChange(tabs[nextIdx].value);
  }
  return (
    <div
      role="tablist"
      aria-label="분석 모드"
      className="relative inline-grid grid-cols-2 w-full sm:w-auto bg-vellum border border-parchment rounded-[9.6px] p-0.5"
    >
      {/* 슬라이딩 배경 pill — grid가 두 버튼을 균등 분할하므로 width 50% + translateX로 정렬 보장 */}
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 left-0.5 rounded-[7px] bg-snow border border-parchment transition-transform duration-200"
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
            id={`mode-tab-${t.value}`}
            aria-selected={active}
            aria-controls={`mode-panel-${t.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={handleKeyDown}
            className={`relative z-10 px-4 sm:px-5 py-1.5 sm:py-2 rounded-[7px] text-body-sm font-medium transition-colors
                        ${active ? "text-ink" : "text-graphite hover:text-ink"}`}
          >
            <span className="block font-semibold">{t.label}</span>
            <span
              className={`block text-overline mt-0.5 ${active ? "text-graphite" : "text-dusty"}`}
            >
              {t.sub}
            </span>
          </button>
        );
      })}
    </div>
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

function EmptyState({
  mode,
  onShowExample,
}: {
  mode: Mode;
  onShowExample: () => void;
}) {
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
      <button
        type="button"
        onClick={onShowExample}
        className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-[9.6px] border border-terra/40 bg-terra/8 px-5 text-body-sm font-semibold text-terra
                   transition-colors hover:bg-terra/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
      >
        예시 분석 결과 바로 보기
        <span aria-hidden>→</span>
      </button>
      <p className="text-caption text-dusty mt-2">
        입력 없이도 실제 분석 결과 화면을 먼저 둘러볼 수 있습니다.
      </p>
    </div>
  );
}

// 스트리밍 분석에서 리포트 LLM(수십 초)이 도착하기 전 자리표시. 도착하면 ReportPanel로 교체.
function ReportSkeleton() {
  return (
    <section
      className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden"
      aria-busy="true"
      aria-live="polite"
    >
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">AI 리포트</h2>
        <p className="text-body-sm text-dusty mt-1 flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-azure animate-pulse motion-reduce:animate-none" />
          FP·기획자용 종합 리포트를 작성하고 있습니다…
        </p>
      </header>
      <div className="px-4 py-4 sm:px-5 sm:py-5 space-y-2.5">
        {["w-3/4", "w-full", "w-5/6", "w-2/3", "w-full", "w-1/2"].map((w, i) => (
          <div
            key={i}
            className={`h-3.5 ${w} rounded bg-snow border border-parchment animate-pulse motion-reduce:animate-none`}
          />
        ))}
      </div>
    </section>
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
