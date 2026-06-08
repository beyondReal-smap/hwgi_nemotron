"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  runWhatIf,
  type CohortStat,
  type DistributionBin,
  type PopulationStats,
  type SegmentFinding,
  type SellingPoints,
  type WhatIfRequest,
  type WhatIfResponse,
} from "@/lib/api";
import { CountUp } from "@/components/CountUp";
import { chartColor } from "@/lib/chartColors";

/**
 * What-if 실험실 — 고정 스냅샷을 슬라이더로 탐색하는 인터랙티브 시뮬레이터.
 *
 * 분석은 임베딩(1M 행)을 이미 캐시해 둔 상태라, 타겟 조건·카테고리 가중치만 바꾸면
 * 임베딩 0콜로 100만 분포·cohort·세그먼트가 즉시 재계산된다. 사용자는 손끝 슬라이더로
 * "20대만 보면? 여행 가중치를 높이면?"을 원본 대비 델타로 즉답받는다.
 *
 * 설계 원칙:
 * - 첫 마운트 자동 호출 금지: 변경 없으면 원본과 동일하니 불필요한 호출을 막는다.
 * - 350ms 디바운스 + AbortController: 슬라이더 연속 조작 시 in-flight 요청을 취소해
 *   "마지막 응답만 반영"(경쟁 조건 방지). 재계산 중에도 이전 결과를 유지해 깜빡임 차단.
 * - 델타는 baseStats(원본) 대비. 증가=marine, 감소=terra, 동일=dusty로 한화 톤 고정.
 */

// 카테고리 6종 — 백엔드 persona_category_weights 키 ↔ 한글 라벨.
const CATEGORY_KEYS = [
  "professional",
  "sports",
  "arts",
  "travel",
  "culinary",
  "family",
] as const;
type CategoryKey = (typeof CATEGORY_KEYS)[number];

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  professional: "전문직",
  sports: "스포츠",
  arts: "예술",
  travel: "여행",
  culinary: "요리",
  family: "가정",
};

// 슬라이더 디바운스(ms) — 연속 조작을 한 번의 재점수로 모은다.
const DEBOUNCE_MS = 350;

// 성별 토글 옵션.
const SEX_OPTIONS = ["전체", "남자", "여자"] as const;
type SexOption = (typeof SEX_OPTIONS)[number];

// 연령 기본값(원본에 값이 없을 때).
const DEFAULT_AGE_MIN = 20;
const DEFAULT_AGE_MAX = 70;

// ============================================================
// 컨트롤 상태 도출 헬퍼
// ============================================================

type Controls = {
  ageMin: number;
  ageMax: number;
  sex: SexOption;
  weights: Record<CategoryKey, number>;
};

/** baseSellingPoints → 컨트롤 초기/리셋 상태. null·빈배열은 안전한 기본값으로. */
function controlsFromSellingPoints(sp: SellingPoints): Controls {
  const sexRaw = sp.target_sex?.[0];
  const sex: SexOption =
    sexRaw === "남자" || sexRaw === "여자" ? sexRaw : "전체";

  const weights = CATEGORY_KEYS.reduce<Record<CategoryKey, number>>(
    (acc, key) => {
      const v = sp.persona_category_weights?.[key];
      // LLM 출력(외부 입력)이라 범위 보장 없음 — 슬라이더 [0,1]에 맞춰 클램프.
      // 1 초과/음수가 들어오면 thumb 위치·델타 기준이 깨지므로 경계에서 정규화.
      acc[key] =
        typeof v === "number" && Number.isFinite(v)
          ? Math.max(0, Math.min(1, v))
          : 0;
      return acc;
    },
    {} as Record<CategoryKey, number>,
  );

  return {
    ageMin: sp.target_age_min ?? DEFAULT_AGE_MIN,
    ageMax: sp.target_age_max ?? DEFAULT_AGE_MAX,
    sex,
    weights,
  };
}

/** 두 컨트롤이 동일한지 — 초기화 버튼 활성/리셋 판단용. */
function controlsEqual(a: Controls, b: Controls): boolean {
  if (a.ageMin !== b.ageMin || a.ageMax !== b.ageMax || a.sex !== b.sex) {
    return false;
  }
  return CATEGORY_KEYS.every((k) => a.weights[k] === b.weights[k]);
}

/** 컨트롤 → WhatIfRequest override. "전체"=[]로 명시 해제. */
function buildRequest(analysisId: string, c: Controls): WhatIfRequest {
  return {
    analysis_id: analysisId,
    target_age_min: c.ageMin,
    target_age_max: c.ageMax,
    target_sex: c.sex === "전체" ? [] : [c.sex],
    persona_category_weights: { ...c.weights },
  };
}

