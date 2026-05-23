"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  filterPersonas,
  listSegments,
  getSegment,
  type ExtractedFilter,
  type PersonaFilterRequest,
  type PersonaFilterResponse,
  type SamplingMode,
  type SegmentSummary,
  ADDITIONAL_FILTER_LABELS,
} from "@/lib/api";
import type { WizardState } from "./types";

/**
 * Step 2 — 대상자 선별.
 *
 * 두 가지 입력 경로:
 *  (A) 자연어 + 즉시 자동 추출 (/personas와 동일 백엔드 호출)
 *  (B) 저장된 세그먼트 select → persona_uuids/filter 자동 채움
 *
 * 좌: 자연어 입력 + AI 자동 추출 칩 + 샘플링 옵션 + 세그먼트 select
 * 우: 미리보기 분포 (총 매칭 수 + sex/age/province)
 *
 * "이 조건으로 확정" 버튼 클릭 시 sample_size 만큼 페르소나 uuid 스냅샷을 저장.
 */
export function StepTargets({
  state,
  setState,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
}) {
  const [filterResult, setFilterResult] = useState<PersonaFilterResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<SegmentSummary[]>([]);

  const [localSampleSize, setLocalSampleSize] = useState<string>(String(state.targets.sample_size));

  useEffect(() => {
    setLocalSampleSize(String(state.targets.sample_size));
  }, [state.targets.sample_size]);

  // 1) 저장된 세그먼트 목록 (1회 로드)
  useEffect(() => {
    listSegments(100, 0)
      .then((r) => setSegments(r.items))
      .catch(() => {
        /* 세그먼트는 옵션 — 실패해도 본문 사용 가능 */
      });
  }, []);

  // 2) 필터 변경 시 디바운스 미리보기 (페이지네이션 없이 1페이지만)
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const runPreview = useCallback(
    async (req: PersonaFilterRequest) => {
      setPreviewLoading(true);
      setError(null);
      try {
        const r = await filterPersonas({ ...req, page: 1, page_size: 20 });
        setFilterResult(r);
        // 자동 추출된 필드를 state에 미리 반영 (사용자 명시값은 보존)
        if (r.extracted_filter) {
          mergeExtracted(state, setState, r.extracted_filter);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPreviewLoading(false);
      }
    },
    // mergeExtracted는 외부 callback이라 의존성 명시
    [state, setState],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // 자연어 또는 명시 필터 중 하나라도 있을 때만 미리보기
    const hasAnyFilter =
      state.targets.query ||
      state.targets.age_min !== null ||
      state.targets.age_max !== null ||
      (state.targets.sex && state.targets.sex.length > 0) ||
      (state.targets.provinces && state.targets.provinces.length > 0) ||
      (state.targets.occupations && state.targets.occupations.length > 0);
    if (!hasAnyFilter) {
      setFilterResult(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      runPreview({
        age_min: state.targets.age_min,
        age_max: state.targets.age_max,
        sex: state.targets.sex,
        provinces: state.targets.provinces,
        family_types: state.targets.family_types,
        education_levels: state.targets.education_levels,
        occupations: state.targets.occupations,
        query: state.targets.query,
      });
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.targets.query,
    state.targets.age_min,
    state.targets.age_max,
    JSON.stringify(state.targets.sex),
    JSON.stringify(state.targets.provinces),
    JSON.stringify(state.targets.occupations),
  ]);

  function patch(p: Partial<WizardState["targets"]>) {
    setState({ ...state, targets: { ...state.targets, ...p, loaded_segment_id: null } });
  }

  // 세그먼트 불러오기 — persona_uuids 스냅샷 + filter 복원
  async function loadSegment(segmentId: string) {
    if (!segmentId) return;
    try {
      const seg = await getSegment(segmentId);
      setState({
        ...state,
        targets: {
          ...state.targets,
          ...seg.filter,
          preview_persona_uuids: seg.persona_uuids,
          preview_total: seg.size,
          preview_distribution: { sex: {}, age_bins: [], province: {} },
          loaded_segment_id: seg.id,
          sample_size: seg.size,
        },
      });
      setFilterResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // 현재 필터 조건으로 sample_size 만큼 페르소나를 별도 fetch.
  // 미리보기는 page_size=20 고정이라 sample_size>20이면 첫 페이지에 부족 → 확정 시점에 백엔드 재요청.
  // 백엔드 page_size 한도 10,000 (apps/api/routes/dataset.py).
  const confirmTokenRef = useRef(0);
  async function fetchSampleAndConfirm(size: number, opts: { keepDistribution?: boolean }) {
    if (!filterResult || filterResult.total === 0) return;
    const token = ++confirmTokenRef.current;
    setPreviewLoading(true);
    setError(null);
    try {
      const r = await filterPersonas({
        age_min: state.targets.age_min,
        age_max: state.targets.age_max,
        sex: state.targets.sex,
        provinces: state.targets.provinces,
        family_types: state.targets.family_types,
        education_levels: state.targets.education_levels,
        occupations: state.targets.occupations,
        query: state.targets.query,
        page: 1,
        page_size: Math.min(size, 10000),
      });
      // 중간에 더 새로운 호출이 들어왔으면 stale 응답 무시
      if (token !== confirmTokenRef.current) return;
      const uuids = r.page_personas.slice(0, size).map((p) => p.uuid);
      setState({
        ...state,
        targets: {
          ...state.targets,
          preview_persona_uuids: uuids,
          preview_total: r.total,
          // 자동 재확정 시에는 분포를 덮어쓰지 않고 기존 미리보기 분포 유지 (확정 버튼 클릭 시에만 갱신)
          ...(opts.keepDistribution ? {} : { preview_distribution: r.distribution }),
        },
      });
    } catch (e) {
      if (token === confirmTokenRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (token === confirmTokenRef.current) {
        setPreviewLoading(false);
      }
    }
  }

  function confirmTargets() {
    if (!filterResult || filterResult.total === 0) return;
    const size = Math.min(state.targets.sample_size, filterResult.total);
    void fetchSampleAndConfirm(size, { keepDistribution: false });
  }

  // sample_size 변경 시 자동 재확정 — 이미 확정된 상태일 때만 새 size로 백엔드 재요청.
  // 의존성을 sample_size로만 좁힌 이유: filterResult를 포함하면 필터 조건만 바꿔도
  // 사용자가 명시적 확정을 하지 않은 채 새 결과의 uuid로 자동 덮어쓰여 의도와 어긋남.
  useEffect(() => {
    if (!filterResult || filterResult.total === 0) return;
    if (state.targets.preview_persona_uuids.length === 0) return;
    const size = Math.min(state.targets.sample_size, filterResult.total);
    if (size === state.targets.preview_persona_uuids.length) return;
    void fetchSampleAndConfirm(size, { keepDistribution: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.targets.sample_size]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {/* 좌측: 조건 입력 */}
      <div className="flex flex-col gap-4">
        {/* 세그먼트 select */}
        <SubCard
          title="저장된 세그먼트 불러오기 (선택)"
          sub={`${segments.length}개 저장됨`}
        >
          {segments.length === 0 ? (
            <p className="text-caption text-stone">
              아직 저장된 세그먼트가 없습니다. /personas에서 페르소나 선택 후 저장할 수 있습니다.
            </p>
          ) : (
            <select
              value={state.targets.loaded_segment_id ?? ""}
              onChange={(e) => loadSegment(e.target.value)}
              className="w-full px-3 py-2 bg-snow border border-onyx/15 rounded-[9.6px]
                         text-body-sm text-ink focus:outline-none focus:ring-2 focus:ring-azure"
            >
              <option value="">— 세그먼트 선택 —</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.size.toLocaleString()}명)
                </option>
              ))}
            </select>
          )}
        </SubCard>

        {/* 자연어 + 메타 필터 */}
        <SubCard title="자연어 조건">
          <textarea
            value={state.targets.query ?? ""}
            onChange={(e) => patch({ query: e.target.value || null })}
            placeholder="예: 30대 워킹맘 수도권 거주, 30대 IT 직장인 등"
            rows={2}
            maxLength={500}
            className="w-full px-3 py-2 bg-snow border border-onyx/15 rounded-[9.6px]
                       text-body-sm text-ink placeholder:text-stone
                       focus:outline-none focus:ring-2 focus:ring-azure focus:border-onyx/30 resize-none"
          />
          <p className="text-caption text-dusty mt-1">
            AI가 자연어를 분석해 인구통계 필터를 자동 적용합니다 (워킹맘→여자/배우자/자녀, 직장인→무직 제외 등).
          </p>
        </SubCard>

        {/* 명시 필터 (간단 버전) */}
        <SubCard title="명시 필터 (옵션)" sub="자연어 추출과 결합됩니다">
          <div className="grid grid-cols-2 gap-3">
            <NumberInput
              label="최소 연령"
              value={state.targets.age_min}
              onChange={(v) => patch({ age_min: v })}
            />
            <NumberInput
              label="최대 연령"
              value={state.targets.age_max}
              onChange={(v) => patch({ age_max: v })}
            />
          </div>
        </SubCard>

        {/* 샘플링 옵션 */}
        <SubCard title="샘플링 옵션">
          <div className="flex flex-col gap-2">
            <SamplingRadio
              value={state.targets.sampling}
              onChange={(v) => patch({ sampling: v })}
            />
            <div>
              <label className="text-caption text-dusty">
                샘플 크기 (1 ~ 10,000명)
              </label>
              <input
                type="number"
                value={localSampleSize}
                onChange={(e) => {
                  const val = e.target.value;
                  setLocalSampleSize(val);
                  const num = parseInt(val, 10);
                  if (!isNaN(num) && num >= 1 && num <= 10000) {
                    patch({ sample_size: num });
                  }
                }}
                onBlur={() => {
                  const num = parseInt(localSampleSize, 10);
                  if (isNaN(num) || num < 1) {
                    setLocalSampleSize("100");
                    patch({ sample_size: 100 });
                  } else if (num > 10000) {
                    setLocalSampleSize("10000");
                    patch({ sample_size: 10000 });
                  } else {
                    setLocalSampleSize(String(num));
                    patch({ sample_size: num });
                  }
                }}
                className="mt-1 w-32 px-3 py-1.5 bg-snow border border-onyx/15 rounded-[9.6px]
                           text-body-sm text-ink tabular-nums
                           focus:outline-none focus:ring-2 focus:ring-azure"
              />
              {state.targets.sample_size >= 500 && (
                <p className="text-caption text-terra mt-1">
                  ⚠ {state.targets.sample_size.toLocaleString()}명 × 질문 N개 = LLM 호출
                  매우 많음 (시뮬레이션에 수십 분~수 시간 소요 가능)
                </p>
              )}
            </div>
          </div>
        </SubCard>
      </div>

      {/* 우측: 미리보기 */}
      <div className="flex flex-col gap-4">
        <SubCard
          title="미리보기"
          sub={
            previewLoading
              ? "검색 중…"
              : filterResult
                ? `${filterResult.total.toLocaleString()}명 매칭`
                : state.targets.loaded_segment_id
                  ? `${state.targets.preview_total.toLocaleString()}명 (세그먼트)`
                  : "조건을 입력하면 결과가 표시됩니다"
          }
        >
          {error && (
            <p className="text-caption text-ink bg-terra/10 border border-terra/30 rounded px-3 py-2 mb-3">
              {error}
            </p>
          )}

          {filterResult?.extracted_filter && (
            <ExtractedChips ex={filterResult.extracted_filter} />
          )}

          {filterResult && filterResult.total > 0 && (
            <MiniDistribution dist={filterResult.distribution} total={filterResult.total} />
          )}

          {state.targets.loaded_segment_id && !filterResult && (
            <p className="text-caption text-graphite">
              세그먼트에서 불러온 페르소나 {state.targets.preview_total.toLocaleString()}명이 준비됐습니다.
            </p>
          )}

          {/* 확정 버튼 */}
          <div className="mt-4 flex items-center justify-between gap-3 pt-3 border-t border-parchment">
            <p className="text-caption text-graphite">
              {state.targets.preview_persona_uuids.length > 0 ? (
                <>
                  ✓ 확정됨:{" "}
                  <span className="font-mono text-terra">
                    {state.targets.preview_persona_uuids.length}
                  </span>
                  명
                </>
              ) : (
                "검색 결과 확인 후 확정하세요"
              )}
            </p>
            <button
              type="button"
              onClick={confirmTargets}
              disabled={!filterResult || filterResult.total === 0 || previewLoading}
              className="px-4 py-2 text-body-sm font-medium text-snow bg-ink rounded-[9.6px]
                         hover:bg-onyx active:bg-graphite transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              이 조건으로 확정
            </button>
          </div>
        </SubCard>
      </div>
    </div>
  );
}

// ============================================================
// 자동 추출을 wizard state에 병합 (사용자 명시값은 보존)
// ============================================================

function mergeExtracted(
  state: WizardState,
  setState: (s: WizardState) => void,
  ex: ExtractedFilter,
) {
  // UI 명시값이 비어 있는 경우만 자동 추출값을 표시용으로 채움.
  // (백엔드는 이미 추출+명시를 자동 병합하므로 여기는 UI 일관성용)
  const t = state.targets;
  const next: Partial<typeof t> = {};
  let changed = false;
  if (!t.sex.length && ex.sex.length) {
    next.sex = ex.sex;
    changed = true;
  }
  if (!t.provinces.length && ex.provinces.length) {
    next.provinces = ex.provinces;
    changed = true;
  }
  if (t.age_min === null && ex.age_min !== null) {
    next.age_min = ex.age_min;
    changed = true;
  }
  if (t.age_max === null && ex.age_max !== null) {
    next.age_max = ex.age_max;
    changed = true;
  }
  if (changed) {
    setState({ ...state, targets: { ...t, ...next } });
  }
}

// ============================================================
// 보조 컴포넌트
// ============================================================

function SubCard({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden">
      <header className="px-4 py-2.5 border-b border-parchment">
        <h3 className="text-body font-medium text-ink">{title}</h3>
        {sub && <p className="text-caption text-dusty mt-0.5">{sub}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div>
      <label className="text-caption text-dusty">{label}</label>
      <input
        type="number"
        min={0}
        max={120}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="mt-1 w-full px-3 py-1.5 bg-snow border border-onyx/15 rounded-[9.6px]
                   text-body-sm text-ink tabular-nums
                   focus:outline-none focus:ring-2 focus:ring-azure"
      />
    </div>
  );
}

function SamplingRadio({
  value,
  onChange,
}: {
  value: SamplingMode;
  onChange: (v: SamplingMode) => void;
}) {
  const opts: { value: SamplingMode; label: string; sub: string }[] = [
    { value: "random_n", label: "랜덤 N명", sub: "샘플 크기만큼 무작위" },
    { value: "all", label: "전체", sub: "매칭 전체 (MVP 비권장)" },
    { value: "proportional", label: "비례 추출", sub: "분포 보존 (Phase 2)" },
  ];
  return (
    <fieldset className="flex flex-col gap-1">
      {opts.map((o) => (
        <label
          key={o.value}
          className="flex items-baseline gap-2 cursor-pointer text-body-sm text-graphite hover:text-ink"
        >
          <input
            type="radio"
            name="sampling"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="accent-terra"
          />
          <span className={value === o.value ? "text-ink font-medium" : ""}>
            {o.label}
          </span>
          <span className="text-caption text-dusty">— {o.sub}</span>
        </label>
      ))}
    </fieldset>
  );
}

function ExtractedChips({ ex }: { ex: ExtractedFilter }) {
  const chips: { label: string; value: string }[] = [];
  if (ex.sex.length) chips.push({ label: "성별", value: ex.sex.join(", ") });
  if (ex.age_min !== null && ex.age_max !== null) {
    chips.push({ label: "연령", value: `${ex.age_min}-${ex.age_max}세` });
  }
  if (ex.provinces.length) {
    chips.push({
      label: "지역",
      value: ex.provinces.length > 3
        ? `${ex.provinces.slice(0, 3).join(", ")} 외 ${ex.provinces.length - 3}`
        : ex.provinces.join(", "),
    });
  }
  if (ex.marital_statuses.length) {
    chips.push({ label: "혼인", value: ex.marital_statuses.join(", ") });
  }
  if (ex.has_children === true) chips.push({ label: "가구", value: "자녀 양육 중" });
  else if (ex.has_children === false) chips.push({ label: "가구", value: "자녀 없음" });
  if (ex.employment_status === "employed") chips.push({ label: "고용", value: "직장인" });
  else if (ex.employment_status === "unemployed") chips.push({ label: "고용", value: "무직" });
  if (ex.occupations.length) chips.push({ label: "직업", value: ex.occupations.join(", ") });
  for (const [col, vals] of Object.entries(ex.additional_filters || {})) {
    if (!vals?.length) continue;
    const label = ADDITIONAL_FILTER_LABELS[col] ?? col;
    chips.push({
      label,
      value: vals.length > 3 ? `${vals.slice(0, 3).join(", ")} 외 ${vals.length - 3}` : vals.join(", "),
    });
  }
  if (chips.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-1.5 pb-3 border-b border-parchment">
      <span className="text-overline text-dusty mr-1">AI 자동 추출</span>
      {chips.map((c) => (
        <span
          key={`${c.label}-${c.value}`}
          className="inline-flex items-center gap-1 text-caption px-2 py-0.5 bg-vellum border border-terra/40 text-graphite rounded-full"
        >
          <span className="text-dusty">{c.label}</span>
          <span className="text-ink font-medium">{c.value}</span>
        </span>
      ))}
    </div>
  );
}

function MiniDistribution({
  dist,
  total,
}: {
  dist: { sex: Record<string, number>; age_bins: { label: string; count: number }[]; province: Record<string, number> };
  total: number;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <DistBlock title="성별" entries={Object.entries(dist.sex)} total={total} />
      <DistBlock
        title="연령대"
        entries={dist.age_bins.map((b) => [b.label, b.count] as [string, number])}
        total={total}
        maxRows={4}
      />
      <DistBlock
        title="시도 Top 5"
        entries={Object.entries(dist.province)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)}
        total={total}
      />
    </div>
  );
}

function DistBlock({
  title,
  entries,
  total,
  maxRows = 6,
}: {
  title: string;
  entries: [string, number][];
  total: number;
  maxRows?: number;
}) {
  const max = entries.reduce((m, [, v]) => Math.max(m, v), 0);
  const top = entries.slice(0, maxRows);
  return (
    <div className="bg-vellum border border-parchment rounded-[9.6px] px-3 py-2">
      <p className="text-overline text-dusty mb-1.5">{title}</p>
      <ul className="space-y-1">
        {top.length === 0 && <li className="text-caption text-stone">—</li>}
        {top.map(([k, v]) => {
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
