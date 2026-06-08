"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiteFooter } from "@/components/SiteHeader";
import { CountUp } from "@/components/CountUp";
import { PersonaFilterPanel } from "@/components/PersonaFilterPanel";
import { PersonaCardGrid } from "@/components/PersonaCardGrid";
import { PersonaDetailModal } from "@/components/PersonaDetailModal";
import { SaveSegmentModal } from "@/components/SaveSegmentModal";
import { DemographicCard, recordToBins } from "@/components/DistributionCharts";
import {
  ADDITIONAL_FILTER_LABELS,
  filterPersonas,
  getPersonaFacets,
  type ExtractedFilter,
  type PersonaFacets,
  type PersonaFilterRequest,
  type PersonaFilterResponse,
  type Segment,
} from "@/lib/api";

/**
 * /personas — 페르소나 탐색 페이지.
 *
 * 흐름:
 *  - 좌 사이드바: PersonaFilterPanel
 *  - 우 메인:
 *      - 상단 메타 (필터 통과 N명 + 페이지 정보 + 카드/테이블 토글)
 *      - 분포 미니 카드 3종 (성별/연령대/시도)
 *      - 결과 그리드/테이블
 *      - 페이지네이션
 *      - 선택 카운터 + 세그먼트 저장 CTA (part2에서 wire-up)
 *
 * 디자인 원칙:
 *  - 모든 섹션은 SectionCard 헤더 패턴 (bg-snow + border-b border-parchment)
 *  - 한화 토큰만 사용
 *  - 필터 변경 시 300ms 디바운스 후 API 호출
 *  - 페이지 변경은 즉시
 */

const PAGE_SIZE = 24;

// 전체 모집단(스캔 대상 행 수). 백엔드 filter 응답엔 전체 행 필드가 없어 데이터셋 메타와
// 동일한 상수를 funnel 1단계(분모)로 사용한다. — DatasetMeta.total_rows와 일치.
const TOTAL_POPULATION = 1_000_000;

// 원클릭 예시 쿼리 — 클릭 시 query 주입 + 디바운스 useEffect가 자동 검색 실행.
const EXAMPLE_QUERIES = [
  "은퇴 후 등산 좋아하는 60대 남성",
  "수도권 워킹맘",
  "MZ 1인가구",
  "대학생 자취 1인가구",
];

const INITIAL_FILTER: PersonaFilterRequest = {
  age_min: null,
  age_max: null,
  sex: [],
  provinces: [],
  family_types: [],
  education_levels: [],
  occupations: [],
  query: null,
  page: 1,
  page_size: PAGE_SIZE,
};