// ============================================================
// 델타 계산 헬퍼
// ============================================================

function cohortSize(stats: PopulationStats, name: string): number {
  return (stats.cohorts.find((c: CohortStat) => c.name === name)?.size ?? 0);
}

type DeltaTone = "up" | "down" | "flat";

function deltaTone(delta: number): DeltaTone {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

const DELTA_TEXT: Record<DeltaTone, string> = {
  up: "text-marine",
  down: "text-terra",
  flat: "text-dusty",
};

const DELTA_BG: Record<DeltaTone, string> = {
  up: "bg-marine/15 text-marine",
  down: "bg-terra/15 text-terra",
  flat: "bg-parchment text-dusty",
};

/** 부호 포함 포맷 — 정수(인원)는 콤마, 소수(점수)는 자릿수 지정. */
function formatDelta(delta: number, decimals = 0, suffix = ""): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "" : "±";
  const abs = Math.abs(delta);
  const body =
    delta < 0
      ? `-${abs.toLocaleString("ko-KR", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}`
      : `${sign}${abs.toLocaleString("ko-KR", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}`;
  return `${body}${suffix}`;
}

// ============================================================
// 메인 컴포넌트
// ============================================================

type Props = {
  analysisId: string;
  baseStats: PopulationStats; // 원본 분석의 모집단 통계 (델타 비교 기준)
  baseSellingPoints: SellingPoints; // 슬라이더 초기값 소스
};

