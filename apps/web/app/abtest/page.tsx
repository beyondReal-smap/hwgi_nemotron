"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { ABTestInputForm } from "@/components/abtest/ABTestInputForm";
import { ABTestResultPanel } from "@/components/abtest/ABTestResultPanel";
import { ABTestHistoryList } from "@/components/abtest/ABTestHistoryList";
import { getABTest, type ABTestResponse } from "@/lib/api";

/**
 * /abtest — A/B 두 안 비교 분석 탭.
 *
 * 모드 토글: ?mode=new (새 분석) | ?mode=history (이력)
 * URL state로 동기화 — 새로고침/공유 시에도 모드 유지.
 *
 * /surveys 페이지의 ModeTabs 패턴과 일관성 유지.
 */

type Mode = "new" | "history";

function ABTestContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = (searchParams.get("mode") ?? "new") as Mode;
  const [mode, setMode] = useState<Mode>(initial === "history" ? "history" : "new");

  // 새 분석 결과 또는 이력 상세
  const [result, setResult] = useState<ABTestResponse | null>(null);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 이력 목록 강제 새로고침용 — 새 분석 완료 시 +1
  const [historyReloadKey, setHistoryReloadKey] = useState(0);

  function handleModeChange(next: Mode) {
    setMode(next);
    setError(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", next);
    router.replace(`/abtest?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    const urlMode = searchParams.get("mode");
    if (urlMode === "history" && mode !== "history") setMode("history");
    else if (urlMode === "new" && mode !== "new") setMode("new");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function handleNewResult(r: ABTestResponse) {
    setSelectedHistoryId(null);
    setResult(r);
    // 이력 목록을 미리 갱신해두면 사용자가 history 탭으로 이동할 때 새 항목 노출
    setHistoryReloadKey((k) => k + 1);
  }

  async function handleHistorySelect(id: string) {
    if (id === selectedHistoryId) return;
    setSelectedHistoryId(id);
    setHistoryLoading(true);
    setError(null);
    try {
      const r = await getABTest(id);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  function handleBackToHistoryList() {
    setSelectedHistoryId(null);
    setResult(null);
    setError(null);
  }

  return (
    <main className="flex-1 max-w-[1440px] w-full mx-auto p-3 sm:p-4 lg:p-8">
      <header className="flex flex-col gap-1.5 mb-4 sm:mb-6">
        <p className="text-overline text-dusty">A/B 비교 분석</p>
        <h1 className="text-display text-ink tracking-tight">A/B 테스트</h1>
        <p className="text-body text-graphite">
          {mode === "new"
            ? "두 가지 안을 입력하면 동일 모집단 페르소나 반응을 비교하고, 당사 정보 중심 장단점과 FP 판매·마케팅 전략을 함께 제시합니다."
            : "지금까지 진행한 A/B 비교를 확인하고 상세 리포트를 다시 열 수 있습니다."}
        </p>
      </header>

      {/* 모드 탭 */}
      <div className="flex justify-center">
        <ModeTabs value={mode} onChange={handleModeChange} />
      </div>

      <div className="mt-4">
        {mode === "new" ? (
          <NewMode
            result={result && !selectedHistoryId ? result : null}
            loading={analyzeLoading}
            error={error}
            onResult={handleNewResult}
            onError={setError}
            setLoading={setAnalyzeLoading}
          />
        ) : (
          <HistoryMode
            result={result}
            selectedId={selectedHistoryId}
            loading={historyLoading}
            error={error}
            onSelect={handleHistorySelect}
            onBack={handleBackToHistoryList}
            reloadKey={historyReloadKey}
          />
        )}
      </div>
    </main>
  );
}

export default function ABTestPage() {
  return (
    <div className="min-h-screen bg-vellum text-ink flex flex-col">
      <SiteHeader />
      <Suspense fallback={<div className="flex-1" />}>
        <ABTestContent />
      </Suspense>
      <SiteFooter />
    </div>
  );
}

// ============================================================
// 모드 탭 — /surveys 와 시각적으로 동일
// ============================================================

function ModeTabs({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
}) {
  const tabs: { value: Mode; label: string; sub: string }[] = [
    { value: "new", label: "새 A/B 테스트", sub: "두 안 비교 분석" },
    { value: "history", label: "이력", sub: "지금까지 진행한 비교" },
  ];
  const activeIdx = tabs.findIndex((t) => t.value === value);
  return (
    <div
      role="tablist"
      aria-label="A/B 테스트 모드"
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

// ============================================================
// 새 분석 모드
// ============================================================

function NewMode({
  result,
  loading,
  error,
  onResult,
  onError,
  setLoading,
}: {
  result: ABTestResponse | null;
  loading: boolean;
  error: string | null;
  onResult: (r: ABTestResponse) => void;
  onError: (msg: string | null) => void;
  setLoading: (b: boolean) => void;
}) {
  return (
    <>
      <ABTestInputForm
        onResult={onResult}
        onError={onError}
        loading={loading}
        setLoading={setLoading}
      />

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-[9.6px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6">
          <ABTestResultPanel result={result} />
        </div>
      )}
    </>
  );
}

// ============================================================
// 이력 모드 — 목록 ↔ 상세
// ============================================================

function HistoryMode({
  result,
  selectedId,
  loading,
  error,
  onSelect,
  onBack,
  reloadKey,
}: {
  result: ABTestResponse | null;
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onBack: () => void;
  reloadKey: number;
}) {
  // 상세 모드: 선택된 id가 있고 결과/로딩이 있을 때
  if (selectedId) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-body-sm text-graphite hover:text-ink hover:underline"
        >
          ← 이력 목록으로 돌아가기
        </button>

        {loading && (
          <div className="text-center py-12 text-dusty text-body-sm">
            상세 리포트를 불러오는 중…
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-[9.6px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {error}
          </div>
        )}

        {!loading && result && <ABTestResultPanel result={result} />}
      </div>
    );
  }

  // 목록 모드
  return <ABTestHistoryList onSelect={onSelect} reloadKey={reloadKey} />;
}
