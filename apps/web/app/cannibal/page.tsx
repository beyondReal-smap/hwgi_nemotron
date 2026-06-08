"use client";

import { useState } from "react";
import { SiteFooter } from "@/components/SiteHeader";
import { CannibalInputForm } from "@/components/cannibal/CannibalInputForm";
import { CannibalHistoryList } from "@/components/cannibal/CannibalHistoryList";
import { CannibalMatrix } from "@/components/cannibal/CannibalMatrix";
import { CoverageTab } from "@/components/cannibal/CoverageTab";
import { MultiplicityTab } from "@/components/cannibal/MultiplicityTab";
import { ExclusiveTab } from "@/components/cannibal/ExclusiveTab";
import { ResultTabs, type ResultTab } from "@/components/cannibal/ResultTabs";
import { getCannibal, type CannibalResponse } from "@/lib/api";

/**
 * /cannibal — 겹침 분석.
 *
 * 모드 토글: 새 겹침 분석 | 이력(mode=new|history). A/B 테스트와 동일 패턴.
 * 결과는 두 모드 공통으로 ResultTabs(겹침행렬/커버리지/노출분포/전용층)로 표시.
 */
type Mode = "new" | "history";

export default function CannibalPage() {
  const [mode, setMode] = useState<Mode>("new");
  const [result, setResult] = useState<CannibalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ResultTab>("matrix");
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  function handleNewResult(r: CannibalResponse) {
    setSelectedHistoryId(null);
    setResult(r);
    setTab("matrix");
    // 새 분석 완료 시 이력 목록을 미리 갱신
    setHistoryReloadKey((k) => k + 1);
  }

  async function handleHistorySelect(id: string) {
    if (id === selectedHistoryId) return;
    setSelectedHistoryId(id);
    setError(null);
    setLoading(true);
    try {
      const r = await getCannibal(id);
      setResult(r);
      setTab("matrix");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function handleModeChange(next: Mode) {
    setMode(next);
    setError(null);
  }

  // 결과는 현재 모드에 맞을 때만 표시:
  //  · 새 분석 모드 → 새 분석 결과(selectedHistoryId 없음)
  //  · 이력 모드 → 이력 선택 결과(selectedHistoryId 있음)
  // 이력을 보다가 '새 겹침 분석'으로 전환하면 이력 결과가 자동으로 사라진다.
  const inMatchingMode =
    (mode === "new" && !selectedHistoryId) ||
    (mode === "history" && !!selectedHistoryId);

  return (
    <div className="min-h-screen bg-vellum text-ink flex flex-col">
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-3 sm:p-4 lg:p-8">
        <header className="flex flex-col gap-1.5 mb-4 sm:mb-6">
          <p className="text-overline text-dusty">여러 안 비교 분석</p>
          <h1 className="text-display text-ink tracking-tight">겹침 분석</h1>
          <p className="text-body text-graphite">
            여러 안(컨셉·카피·상품)을 동일한 100만 페르소나 모집단에 스코어링해, 안끼리 같은
            반응층을 노리는지(잠식) 혹은 서로 다른 층을 덮는지(보완)를 진단합니다.
          </p>
        </header>

        {/* 모드 탭 — 새 분석 / 이력 */}
        <div className="sticky top-14 sm:top-16 lg:top-20 z-20 -mx-3 sm:-mx-4 lg:-mx-8 px-3 sm:px-4 lg:px-8 py-2 flex justify-center bg-vellum/90 backdrop-blur border-y border-parchment">
          <ModeTabs value={mode} onChange={handleModeChange} />
        </div>

        <div className="mt-4 space-y-6">
          {mode === "new" ? (
            <CannibalInputForm
              onResult={handleNewResult}
              onError={setError}
              loading={loading}
              setLoading={setLoading}
            />
          ) : (
            <CannibalHistoryList
              onSelect={handleHistorySelect}
              reloadKey={historyReloadKey}
            />
          )}

          {error && (
            <div
              className="rounded-[9.6px] border border-danger/30 bg-danger/5 px-4 py-3 text-body-sm text-danger"
              aria-live="assertive"
            >
              {error}
            </div>
          )}

          {result && !loading && inMatchingMode && (
            <div className="space-y-4">
              <ResultTabs value={tab} onChange={setTab} />
              <div>
                {tab === "matrix" && <CannibalMatrix data={result} />}
                {tab === "coverage" && <CoverageTab data={result} />}
                {tab === "multiplicity" && <MultiplicityTab data={result} />}
                {tab === "exclusive" && <ExclusiveTab data={result} />}
              </div>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function ModeTabs({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
}) {
  const tabs: { value: Mode; label: string; sub: string }[] = [
    { value: "new", label: "새 겹침 분석", sub: "여러 안 비교" },
    { value: "history", label: "이력", sub: "지금까지 분석" },
  ];
  const activeIdx = tabs.findIndex((t) => t.value === value);
  return (
    <div
      role="tablist"
      aria-label="겹침 분석 모드"
      className="relative inline-grid grid-cols-2 w-full sm:w-auto bg-vellum border border-parchment rounded-[9.6px] p-0.5"
    >
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
            aria-selected={active}
            onClick={() => onChange(t.value)}
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
