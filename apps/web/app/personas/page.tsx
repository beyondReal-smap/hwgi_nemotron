"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { PersonaFilterPanel } from "@/components/PersonaFilterPanel";
import { PersonaCardGrid } from "@/components/PersonaCardGrid";
import { PersonaDetailModal } from "@/components/PersonaDetailModal";
import { SaveSegmentModal } from "@/components/SaveSegmentModal";
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
 *  - 모든 섹션은 SectionCard 헤더 패턴 (bg-snow + border-l-4 border-l-terra)
 *  - 한화 토큰만 사용
 *  - 필터 변경 시 300ms 디바운스 후 API 호출
 *  - 페이지 변경은 즉시
 */

const PAGE_SIZE = 24;

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

  // 2) 필터 변경 → 디바운스 후 fetch.
  //    빠른 연속 입력 시 LLM 추출 시간 차이로 stale 응답이 마지막에 도착해 결과를 덮어쓰는
  //    race condition을 token ref로 방지 (이전 호출의 응답은 무시).
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const filterTokenRef = useRef(0);
  const runFilter = useCallback(async (req: PersonaFilterRequest) => {
    const token = ++filterTokenRef.current;
    setLoading(true);
    setError(null);
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
      }
    }
  }, []);

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

  function toggleSelect(uuid: string) {
    const next = new Set(selected);
    if (next.has(uuid)) next.delete(uuid);
    else next.add(uuid);
    setSelected(next);
  }

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
      <SiteHeader />

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
              <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4">
                <h2 className="text-title text-ink">
                  {loading
                    ? "검색 중…"
                    : result
                      ? `매칭 요약 · ${result.total.toLocaleString()}명`
                      : "매칭 요약"}
                </h2>
                <p className="text-body-sm text-dusty mt-1">
                  {result ? (
                    <>
                      {result.has_query && result.match_threshold !== null ? (
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

                {/* AI 자동 추출 메타 칩 — 자연어 쿼리가 LLM으로 분해된 결과 */}
                {result?.extracted_filter && (
                  <ExtractedFilterChips ex={result.extracted_filter} />
                )}
              </header>

              {/* 분포 미니 카드 3종 — 빈 결과면 안내 */}
              {result && result.total > 0 ? (
                <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <MiniDistribution
                    label="성별"
                    counts={result.distribution.sex}
                    total={result.total}
                  />
                  <MiniDistribution
                    label="연령대"
                    counts={Object.fromEntries(
                      result.distribution.age_bins.map((b) => [b.label, b.count]),
                    )}
                    total={result.total}
                    maxRows={4}
                  />
                  <MiniDistribution
                    label="시도 Top 5"
                    counts={Object.fromEntries(
                      Object.entries(result.distribution.province)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5),
                    )}
                    total={result.total}
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
              <div className="bg-terra/10 border border-terra/30 text-ink px-4 py-3 rounded-[9.6px]">
                <p className="font-medium mb-1">결과를 불러오지 못했습니다</p>
                <p className="text-caption text-graphite">{error}</p>
              </div>
            )}

            {/* === 박스 2: 매칭된 페르소나 리스트 === */}
            <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
              <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4 flex items-start justify-between gap-3 flex-wrap">
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
                {loading && !result && <ResultSkeleton />}
                {result && (
                  <PersonaCardGrid
                    view={view}
                    personas={result.page_personas}
                    selected={selected}
                    onToggle={toggleSelect}
                    onOpenDetail={setDetailUuid}
                    hasQuery={result.has_query}
                  />
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

function MiniDistribution({
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
  const maxVal = entries.reduce((m, [, v]) => Math.max(m, v), 0);

  return (
    <div className="bg-snow border border-parchment rounded-[9.6px] px-3 py-2.5">
      <p className="text-overline text-dusty mb-1.5">{label}</p>
      <ul className="space-y-1">
        {entries.length === 0 && (
          <li className="text-caption text-stone">데이터 없음</li>
        )}
        {entries.map(([k, v]) => {
          const pct = total > 0 ? (v / total) * 100 : 0;
          const barPct = maxVal > 0 ? (v / maxVal) * 100 : 0;
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
                <div
                  className="h-full bg-terra/80"
                  style={{ width: `${barPct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
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
      <PageButton disabled={!canPrev} onClick={() => onChange(page - 1)}>
        ◀
      </PageButton>
      {realStart > 1 && (
        <>
          <PageButton onClick={() => onChange(1)}>1</PageButton>
          <span className="text-caption text-stone px-1">…</span>
        </>
      )}
      {pages.map((p) => (
        <PageButton key={p} active={p === page} onClick={() => onChange(p)}>
          {p}
        </PageButton>
      ))}
      {end < totalPages && (
        <>
          <span className="text-caption text-stone px-1">…</span>
          <PageButton onClick={() => onChange(totalPages)}>{totalPages}</PageButton>
        </>
      )}
      <PageButton disabled={!canNext} onClick={() => onChange(page + 1)}>
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
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-w-[2rem] h-8 px-2 text-body-sm rounded-[9.6px] transition-colors tabular-nums
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
          className="h-48 bg-snow border border-parchment rounded-[9.6px]"
        />
      ))}
    </ul>
  );
}