export function WhatIfLab({
  analysisId,
  baseStats,
  baseSellingPoints,
}: Props): JSX.Element {
  // 원본 기준 컨트롤 — 리셋/델타 기준. selling points는 마운트 후 안정적.
  const baseControls = useMemo(
    () => controlsFromSellingPoints(baseSellingPoints),
    [baseSellingPoints],
  );

  const [controls, setControls] = useState<Controls>(baseControls);
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 디바운스 타이머 + in-flight 요청 취소용 컨트롤러. 경쟁 조건 방지.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 첫 마운트(또는 초기값과 동일)에선 자동 호출 금지.
  const isDirty = !controlsEqual(controls, baseControls);

  // ----------------------------------------------------------
  // 디바운스 + 취소 가능한 재점수
  // ----------------------------------------------------------
  const recompute = useCallback(
    (next: Controls) => {
      // 이전 in-flight 취소 (마지막 응답만 반영).
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setRecomputing(true);
      setError(null);

      runWhatIf(buildRequest(analysisId, next))
        .then((res) => {
          if (ctrl.signal.aborted) return;
          setResult(res);
          setRecomputing(false);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          const msg =
            e instanceof Error ? e.message : "재점수 중 오류가 발생했습니다.";
          setError(msg);
          setRecomputing(false);
        });
    },
    [analysisId],
  );

  // 컨트롤 변경 → 디바운스 후 재점수. 원본과 동일하면 호출 안 함.
  useEffect(() => {
    if (!isDirty) {
      // 초기값으로 되돌아오면 원본 표시로 복귀(이전 결과 비움).
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      setRecomputing(false);
      setResult(null);
      setError(null);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => recompute(controls), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // controls 객체가 바뀔 때마다 재실행. isDirty/recompute는 controls·base 파생.
  }, [controls, isDirty, recompute]);

  // 언마운트 시 타이머·요청 정리.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // ----------------------------------------------------------
  // 컨트롤 핸들러 (min ≤ max 보정 포함)
  // ----------------------------------------------------------
  const setAgeMin = (v: number) =>
    setControls((c) => ({ ...c, ageMin: Math.min(v, c.ageMax) }));
  const setAgeMax = (v: number) =>
    setControls((c) => ({ ...c, ageMax: Math.max(v, c.ageMin) }));
  const setSex = (sex: SexOption) => setControls((c) => ({ ...c, sex }));
  const setWeight = (key: CategoryKey, v: number) =>
    setControls((c) => ({ ...c, weights: { ...c.weights, [key]: v } }));
  const reset = () => setControls(baseControls);

  // ----------------------------------------------------------
  // 표시 데이터 — 결과가 있으면 응답, 없으면 원본.
  // ----------------------------------------------------------
  const liveStats: PopulationStats = result?.population_stats ?? baseStats;
  const segments: SegmentFinding[] = result?.segments ?? [];
  const elapsedTotal = result?.elapsed_ms?.total ?? null;

  // 델타 3종 — base(원본) 대비 new(현재 표시).
  const baseCore = cohortSize(baseStats, "core");
  const baseTarget = cohortSize(baseStats, "target");
  const baseMean = baseStats.raw_mean ?? 0;

  const newCore = cohortSize(liveStats, "core");
  const newTarget = cohortSize(liveStats, "target");
  const newMean = liveStats.raw_mean ?? 0;

  const dCore = newCore - baseCore;
  const dTarget = newTarget - baseTarget;
  const dMean = newMean - baseMean;

  return (
    <section
      className={`border border-parchment rounded-[9.6px] bg-vellum overflow-hidden transition-opacity motion-reduce:transition-none ${
        recomputing ? "opacity-70" : "opacity-100"
      }`}
      aria-busy={recomputing}
    >
      {/* 헤더 */}
      <header className="bg-ink text-snow px-4 py-3 sm:px-5 sm:py-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-title text-snow">What-if 실험실</h2>
          <p className="text-body-sm text-snow/60 mt-1">
            타겟·관심사를 바꾸면 100만 분포가 즉시 재계산됩니다 (임베딩 0콜)
          </p>
        </div>
        {recomputing ? (
          <span
            className="shrink-0 inline-flex items-center gap-1.5 rounded-[5px] bg-snow/10 px-2 py-1 text-caption text-snow/70 animate-pulse motion-reduce:animate-none"
            role="status"
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-marine"
              aria-hidden
            />
            재계산 중
          </span>
        ) : elapsedTotal != null ? (
          <span className="shrink-0 text-caption text-snow/45 num-tabular self-center">
            재계산 {elapsedTotal}ms
          </span>
        ) : null}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,300px)_1fr] divide-y lg:divide-y-0 lg:divide-x divide-parchment">
        {/* ===== 컨트롤 패널 ===== */}
        <div className="px-4 py-4 sm:px-5 sm:py-5 space-y-5 bg-snow/40">
          <div className="flex items-center justify-between">
            <p className="text-overline text-dusty">조건 조정</p>
            <button
              type="button"
              onClick={reset}
              disabled={!isDirty}
              className="text-caption text-graphite border border-parchment rounded-[5px] px-2.5 py-1 transition-colors motion-reduce:transition-none enabled:hover:bg-vellum disabled:text-stone disabled:cursor-not-allowed"
            >
              초기화
            </button>
          </div>

          {/* 연령 범위 */}
          <fieldset className="space-y-2">
            <legend className="text-body-sm text-ink font-semibold">
              연령 범위
              <span className="ml-2 text-caption text-dusty num-tabular font-normal">
                {controls.ageMin} ~ {controls.ageMax}세
              </span>
            </legend>
            <div className="space-y-2.5">
              <RangeRow
                label="최소"
                ariaLabel="타겟 최소 연령"
                min={0}
                max={100}
                step={1}
                value={controls.ageMin}
                onChange={setAgeMin}
                valueText={`${controls.ageMin}세`}
              />
              <RangeRow
                label="최대"
                ariaLabel="타겟 최대 연령"
                min={0}
                max={100}
                step={1}
                value={controls.ageMax}
                onChange={setAgeMax}
                valueText={`${controls.ageMax}세`}
              />
            </div>
          </fieldset>

          {/* 성별 토글 */}
          <fieldset className="space-y-2">
            <legend className="text-body-sm text-ink font-semibold">성별</legend>
            <div className="flex gap-1.5" role="group" aria-label="타겟 성별">
              {SEX_OPTIONS.map((opt) => {
                const active = controls.sex === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSex(opt)}
                    className={`flex-1 rounded-[5px] border px-2 py-1.5 text-body-sm transition-colors motion-reduce:transition-none ${
                      active
                        ? "border-marine bg-marine/15 text-marine font-semibold"
                        : "border-parchment bg-snow text-graphite hover:bg-vellum"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* 카테고리 가중치 */}
          <fieldset className="space-y-2.5">
            <legend className="text-body-sm text-ink font-semibold">
              관심사 가중치
            </legend>
            <p className="text-caption text-dusty leading-relaxed">
              타겟을 좁히는 <span className="text-graphite">필터가 아니라</span>{" "}
              <span className="text-graphite font-medium">친화 재배치</span>입니다. 가중치를 높이면
              그 관심사에 친한 층의 점수가 오르고 먼 층은 내려갑니다. 그래서 상품과 잘 맞는
              관심사일수록 타겟이 늘고, 무관한 관심사는 오히려 줄어들 수 있습니다.
            </p>
            {CATEGORY_KEYS.map((key) => (
              <RangeRow
                key={key}
                label={CATEGORY_LABELS[key]}
                ariaLabel={`${CATEGORY_LABELS[key]} 가중치`}
                min={0}
                max={1}
                step={0.05}
                value={controls.weights[key]}
                onChange={(v) => setWeight(key, v)}
                valueText={controls.weights[key].toFixed(2)}
              />
            ))}
          </fieldset>
        </div>

        {/* ===== 결과 패널 ===== */}
        <div className="px-4 py-4 sm:px-5 sm:py-5 space-y-5">
          {error ? (
            <div className="rounded-[7px] border border-terra/40 bg-terra/10 px-3 py-2.5 text-body-sm text-terra">
              재점수에 실패했습니다 — {error}
            </div>
          ) : null}

          {!isDirty && !error ? (
            <p className="text-caption text-dusty">
              슬라이더나 토글을 움직이면 원본 대비 변화가 여기에 나타납니다.
            </p>
          ) : null}

          {/* 핵심 지표 델타 3종 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <DeltaCard
              label="핵심타겟 인원"
              value={newCore}
              delta={dCore}
              deltaText={`${formatDelta(dCore)}명`}
            />
            <DeltaCard
              label="타겟층 인원"
              value={newTarget}
              delta={dTarget}
              deltaText={`${formatDelta(dTarget)}명`}
            />
            <DeltaCard
              label="모집단 평균점수"
              value={newMean}
              decimals={1}
              delta={dMean}
              deltaText={formatDelta(dMean, 1, "점")}
            />
          </div>

          {/* 점수 분포 미니 막대 */}
          <ScoreDistribution bins={liveStats.score_distribution} />

          {/* 숨은 세그먼트 Top 3 */}
          <TopSegments segments={segments} />
        </div>
      </div>
    </section>
  );
}

// ============================================================
// 하위 표시 컴포넌트
// ============================================================

function RangeRow({
  label,
  ariaLabel,
  min,
  max,
  step,
  value,
  onChange,
  valueText,
}: {
  label: string;
  ariaLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  valueText: string;
}): JSX.Element {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-caption text-graphite">
        <span>{label}</span>
        <span className="text-dusty num-tabular">{valueText}</span>
      </span>
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-marine cursor-pointer"
      />
    </label>
  );
}

function DeltaCard({
  label,
  value,
  decimals = 0,
  delta,
  deltaText,
}: {
  label: string;
  value: number;
  decimals?: number;
  delta: number;
  deltaText: string;
}): JSX.Element {
  const tone = deltaTone(delta);
  return (
    <div className="rounded-[7px] border border-parchment bg-snow px-3 py-3">
      <p className="text-overline text-dusty truncate">{label}</p>
      <p className="text-heading text-ink mt-1.5 num-tabular">
        <CountUp value={value} decimals={decimals} />
      </p>
      <span
        className={`mt-2 inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-caption font-semibold num-tabular ${DELTA_BG[tone]}`}
      >
        <span aria-hidden className={DELTA_TEXT[tone]}>
          {tone === "up" ? "▲" : tone === "down" ? "▼" : "·"}
        </span>
        {deltaText}
      </span>
    </div>
  );
}

function ScoreDistribution({
  bins,
}: {
  bins: DistributionBin[];
}): JSX.Element | null {
  if (!bins || bins.length === 0) return null;
  const max = Math.max(...bins.map((b) => b.count), 1);

  return (
    <div>
      <p className="text-overline text-dusty mb-2">점수 분포</p>
      <ul className="space-y-1.5">
        {bins.map((b, i) => {
          const pct = Math.max(2, (b.count / max) * 100);
          return (
            <li key={`${b.label}-${i}`} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-caption text-graphite num-tabular text-right">
                {b.label}
              </span>
              <span
                className="relative h-3 flex-1 rounded-[4px] bg-snow border border-parchment overflow-hidden"
                role="img"
                aria-label={`${b.label}: ${b.count.toLocaleString()}명`}
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-[3px] transition-[width] motion-reduce:transition-none"
                  style={{
                    width: `${pct}%`,
                    background: chartColor(i),
                    opacity: 0.75,
                  }}
                />
              </span>
              <span className="w-16 shrink-0 text-caption text-dusty num-tabular text-right">
                {b.count.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TopSegments({
  segments,
}: {
  segments: SegmentFinding[];
}): JSX.Element | null {
  if (!segments || segments.length === 0) return null;
  const rows = [...segments]
    .sort((a, b) => b.lift_ratio - a.lift_ratio)
    .slice(0, 3);

  return (
    <div>
      <p className="text-overline text-dusty mb-2">숨은 세그먼트 Top 3</p>
      <ul className="space-y-2">
        {rows.map((seg, i) => (
          <li
            key={`${seg.label}-${i}`}
            className="flex items-center justify-between gap-3 rounded-[7px] border border-parchment bg-snow px-3 py-2"
          >
            <span className="text-body-sm text-ink leading-snug">
              {seg.label}
            </span>
            <span className="shrink-0 inline-flex items-center rounded-[5px] bg-marine/15 px-2 py-0.5 text-caption font-semibold text-marine num-tabular">
              {seg.lift_ratio.toFixed(1)}x
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default WhatIfLab;