export default function PersonasPage() {
  const [filter, setFilter] = useState<PersonaFilterRequest>(INITIAL_FILTER);
  const [facets, setFacets] = useState<PersonaFacets | null>(null);
  const [result, setResult] = useState<PersonaFilterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 자연어 검색은 cold 시 수십 초 걸릴 수 있어 경과 시간을 노출 — 사용자가
  // 멈춘 줄 오해하지 않도록 진행 상태를 가시화.
  const [loadingElapsedMs, setLoadingElapsedMs] = useState(0);
  const loadingStartRef = useRef<number | null>(null);
  const [view, setView] = useState<"card" | "table">("card");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailUuid, setDetailUuid] = useState<string | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  // 1) 페이셋 로드 (1회)
  useEffect(() => {
    getPersonaFacets()
      .then(setFacets)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // 1-b) 코파일럿 등에서 ?q=... 로 진입 시 초기 검색어 주입 → 디바운스 useEffect가 자동 검색.
  //      디바운스 타이머가 첫 렌더(INITIAL)에서 걸렸어도 setFilter 리렌더가 cleanup→재설정하므로
  //      q 반영본으로 1회만 검색된다. window 접근은 클라이언트 전용이라 useEffect에서 안전.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setFilter((f) => ({ ...f, query: q, page: 1 }));
  }, []);

  // 2) 필터 변경 → 디바운스 후 fetch.
  //    빠른 연속 입력 시 LLM 추출 시간 차이로 stale 응답이 마지막에 도착해 결과를 덮어쓰는
  //    race condition을 token ref로 방지 (이전 호출의 응답은 무시).
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const filterTokenRef = useRef(0);
  const runFilter = useCallback(async (req: PersonaFilterRequest) => {
    const token = ++filterTokenRef.current;
    setLoading(true);
    setError(null);
    loadingStartRef.current = Date.now();
    setLoadingElapsedMs(0);
    try {
      const r = await filterPersonas(req);
      if (token !== filterTokenRef.current) return; // stale 무시
      setResult(r);
    } catch (e) {
      if (token !== filterTokenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === filterTokenRef.current) {
        setLoading(false);
        loadingStartRef.current = null;
      }
    }
  }, []);

  // 로딩 중 경과 시간 갱신 (0.5초 tick) — 자연어 검색이 cold 시 길어질 때
  // 사용자에게 진행 중임을 보여주기 위함.
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => {
      if (loadingStartRef.current !== null) {
        setLoadingElapsedMs(Date.now() - loadingStartRef.current);
      }
    }, 500);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runFilter(filter), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filter, runFilter]);

  function handleReset() {
    setFilter(INITIAL_FILTER);
    setSelected(new Set());
  }

  // 예시 쿼리 칩 클릭 — query만 주입하고 page를 1로. 디바운스 useEffect가 자동 검색.
  function applyExampleQuery(q: string) {
    setFilter((prev) => ({ ...prev, query: q, page: 1 }));
  }

  // PersonaCardItem(memo)의 onToggle prop이 매 렌더 새 참조가 되지 않도록 useCallback.
  // 함수형 setState로 selected 의존성을 없애 참조를 영구 고정한다.
  const toggleSelect = useCallback((uuid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }, []);

  function selectAllOnPage() {
    if (!result) return;
    const next = new Set(selected);
    for (const p of result.page_personas) next.add(p.uuid);
    setSelected(next);
  }
  function clearSelection() {
    setSelected(new Set());
  }

  const totalPages = useMemo(() => {
    if (!result) return 0;
    return Math.max(1, Math.ceil(result.total / result.page_size));
  }, [result]);

  return (
    <div className="min-h-screen bg-vellum text-ink flex flex-col">
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 lg:p-8">
        {/* 페이지 헤더 */}
        <header className="flex flex-col gap-1.5 mb-6">
          <p className="text-overline text-dusty">페르소나 탐색</p>
          <h1 className="text-display text-ink tracking-tight">조건에 맞는 페르소나 찾기</h1>
          <p className="text-body text-graphite">
            메타데이터 필터와 자연어 조건을 조합해 100만 페르소나에서 그룹을 추려냅니다.
            <span className="block mt-1 text-body-sm text-dusty">
              각 카드 좌상단 <span className="text-graphite">체크박스</span>로 선택 → 하단의{" "}
              <span className="text-graphite">&lsquo;세그먼트로 저장&rsquo;</span> 버튼을 누르면 설문 마법사에서 불러올 수 있습니다.
            </span>
          </p>
        </header>

        {/* 좌 필터 / 우 결과 — 12-col grid */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* 좌 사이드바 */}
          <div className="xl:col-span-3 xl:sticky xl:top-24 xl:self-start xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
            <PersonaFilterPanel
              facets={facets}
              value={filter}
              onChange={setFilter}
              onReset={handleReset}
            />
          </div>

          {/* 우 메인 */}
          <div className="xl:col-span-9 flex flex-col gap-4">
            {/* === 박스 1: 매칭 요약 (메타 + 분포) === */}
            <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
              <header className="bg-snow border-b border-parchment px-5 py-4">
                <h2 className="text-title text-ink">
                  {loading ? (
                    <>
                      검색 중
                      <span className="text-graphite font-mono ml-2 tabular-nums">
                        {(loadingElapsedMs / 1000).toFixed(1)}s
                      </span>
                      <span className="ml-1 inline-block animate-pulse">…</span>
                    </>
                  ) : result ? (
                    `매칭 요약 · ${result.total.toLocaleString()}명`
                  ) : (
                    "매칭 요약"
                  )}
                </h2>
                {loading && loadingElapsedMs >= 5000 && (
                  <p className="text-caption text-graphite mt-1 leading-snug">
                    {filter.query
                      ? "자연어 임베딩 검색 진행 중 — 첫 호출은 임베딩 매트릭스 워밍업으로 최대 1분까지 걸릴 수 있습니다. 같은 조건 재검색은 1초 이내."
                      : "데이터 적재 중 — 잠시만 기다려 주세요."}
                  </p>
                )}
                <p className="text-body-sm text-dusty mt-1">
                  {result ? (
                    <>
                      {result.fallback_applied ? (
                        <>
                          {result.meta_filter_total > 0 ? (
                            <>
                              메타 일치{" "}
                              <span className="font-mono text-graphite">
                                {result.meta_filter_total.toLocaleString()}
                              </span>
                              명 → 일부 조건 완화 후{" "}
                            </>
                          ) : (
                            <>
                              메타 조건 매칭{" "}
                              <span className="font-mono text-graphite">0</span>
                              명 →{" "}
                            </>
                          )}
                          <span className="text-graphite">시멘틱 폴백</span>으로{" "}
                          <span className="font-mono text-graphite">
                            {result.total.toLocaleString()}
                          </span>
                          명 매칭 · 결과는 유사도 내림차순 · 소요{" "}
                          <span className="font-mono">
                            {(result.elapsed_ms.total / 1000).toFixed(2)}초
                          </span>
                        </>
                      ) : result.has_query && result.match_threshold !== null ? (
                        <>
                          메타 일치{" "}
                          <span className="font-mono text-graphite">
                            {result.meta_filter_total.toLocaleString()}
                          </span>
                          명 → 잔여 키워드 임베딩{" "}
                          <span className="font-mono text-graphite">
                            ≥{result.match_threshold.toFixed(1)}
                          </span>{" "}
                          통과{" "}
                          <span className="font-mono text-graphite">
                            {result.total.toLocaleString()}
                          </span>
                          명 · 아래 분포는 이 매칭 그룹 기준
                        </>
                      ) : result.has_query ? (
                        <>
                          자연어 메타 추출 조건에 모두 흡수되어 의미 컷은 적용되지 않았습니다 ·
                          결과는 유사도 내림차순 · 소요{" "}
                          <span className="font-mono">
                            {(result.elapsed_ms.total / 1000).toFixed(2)}초
                          </span>
                        </>
                      ) : (
                        <>
                          필터 조건에 매칭된 그룹 분포 · 소요{" "}
                          <span className="font-mono">
                            {(result.elapsed_ms.total / 1000).toFixed(2)}초
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    "필터를 조정하면 매칭 분포가 갱신됩니다"
                  )}
                </p>

                {/* 폴백 적용 시 사유 배지 — 사용자에게 결과가 메타 기반이 아닌 폴백 결과임을 투명하게 노출 */}
                {result?.fallback_applied && result.fallback_reason && (
                  <div className="mt-2 inline-flex items-start gap-1.5 px-2.5 py-1.5 bg-azure/10 border border-azure/30 rounded-[7px]">
                    <span className="text-overline text-azure shrink-0 mt-0.5">폴백</span>
                    <span className="text-caption text-graphite leading-snug">
                      {result.fallback_reason}
                    </span>
                  </div>
                )}

                {/* AI 자동 추출 메타 칩 — 자연어 쿼리가 LLM으로 분해된 결과 */}
                {result?.extracted_filter && (
                  <ExtractedFilterChips ex={result.extracted_filter} />
                )}

                {/* 원클릭 예시 쿼리 — 검색어가 비었을 때만 노출(이미 입력 중이면 방해 안 함). */}
                {!loading && !filter.query && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-overline text-dusty mr-1">예시 검색</span>
                    {EXAMPLE_QUERIES.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => applyExampleQuery(q)}
                        className="inline-flex items-center text-caption px-2.5 py-1 bg-snow border border-marine/40 text-marine
                                   rounded-full hover:bg-marine/10 hover:border-marine transition-colors
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}

                {/* 스캔 깔때기(funnel) — 100만 행을 매 검색마다 훑는다는 사실을 정직하게 시각화.
                    백엔드가 보내주는 meta_filter_total/total/elapsed_ms를 살린다(추측 수치 없음). */}
                {!loading && result && (
                  <ScanFunnel result={result} />
                )}
              </header>

              {/* 분포 차트 5종 — 현황(overview)과 동일한 DemographicCard 재사용.
                  매칭 결과 전체 기준 집계(페이지 슬라이스 전). 빈 결과면 안내.
                  로딩 중에는 이전 결과를 덮어쓰지 않고 스켈레톤 표시 → 데이터 확정 후에만 차트 렌더. */}
              {loading ? (
                <ChartSkeleton />
              ) : result && result.total > 0 ? (
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <DemographicCard
                    dem={{
                      column: "sex",
                      label: "성별",
                      bins: recordToBins(result.distribution.sex),
                    }}
                  />
                  <DemographicCard
                    dem={{
                      column: "age_dist",
                      label: "연령대",
                      bins: result.distribution.age_bins,
                    }}
                  />
                  <DemographicCard
                    dem={{
                      column: "province",
                      label: "시도",
                      bins: recordToBins(result.distribution.province, 12),
                    }}
                  />
                  <DemographicCard
                    dem={{
                      column: "occupation",
                      label: "직업군",
                      bins: result.distribution.occupations_grouped
                        .slice(0, 12)
                        .map((g) => ({ label: g.group, count: g.count })),
                    }}
                  />
                  <DemographicCard
                    dem={{
                      column: "family_type",
                      label: "가구 형태",
                      bins: result.distribution.family_type,
                    }}
                  />
                  <DemographicCard
                    dem={{
                      column: "housing_type",
                      label: "주거 형태",
                      bins: result.distribution.housing_type,
                    }}
                  />
                </div>
              ) : result && result.total === 0 ? (
                <div className="p-6 text-center text-body-sm text-graphite">
                  조건에 매칭되는 페르소나가 없습니다. 필터를 완화하거나 자연어 조건을 바꿔보세요.
                </div>
              ) : null}
            </section>

            {/* 에러 */}
            {error && (
              <div role="alert" className="bg-terra/10 border border-terra/30 text-ink px-4 py-3 rounded-[9.6px]">
                <p className="font-medium mb-1">결과를 불러오지 못했습니다</p>
                <p className="text-caption text-graphite">{error}</p>
              </div>
            )}

            {/* === 박스 2: 매칭된 페르소나 리스트 === */}
            <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
              <header className="bg-snow border-b border-parchment px-5 py-4 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h2 className="text-title text-ink">매칭된 페르소나</h2>
                  <p className="text-body-sm text-dusty mt-1">
                    {result && result.total > 0 ? (
                      <>
                        페이지{" "}
                        <span className="font-mono text-graphite">{result.page}</span>
                        {" / "}
                        <span className="font-mono text-graphite">{totalPages}</span>
                        {" · "}
                        <span className="font-mono text-graphite">
                          {((result.page - 1) * result.page_size + 1).toLocaleString()}
                        </span>
                        {"~"}
                        <span className="font-mono text-graphite">
                          {Math.min(
                            result.page * result.page_size,
                            result.total,
                          ).toLocaleString()}
                        </span>
                        {"번째 / 총 "}
                        <span className="font-mono text-graphite">
                          {result.total.toLocaleString()}
                        </span>
                        명
                        {result.has_query && " · 유사도 내림차순"}
                      </>
                    ) : (
                      "조건을 만족하는 페르소나가 표시됩니다"
                    )}
                  </p>
                </div>
                <ViewToggle value={view} onChange={setView} />
              </header>

              <div className="p-4 flex flex-col gap-4">
                {/* 차트와 동일하게 매 검색마다 스켈레톤 → 데이터 확정 후에만 카드 렌더 */}
                {loading ? (
                  <ResultSkeleton />
                ) : (
                  result && (
                    <PersonaCardGrid
                      view={view}
                      personas={result.page_personas}
                      selected={selected}
                      onToggle={toggleSelect}
                      onOpenDetail={setDetailUuid}
                      hasQuery={result.has_query}
                    />
                  )
                )}

                {/* 페이지네이션 */}
                {result && result.total > 0 && (
                  <Pagination
                    page={result.page}
                    totalPages={totalPages}
                    onChange={(p) => setFilter({ ...filter, page: p })}
                  />
                )}
              </div>
            </section>
          </div>
        </div>

        {/* 선택 액션 바 — sticky 하단. 빈 상태에서도 항상 노출해 저장 입구를 드러냄. */}
        <div className="sticky bottom-4 mt-6 z-30">
          <div className="bg-snow border border-parchment rounded-[9.6px] shadow-[0_-4px_16px_-8px_rgba(20,20,19,0.12)] px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-body text-ink font-medium">
                {selected.size === 0 ? (
                  <span className="text-dusty">선택된 페르소나 없음</span>
                ) : (
                  <>
                    <span className="font-mono text-terra">{selected.size}</span>명 선택됨
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={selectAllOnPage}
                className="text-caption text-graphite hover:text-terra hover:underline"
              >
                현재 페이지 전체 선택
              </button>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-caption text-graphite hover:text-terra hover:underline"
                >
                  선택 해제
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSaveModalOpen(true)}
              disabled={selected.size === 0}
              title={selected.size === 0 ? "페르소나를 1명 이상 선택하세요" : undefined}
              className="px-4 py-2 bg-ink text-snow rounded-[9.6px] text-body-sm font-medium
                         hover:bg-onyx active:bg-graphite transition-colors shrink-0
                         disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-ink"
            >
              세그먼트로 저장 →
            </button>
          </div>
        </div>

        {/* 상세 모달 */}
        <PersonaDetailModal uuid={detailUuid} onClose={() => setDetailUuid(null)} />

        {/* 세그먼트 저장 모달 */}
        <SaveSegmentModal
          open={saveModalOpen}
          personaUuids={Array.from(selected)}
          filter={filter}
          onClose={() => setSaveModalOpen(false)}
          onSaved={(seg: Segment) => {
            setSaveModalOpen(false);
            setSavedToast(`'${seg.name}' 세그먼트 저장 완료 · ${seg.size}명`);
            setSelected(new Set());
            // 5초 후 토스트 제거
            setTimeout(() => setSavedToast(null), 5000);
          }}
        />

        {/* 저장 완료 토스트 */}
        {savedToast && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-6 right-6 z-50 bg-snow border border-azure rounded-[9.6px] shadow-lg px-4 py-3 text-body-sm text-ink animate-in fade-in slide-in-from-bottom-2"
          >
            <p className="font-medium text-ink">✓ 저장 완료</p>
            <p className="text-caption text-graphite mt-0.5">{savedToast}</p>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

// ============================================================
// 보조 컴포넌트
// ============================================================

function ViewToggle({
  value,
  onChange,
}: {
  value: "card" | "table";
  onChange: (v: "card" | "table") => void;
}) {
  const opts: { value: "card" | "table"; label: string }[] = [
    { value: "card", label: "카드" },
    { value: "table", label: "테이블" },
  ];
  return (
    <div
      role="tablist"
      aria-label="결과 뷰 전환"
      className="inline-flex bg-vellum border border-parchment rounded-[9.6px] p-0.5"
    >
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
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ExtractedFilterChips({ ex }: { ex: ExtractedFilter }) {
  const chips: { label: string; value: string }[] = [];
  if (ex.sex.length > 0) chips.push({ label: "성별", value: ex.sex.join(", ") });
  if (ex.age_min !== null && ex.age_max !== null) {
    chips.push({ label: "연령", value: `${ex.age_min}-${ex.age_max}세` });
  } else if (ex.age_min !== null) {
    chips.push({ label: "연령", value: `${ex.age_min}세 이상` });
  } else if (ex.age_max !== null) {
    chips.push({ label: "연령", value: `${ex.age_max}세 이하` });
  }
  if (ex.provinces.length > 0) {
    chips.push({
      label: "지역",
      value: ex.provinces.length > 3
        ? `${ex.provinces.slice(0, 3).join(", ")} 외 ${ex.provinces.length - 3}`
        : ex.provinces.join(", "),
    });
  }
  if (ex.marital_statuses.length > 0) {
    chips.push({ label: "혼인", value: ex.marital_statuses.join(", ") });
  }
  if (ex.has_children === true) {
    chips.push({ label: "가구", value: "자녀 양육 중" });
  } else if (ex.has_children === false) {
    chips.push({ label: "가구", value: "자녀 없음" });
  }
  if (ex.employment_status === "employed") {
    chips.push({ label: "고용", value: "직장인 (무직 제외)" });
  } else if (ex.employment_status === "unemployed") {
    chips.push({ label: "고용", value: "무직" });
  }
  if (ex.occupations.length > 0) {
    chips.push({ label: "직업", value: ex.occupations.join(", ") });
  }
  if (ex.education_levels.length > 0) {
    chips.push({ label: "학력", value: ex.education_levels.join(", ") });
  }
  // 동적 컬럼 (housing_type, bachelors_field, military_status, district)
  for (const [col, values] of Object.entries(ex.additional_filters || {})) {
    if (!values || values.length === 0) continue;
    const label = ADDITIONAL_FILTER_LABELS[col] ?? col;
    const value =
      values.length > 3
        ? `${values.slice(0, 3).join(", ")} 외 ${values.length - 3}`
        : values.join(", ");
    chips.push({ label, value });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-overline text-dusty mr-1">AI 자동 추출</span>
      {chips.map((c) => (
        <span
          key={`${c.label}-${c.value}`}
          className="inline-flex items-center gap-1 text-caption px-2 py-0.5 bg-snow border border-terra/40 text-graphite rounded-full"
        >
          <span className="text-dusty">{c.label}</span>
          <span className="text-ink font-medium">{c.value}</span>
        </span>
      ))}
      {ex.remaining_query && ex.remaining_query.length > 0 && (
        <span className="inline-flex items-center gap-1 text-caption px-2 py-0.5 bg-snow border border-parchment text-graphite rounded-full">
          <span className="text-dusty">키워드</span>
          <span className="text-ink">{ex.remaining_query}</span>
        </span>
      )}
    </div>
  );
}

// 스캔 깔때기 — [전체 1,000,000행] → [메타 후보 N] → [임베딩 통과 M].
// '매번 100만 개를 수십 ms에 훑는다'를 정직하게 보여준다. 모든 수치는 백엔드 응답에서
// 가져오며(meta_filter_total/total/elapsed_ms), 없는 단계는 막대 폭 0 또는 생략한다.
function ScanFunnel({ result }: { result: PersonaFilterResponse }) {
  // 단계 값 — 폴백(메타 0명) 경로에서도 안전하게.
  const metaN = result.meta_filter_total ?? 0;
  const matchM = result.total ?? 0;

  // 막대 폭(%): 전체 모집단 대비. 임베딩 통과는 메타 후보 대비로 환산하면 너무 좁아
  // 시각상 사라지므로, 동일 분모(전체)로 그리되 최소 가시폭을 보장한다.
  const pct = (n: number) => (TOTAL_POPULATION > 0 ? (n / TOTAL_POPULATION) * 100 : 0);
  // 0이 아닌 값은 최소 1.5%는 보이게(읽힘 보장). 0이면 0폭.
  const barW = (n: number) => (n <= 0 ? 0 : Math.max(1.5, Math.min(100, pct(n))));

  // elapsed_ms 분해 — extract(옵셔널)/filter/search. 0/undefined면 생략.
  const e = result.elapsed_ms;
  const timeSteps: { key: string; label: string; ms: number }[] = [];
  if (typeof e.extract === "number" && e.extract > 0)
    timeSteps.push({ key: "extract", label: "메타 추출", ms: e.extract });
  if (e.filter > 0) timeSteps.push({ key: "filter", label: "필터 스캔", ms: e.filter });
  if (e.search > 0) timeSteps.push({ key: "search", label: "임베딩", ms: e.search });

  // 깔때기 3단계. 메타 후보가 0이면(폴백) 2단계만 의미 있으나 레이아웃은 유지.
  const stages: {
    key: string;
    label: string;
    count: number;
    width: number;
    tone: "stone" | "azure" | "marine";
  }[] = [
    { key: "all", label: "전체 모집단", count: TOTAL_POPULATION, width: 100, tone: "stone" },
    { key: "meta", label: "메타 후보", count: metaN, width: barW(metaN), tone: "azure" },
    {
      key: "match",
      label: result.has_query ? "임베딩 통과" : "최종 매칭",
      count: matchM,
      width: barW(matchM),
      tone: "marine",
    },
  ];

  const toneBar: Record<string, string> = {
    stone: "bg-stone/40",
    azure: "bg-azure/55",
    marine: "bg-marine",
  };

  return (
    <div className="mt-4 pt-4 border-t border-parchment">
      {/* 깔때기 막대 3단 */}
      <ul className="flex flex-col gap-2" aria-label="스캔 깔때기 단계별 인원">
        {stages.map((s) => (
          <li key={s.key} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-caption text-dusty">{s.label}</span>
            <div className="flex-1 h-5 bg-vellum border border-parchment rounded-[5px] overflow-hidden">
              <div
                className={`h-full ${toneBar[s.tone]} rounded-[4px] transition-[width] duration-700`}
                style={{ width: `${s.width}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-body-sm text-ink font-medium num-tabular">
              {s.key === "all" ? (
                <CountUp value={s.count} suffix="명" suffixClassName="text-dusty font-normal" />
              ) : (
                <>
                  {s.count.toLocaleString()}
                  <span className="text-dusty font-normal">명</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {/* 단계별 소요시간 — total만 보이던 것을 분해. */}
      {timeSteps.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-overline text-dusty mr-0.5">소요</span>
          {timeSteps.map((t) => (
            <span key={t.key} className="text-caption text-graphite">
              {t.label}{" "}
              <span className="text-marine font-medium num-tabular">
                {Math.round(t.ms).toLocaleString()}
              </span>
              <span className="text-dusty">ms</span>
            </span>
          ))}
          <span className="text-caption text-stone">·</span>
          <span className="text-caption text-graphite">
            합계{" "}
            <span className="text-ink font-medium num-tabular">
              {Math.round(e.total).toLocaleString()}
            </span>
            <span className="text-dusty">ms</span>
          </span>
        </div>
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const canPrev = page > 1;
  const canNext = page < totalPages;

  // 표시할 페이지 번호 — 현재 중심 ±2
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  const realStart = Math.max(1, end - 4);
  const pages = Array.from({ length: end - realStart + 1 }, (_, i) => realStart + i);

  return (
    <nav className="flex items-center justify-center gap-1 py-2" aria-label="페이지">
      <PageButton
        disabled={!canPrev}
        onClick={() => onChange(page - 1)}
        ariaLabel="이전 페이지"
      >
        ◀
      </PageButton>
      {realStart > 1 && (
        <>
          <PageButton ariaLabel="1페이지로 이동" onClick={() => onChange(1)}>
            1
          </PageButton>
          <span className="text-caption text-stone px-1">…</span>
        </>
      )}
      {pages.map((p) => (
        <PageButton
          key={p}
          active={p === page}
          onClick={() => onChange(p)}
          ariaLabel={`${p}페이지로 이동`}
        >
          {p}
        </PageButton>
      ))}
      {end < totalPages && (
        <>
          <span className="text-caption text-stone px-1">…</span>
          <PageButton
            ariaLabel={`${totalPages}페이지로 이동`}
            onClick={() => onChange(totalPages)}
          >
            {totalPages}
          </PageButton>
        </>
      )}
      <PageButton
        disabled={!canNext}
        onClick={() => onChange(page + 1)}
        ariaLabel="다음 페이지"
      >
        ▶
      </PageButton>
    </nav>
  );
}

function PageButton({
  active = false,
  disabled = false,
  onClick,
  children,
  ariaLabel,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}
      className={`min-w-[2rem] h-8 px-2 text-body-sm rounded-[9.6px] transition-colors tabular-nums
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-azure
                  disabled:opacity-30 disabled:cursor-not-allowed
                  ${
                    active
                      ? "bg-ink text-snow"
                      : "text-graphite hover:bg-snow hover:text-ink border border-transparent hover:border-parchment"
                  }`}
    >
      {children}
    </button>
  );
}

// 페르소나 카드 로딩 스켈레톤 — PersonaCardItem 골격(헤더: 체크+메타 / 본문: 직업·가구+발췌 / 푸터: 버튼)을
// 그대로 본뜬다. 콘텐츠 자리만 parchment 골격으로 채움.
function ResultSkeleton() {
  return (
    <ul
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-pulse"
      aria-busy="true"
      aria-label="결과 로딩 중"
    >
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <li
          key={i}
          className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden flex flex-col"
        >
          {/* 헤더 — 체크박스 + 성별·나이 + 지역 (실제: px-4 py-3 border-b) */}
          <div className="px-4 py-3 border-b border-parchment flex items-start gap-2.5">
            <div className="w-3.5 h-3.5 rounded-sm bg-parchment mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="h-3.5 w-24 bg-parchment rounded" />
              <div className="h-2.5 w-32 bg-parchment/60 rounded mt-1.5" />
            </div>
          </div>
          {/* 본문 — 직업/가구 2줄 + persona 발췌 (실제: px-4 py-3) */}
          <div className="px-4 py-3 flex-1 flex flex-col gap-2">
            <div className="flex gap-2">
              <div className="h-2.5 w-8 bg-parchment/60 rounded shrink-0" />
              <div className="h-2.5 flex-1 bg-parchment/60 rounded" />
            </div>
            <div className="flex gap-2">
              <div className="h-2.5 w-8 bg-parchment/60 rounded shrink-0" />
              <div className="h-2.5 w-3/4 bg-parchment/60 rounded" />
            </div>
            <div className="space-y-1.5 mt-1">
              <div className="h-2.5 w-full bg-parchment/50 rounded" />
              <div className="h-2.5 w-full bg-parchment/50 rounded" />
              <div className="h-2.5 w-2/3 bg-parchment/50 rounded" />
            </div>
          </div>
          {/* 푸터 — 상세 보기 버튼 (실제: px-4 py-2 border-t) */}
          <div className="px-4 py-2 border-t border-parchment flex justify-end">
            <div className="h-2.5 w-16 bg-parchment/60 rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// 분포 차트 6종 로딩 스켈레톤 — DemographicCard의 골격(카드 테두리 → 헤더 → 차트 → 범례)을
// 그대로 본떠 실제 콘텐츠가 채워질 자리를 미리 보여준다. 콘텐츠 자리만 parchment 골격으로 채움.
// 차트 유형은 검색 결과 항목 수로 가변이나, 기본/넓은 검색 기준(성별만 도넛, 나머지 5종 막대)으로 고정.
function ChartSkeleton() {
  const types: ("donut" | "bar")[] = [
    "donut", // 성별
    "bar", // 연령대
    "bar", // 시도
    "bar", // 직업군
    "bar", // 가구 형태
    "bar", // 주거 형태
  ];
  // 막대 길이 — 실제 분포는 내림차순 정렬돼 표시되므로 점점 짧아지게
  const barWidths = ["88%", "71%", "62%", "50%", "43%", "34%", "27%"];
  return (
    <div
      className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 animate-pulse"
      aria-busy="true"
      aria-label="분포 차트 로딩 중"
    >
      {types.map((type, i) => (
        <div
          key={i}
          className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden flex flex-col"
        >
          {/* 헤더 — 제목 + 부제 자리 (실제: px-3.5 py-2.5 border-b) */}
          <div className="px-3.5 py-2.5 border-b border-parchment">
            <div className="h-3.5 w-20 bg-parchment rounded" />
            <div className="h-2.5 w-32 bg-parchment/60 rounded mt-1.5" />
          </div>
          {/* 본문 — 차트 자리 (실제: p-3) */}
          <div className="p-3 flex-1">
            {type === "donut" ? (
              <div className="flex flex-col items-center">
                {/* 도넛 링 (실제: 차트 height 220) */}
                <div className="flex items-center justify-center h-[150px]">
                  <div className="w-[110px] h-[110px] rounded-full border-[18px] border-parchment" />
                </div>
                {/* 범례 — 2열 4줄 (실제: grid-cols-2) */}
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 w-full">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm bg-parchment shrink-0" />
                      <div className="h-2 flex-1 bg-parchment/60 rounded" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              // 가로 막대 — 좌측 카테고리 라벨 + 길이가 다른 막대 (실제: 차트 height 260)
              <div className="flex flex-col justify-center gap-2.5 h-[230px] py-1">
                {barWidths.map((w, k) => (
                  <div key={k} className="flex items-center gap-2">
                    <div className="h-2 w-14 bg-parchment/60 rounded shrink-0" />
                    <div
                      className="h-3 bg-parchment rounded"
                      style={{ width: w }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
