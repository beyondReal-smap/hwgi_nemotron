"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { KoreaMap } from "@/components/KoreaMap";
import {
  getDatasetOverview,
  getPersonaSamples,
  type DatasetOverview,
  type DemographicColumn,
  type DistributionBin,
  type OccupationGroup,
  type PersonaSample,
  type PersonaTextColumn,
  type ProvinceRow,
  type RegionStat,
} from "@/lib/api";

/**
 * /overview — 100만 행 데이터셋 현황 대시보드.
 *
 * 디자인 원칙 (이 페이지 한정):
 * - 모든 섹션은 SectionCard로 래핑 → 헤더 스타일 통일 (h2 + sub + action)
 * - 한화 토큰만 사용 (vellum/ink/parchment/terra/azure/snow/dusty/stone/graphite/onyx)
 * - 1440px max-width · 섹션 간 gap-8 · 카드 내부 grid gap-4 · 모바일 single column → 12 col grid (xl)
 * - sticky anchor TOC로 8개 섹션을 명시적으로 탐색 가능
 *
 * 섹션 순서 (위→아래로 정보 깊이 점증):
 *  1. 페이지 헤더 (총량 + 출처 요약)
 *  2. anchor TOC (sticky)
 *  3. 핵심 지표 (메타 5종)
 *  4. 지역 — 지도 + 시도 막대 + 연령 분포
 *  5. 인구통계 — 7개 카테고리 (4 col grid)
 *  6. 직업군 분포 (좌 그룹 / 우 Top 5)
 *  7. 페르소나 텍스트 — 길이 표 + 카테고리 클릭 시 샘플 펼침
 *  8. 데이터 출처
 */
export default function OverviewPage() {
  const [data, setData] = useState<DatasetOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getDatasetOverview()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-vellum text-ink flex flex-col">
      <SiteHeader />
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 lg:p-8">
        {loading && <LoadingState />}
        {error && <ErrorState message={error} />}
        {data && <Dashboard data={data} />}
      </main>
      <SiteFooter />
    </div>
  );
}

// ============================================================
// 공통 헬퍼 — 차트 수치 라벨 포맷
// ============================================================

/** 큰 수치는 k 단위로 압축 (예: 123,456 → 123k, 1,234 → 1,234). 차트 라벨 가독성용. */
function formatCompact(v: number): string {
  if (v >= 10000) return `${Math.round(v / 1000).toLocaleString()}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toLocaleString();
}

/** 비율 표시 (예: 32.4%). 도넛/막대의 비율 라벨용. */
function formatPercent(count: number, total: number): string {
  if (!total) return "0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

// ============================================================
// 공통 SectionCard — 모든 섹션 헤더 통일
// ============================================================

function SectionCard({
  id,
  title,
  sub,
  action,
  bodyClassName = "p-4",
  noBodyPadding = false,
  className = "",
  children,
}: {
  /** anchor용 id (TOC 점프 대상) */
  id?: string;
  title: string;
  sub?: string;
  /** 헤더 우측에 보조 컨트롤 (옵션) */
  action?: React.ReactNode;
  bodyClassName?: string;
  /** 차트·표처럼 자체 padding이 있는 컨텐츠를 둘 때 사용 */
  noBodyPadding?: boolean;
  /** 추가 className (그리드 셀 채움 등) */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={`bg-vellum border border-parchment rounded-[9.6px] overflow-hidden scroll-mt-24 flex flex-col ${className}`}
    >
      {/* 헤더 기준: KoreaMap 헤더와 동일 — bg-snow + 좌측 4px terra accent bar + px-5 py-4 */}
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-title text-ink truncate">{title}</h2>
          {sub && (
            <p className="text-body-sm text-dusty mt-1 truncate">{sub}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className={noBodyPadding ? "" : bodyClassName}>{children}</div>
    </section>
  );
}

// ============================================================
// 대시보드 본체
// ============================================================

function Dashboard({ data }: { data: DatasetOverview }) {
  const districtsForMap: RegionStat[] = useMemo(
    () =>
      data.districts_top.map((d) => ({
        name: d.district,
        count: d.count,
        avg_score: 0,
        top_persona_uuid: null,
      })),
    [data.districts_top],
  );

  const mergedDemographics = useMemo(() => {
    const ageDemographic = {
      column: "age",
      label: "연령대",
      bins: data.age.histogram,
    };
    return [ageDemographic, ...data.demographics];
  }, [data]);

  return (
    <div className="flex flex-col gap-8">
      {/* 1. 페이지 헤더 */}
      <header className="flex flex-col gap-1.5">
        <p className="text-overline text-dusty">데이터셋 현황</p>
        <h1 className="text-display text-ink tracking-tight">
          {data.meta.total_rows.toLocaleString()}명의 합성 한국인 페르소나
        </h1>
        <p className="text-body text-graphite">
          {data.meta.source} · {data.meta.license} ·{" "}
          {data.meta.embedding_rows.toLocaleString()}건 ×{" "}
          {data.meta.embedding_dim}차원 임베딩
        </p>
      </header>

      {/* 2. anchor TOC — sticky */}
      <AnchorNav
        items={[
          { id: "kpi", label: "핵심 지표" },
          { id: "region", label: "지역 분포" },
          { id: "demo", label: "인구통계" },
          { id: "occupation", label: "직업군" },
          { id: "persona-text", label: "페르소나 텍스트" },
          { id: "source", label: "출처" },
        ]}
      />

      {/* 3. 핵심 지표 */}
      <SectionCard
        id="kpi"
        title="핵심 지표"
        sub="데이터셋 메타 요약 · 100만 행 기준"
      >
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <MetaCard
            label="총 페르소나"
            value={data.meta.total_rows.toLocaleString()}
            suffix="명"
          />
          <MetaCard
            label="시도"
            value={data.meta.total_provinces.toString()}
            suffix="개"
          />
          <MetaCard
            label="시군구"
            value={data.meta.total_districts.toString()}
            suffix="개"
          />
          <MetaCard
            label="직업 종류"
            value={data.meta.total_occupations.toLocaleString()}
            suffix="개"
          />
          <MetaCard
            label="평균 연령"
            value={data.age.mean.toString()}
            suffix="세"
          />
        </div>
      </SectionCard>

      {/* 4. 지역 — 지도 + 시도 막대 (12 col grid on xl) */}
      <section id="region" className="grid grid-cols-1 xl:grid-cols-12 gap-4 scroll-mt-24">
        <div className="xl:col-span-7">
          {/* KoreaMap이 자체적으로 SectionCard와 동일 스타일의 헤더를 가지므로 외부 wrap 생략 */}
          <KoreaMap districts={districtsForMap} title="시군구 인원 분포" />
        </div>
        <div className="xl:col-span-5 flex flex-col gap-4">
          <SectionCard
            title="시도별 인원"
            sub="17개 시도 · 인원 내림차순"
            noBodyPadding
          >
            <ProvinceBar rows={data.provinces} />
          </SectionCard>
        </div>
      </section>

      {/* 5. 인구통계 — 8개 카테고리 (4-col grid) */}
      <SectionCard
        id="demo"
        title="인구통계 분포"
        sub={`8개 카테고리 · ${data.meta.total_rows.toLocaleString()}명 기준`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {mergedDemographics.map((dem) => (
            <DemographicCard key={dem.column} dem={dem} ageData={data.age} />
          ))}
        </div>
      </SectionCard>

      {/* 6. 직업군 분포 */}
      <SectionCard
        id="occupation"
        title="직업군 분포"
        sub="KSCO 대분류 기반 17개 그룹 · 클릭하면 해당 그룹의 상위 직업이 표시됩니다"
        noBodyPadding
      >
        <OccupationsGroupPanel groups={data.occupations_grouped} />
      </SectionCard>

      {/* 7. 페르소나 텍스트 길이 + 카테고리 클릭 → 샘플 */}
      <div id="persona-text" className="scroll-mt-24">
        <PersonaTextPanel stats={data.persona_text_stats} />
      </div>

      {/* 8. 출처 */}
      <SourceCard meta={data.meta} />
    </div>
  );
}

// ============================================================
// AnchorNav — sticky 섹션 anchor 네비게이션
// ============================================================

function AnchorNav({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav
      aria-label="섹션 바로가기"
      className="sticky top-16 lg:top-20 z-20 -mx-4 lg:-mx-8 px-4 lg:px-8
                 bg-vellum/90 backdrop-blur border-y border-parchment"
    >
      <ul className="flex items-center gap-1 overflow-x-auto py-2 text-body-sm
                     scrollbar-thin scrollbar-thumb-parchment">
        {items.map((it) => (
          <li key={it.id} className="shrink-0">
            <a
              href={`#${it.id}`}
              className="inline-flex items-center px-3 py-1.5 rounded-[9.6px]
                         text-graphite hover:text-ink hover:bg-snow/80
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-azure
                         transition-colors"
            >
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ============================================================
// 메타 카드
// ============================================================

function MetaCard({
  label,
  value,
  suffix,
  sub,
}: {
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
}) {
  return (
    <div className="bg-snow border border-parchment rounded-[9.6px] px-4 py-3 flex flex-col gap-1">
      <p className="text-overline text-dusty">{label}</p>
      <p className="text-title text-ink truncate tabular-nums">
        {value}
        {suffix && (
          <span className="text-body-sm text-dusty ml-1 font-normal">{suffix}</span>
        )}
      </p>
      {sub && <p className="text-caption text-stone">{sub}</p>}
    </div>
  );
}

// ============================================================
// 지도 옆 패널들 — SectionCard로 래핑되어 헤더 통일
// ============================================================

function ProvinceBar({ rows }: { rows: ProvinceRow[] }) {
  return (
    <div className="p-3">
      <ResponsiveContainer width="100%" height={480}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#dedcd1" />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "#73726c", fontFamily: "SUITE" }}
            stroke="#dedcd1"
            tickFormatter={(v) => (v / 1000).toFixed(0) + "k"}
          />
          <YAxis
            type="category"
            dataKey="province"
            tick={{ fontSize: 11, fill: "#3d3d3a", fontFamily: "SUITE" }}
            stroke="#dedcd1"
            width={60}
          />
          <Tooltip
            cursor={{ fill: "rgba(217, 119, 87, 0.08)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload as ProvinceRow;
              return (
                <div className="bg-snow border border-parchment rounded-[9.6px] p-2.5 text-caption">
                  <p className="font-medium text-ink mb-1">{d.province}</p>
                  <p className="text-graphite">
                    인원:{" "}
                    <span className="font-medium text-terra">
                      {d.count.toLocaleString()}명
                    </span>
                  </p>
                  <p className="text-graphite">시군구: {d.district_count}개</p>
                  <p className="text-graphite">
                    평균 {d.avg_age.toFixed(1)}세 · 여성{" "}
                    {(d.female_ratio * 100).toFixed(1)}%
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="count" fill="#d97757" radius={[0, 4, 4, 0]}>
            <LabelList
              dataKey="count"
              position="right"
              fill="#3d3d3a"
              fontSize={11}
              fontFamily="SUITE"
              formatter={(v) => formatCompact(Number(v ?? 0))}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================================
// 인구통계 카드 — SectionCard와 별도 (작은 카드 다수)
// ============================================================

// 한화 토큰 기반 차트 팔레트.
// 1순위 terra(악센트) → 2순위 azure(보조 블루) → 그 이후 graphite→stone 단조 회색계로 강·약 그라데이션.
// 첫 두 자리에 채도 있는 색을 두어 4개 이상 항목에서도 1·2위가 즉시 구분되도록 함.
const DONUT_COLORS = ["#d97757", "#ccdbe8", "#3d3d3a", "#73726c", "#9c9a92", "#dedcd1", "#1f1e1d"];

function DemographicCard({
  dem,
  ageData,
}: {
  dem: DemographicColumn;
  ageData?: { mean: number; median: number };
}) {
  const useDonut = dem.bins.length <= 4;
  const total = dem.bins.reduce((s, b) => s + b.count, 0);

  const isAge = dem.column === "age";
  const subText = isAge && ageData
    ? `10년 단위 · 평균 ${ageData.mean}세 · 중위 ${ageData.median}세`
    : `${dem.bins.length}개 항목 · ${total.toLocaleString()}명`;

  return (
    <div className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden flex flex-col">
      <header className="px-3.5 py-2.5 border-b border-parchment">
        <h3 className="text-body font-medium text-ink truncate">{dem.label}</h3>
        <p className="text-caption text-dusty mt-0.5">
          {subText}
        </p>
      </header>
      <div className="p-3 flex-1">
        <ResponsiveContainer width="100%" height={useDonut ? 220 : 260}>
          {useDonut ? (
            <PieChart>
              <Pie
                data={dem.bins}
                dataKey="count"
                nameKey="label"
                innerRadius={42}
                outerRadius={74}
                paddingAngle={2}
                label={(entry) => {
                  const pct = (entry.percent ?? 0) * 100;
                  // 너무 작은 조각(<5%)은 라벨 생략해 시각 혼잡 방지
                  return pct < 5 ? "" : `${pct.toFixed(0)}%`;
                }}
                labelLine={false}
              >
                {dem.bins.map((_, i) => (
                  <Cell
                    key={i}
                    fill={DONUT_COLORS[i % DONUT_COLORS.length]}
                    stroke="#faf9f5"
                    strokeWidth={2}
                  />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload as DistributionBin;
                  const pct =
                    total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
                  return (
                    <div className="bg-snow border border-parchment rounded-[9.6px] p-2 text-caption">
                      <p className="font-medium text-ink">{d.label}</p>
                      <p className="text-graphite">
                        {d.count.toLocaleString()}명 · {pct}%
                      </p>
                    </div>
                  );
                }}
              />
            </PieChart>
          ) : (
            <BarChart
              data={dem.bins}
              layout="vertical"
              margin={{ top: 4, right: 56, bottom: 4, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#dedcd1" />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "#73726c", fontFamily: "SUITE" }}
                stroke="#dedcd1"
                tickFormatter={(v) => (v / 1000).toFixed(0) + "k"}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 10, fill: "#3d3d3a", fontFamily: "SUITE" }}
                stroke="#dedcd1"
                width={110}
                interval={0}
              />
              <Tooltip
                cursor={{ fill: "rgba(217, 119, 87, 0.08)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload as DistributionBin;
                  const pct =
                    total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
                  return (
                    <div className="bg-snow border border-parchment rounded-[9.6px] p-2 text-caption">
                      <p className="font-medium text-ink">{d.label}</p>
                      <p className="text-graphite">
                        {d.count.toLocaleString()} · {pct}%
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="count" fill="#d97757" radius={[0, 3, 3, 0]}>
                <LabelList
                  dataKey="count"
                  position="right"
                  fill="#3d3d3a"
                  fontSize={10}
                  fontFamily="SUITE"
                  formatter={(v) => {
                    const n = Number(v ?? 0);
                    return `${formatCompact(n)} · ${formatPercent(n, total)}`;
                  }}
                />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>

        {useDonut && (
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-caption">
            {dem.bins.map((b, i) => {
              const pct =
                total > 0 ? ((b.count / total) * 100).toFixed(1) : "0";
              return (
                <li key={b.label} className="flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{
                      background: DONUT_COLORS[i % DONUT_COLORS.length],
                    }}
                  />
                  <span className="text-graphite truncate">{b.label}</span>
                  <span className="text-dusty ml-auto">{pct}%</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 직업군 — 좌 그룹 / 우 Top 5
// ============================================================

function OccupationsGroupPanel({ groups }: { groups: OccupationGroup[] }) {
  const total = groups.reduce((s, g) => s + g.count, 0);
  const unemployedCount =
    groups.find((g) => g.group === "무직")?.count ?? 0;
  const employedTotal = total - unemployedCount;

  // 분모 토글: 전체(영유아·학생·은퇴자 포함) vs 취업자만
  // 기본값은 "취업자만" — Nemotron 소개 페이지의 직업 분포(전문가·사무직 우세)와 같은 시각을
  // 처음부터 보여줘 무직 36.7%로 인한 혼란을 방지. 전체 보고 싶으면 토글로 전환.
  const [denominator, setDenominator] = useState<"all" | "employed">("employed");

  // 표시 그룹: 취업자만 모드에서는 무직 제거 + ratio를 employedTotal로 재계산
  const displayGroups = useMemo<OccupationGroup[]>(() => {
    if (denominator === "all") return groups;
    if (employedTotal <= 0) return groups;
    return groups
      .filter((g) => g.group !== "무직")
      .map((g) => ({ ...g, ratio: g.count / employedTotal }));
  }, [groups, denominator, employedTotal]);

  const defaultSelection =
    displayGroups.find((g) => g.group !== "무직" && g.group !== "기타")?.group ??
    displayGroups[0]?.group ??
    null;
  const [selected, setSelected] = useState<string | null>(defaultSelection);

  // 토글로 선택된 그룹이 사라진 경우(예: "무직" 선택 중 → "취업자만")는 첫 항목으로 복구
  useEffect(() => {
    if (!displayGroups.find((g) => g.group === selected)) {
      setSelected(displayGroups[0]?.group ?? null);
    }
  }, [displayGroups, selected]);

  const selectedGroup = useMemo(
    () => displayGroups.find((g) => g.group === selected) ?? null,
    [displayGroups, selected],
  );

  return (
    <div className="flex flex-col">
      {/* 분모 토글 */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-parchment bg-snow/40 flex-wrap">
        <p className="text-caption text-dusty">
          분모 — 영유아·학생·은퇴자 등을 포함할지 선택
        </p>
        <div className="inline-flex rounded-[9.6px] border border-parchment bg-vellum p-0.5">
          {(["all", "employed"] as const).map((v) => {
            const isOn = denominator === v;
            const label =
              v === "all"
                ? `전체 ${total.toLocaleString()}명`
                : `취업자만 ${employedTotal.toLocaleString()}명`;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setDenominator(v)}
                className={`px-3 py-1 text-caption rounded-[8px] transition-colors tabular-nums ${
                  isOn
                    ? "bg-snow text-ink font-medium shadow-sm"
                    : "text-graphite hover:text-ink"
                }`}
                aria-pressed={isOn}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-0">
      {/* 좌측: 그룹 막대 */}
      <ul className="divide-y divide-parchment max-h-[640px] overflow-auto">
        {displayGroups.map((g) => {
          const isSel = g.group === selected;
          const isNoJob = g.group === "무직";
          const isEtc = g.group === "기타";
          const barColor = isNoJob
            ? "bg-stone"
            : isEtc
              ? "bg-dusty/60"
              : "bg-terra";
          return (
            <li key={g.group}>
              <button
                type="button"
                onClick={() => setSelected(g.group)}
                className={`w-full text-left px-4 py-3 transition-colors ${
                  isSel ? "bg-snow" : "hover:bg-snow/70"
                }`}
                aria-pressed={isSel}
              >
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <span
                    className={`text-body-sm font-medium ${
                      isSel ? "text-ink" : "text-graphite"
                    }`}
                  >
                    {g.group}
                  </span>
                  <span className="text-caption text-dusty shrink-0 font-mono">
                    {g.count.toLocaleString()}
                    <span className="text-stone ml-1">
                      ({(g.ratio * 100).toFixed(1)}%)
                    </span>
                  </span>
                </div>
                <div className="h-1.5 bg-parchment rounded-full overflow-hidden">
                  <div
                    className={`h-full ${barColor} transition-all`}
                    style={{
                      width: `${(g.count / (displayGroups[0]?.count || 1)) * 100}%`,
                    }}
                  />
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <aside className="lg:border-l border-t lg:border-t-0 border-parchment bg-snow/60 p-4 lg:max-h-[640px] lg:overflow-auto">
        {selectedGroup ? (
          <>
            <p className="text-caption text-dusty uppercase">선택 그룹</p>
            <p className="text-title text-ink mt-1">{selectedGroup.group}</p>
            <p className="text-caption text-graphite mt-1">
              {selectedGroup.count.toLocaleString()}명 ·{" "}
              {denominator === "all" ? "전체 분모" : "취업자 분모"}{" "}
              <span className="text-terra font-medium">
                {(selectedGroup.ratio * 100).toFixed(1)}%
              </span>
            </p>

            <p className="text-caption text-dusty uppercase mt-4 mb-2">
              Top {selectedGroup.top_jobs.length} 직업
            </p>
            {selectedGroup.top_jobs.length === 0 ? (
              <p className="text-caption text-dusty">표시할 직업 없음</p>
            ) : (
              <ol className="space-y-2">
                {selectedGroup.top_jobs.map((j, i) => {
                  const inGroupPct =
                    selectedGroup.count > 0
                      ? (j.count / selectedGroup.count) * 100
                      : 0;
                  return (
                    <li key={j.label} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-body-sm text-ink flex items-baseline gap-2">
                          <span className="text-caption text-stone font-mono">
                            {i + 1}.
                          </span>
                          {j.label}
                        </span>
                        <span className="text-caption text-dusty font-mono shrink-0">
                          {j.count.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1 bg-parchment rounded-full overflow-hidden">
                        <div
                          className="h-full bg-terra/80"
                          style={{ width: `${inGroupPct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {total > 0 && (
              <p className="text-caption text-dusty mt-4 pt-3 border-t border-parchment">
                {denominator === "all"
                  ? `전체 ${total.toLocaleString()}명 중`
                  : `취업자 ${employedTotal.toLocaleString()}명 중 (무직 ${unemployedCount.toLocaleString()}명 제외)`}
              </p>
            )}
          </>
        ) : (
          <p className="text-caption text-dusty">왼쪽에서 그룹을 선택하세요</p>
        )}
      </aside>
      </div>
    </div>
  );
}

// ============================================================
// 페르소나 텍스트 — 길이 표 클릭 시 우측에 샘플 펼침
// ============================================================

function PersonaTextPanel({
  stats,
}: {
  stats: DatasetOverview["persona_text_stats"];
}) {
  const defaultCol = (stats[0]?.column as PersonaTextColumn | undefined) ?? "persona";
  const [selected, setSelected] = useState<PersonaTextColumn>(defaultCol);
  const [samples, setSamples] = useState<PersonaSample[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPersonaSamples(selected, 6)
      .then((r) => {
        if (!cancelled) setSamples(r.samples);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <SectionCard
      title="페르소나 텍스트 미리보기"
      sub="종합 + 6개 카테고리 페르소나의 글자 수 분포와 실제 샘플 텍스트 · 카테고리를 클릭하면 샘플이 바뀝니다"
      noBodyPadding
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.4fr] gap-0">
        {/* 좌측: 길이 표 + 선택 */}
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead className="bg-snow/60">
              <tr className="text-left text-caption text-dusty">
                <th className="px-4 py-2 font-medium">카테고리</th>
                <th className="px-4 py-2 font-medium text-right">평균</th>
                <th className="px-4 py-2 font-medium text-right">최소</th>
                <th className="px-4 py-2 font-medium text-right">최대</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => {
                const isSel = s.column === selected;
                return (
                  <tr
                    key={s.column}
                    onClick={() => setSelected(s.column as PersonaTextColumn)}
                    className={`border-t border-parchment cursor-pointer transition-colors ${
                      isSel
                        ? "bg-snow"
                        : "hover:bg-snow/70 text-graphite"
                    }`}
                  >
                    <td
                      className={`px-4 py-2 ${
                        isSel ? "text-ink font-medium" : "text-ink"
                      }`}
                    >
                      {isSel && (
                        <span className="inline-block w-1 h-3 bg-terra rounded-full mr-2 align-middle" />
                      )}
                      {s.label}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{s.mean}</td>
                    <td className="px-4 py-2 text-right font-mono text-dusty">
                      {s.min}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-dusty">
                      {s.max}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 우측: 샘플 */}
        <div className="border-t lg:border-t-0 lg:border-l border-parchment bg-snow/60">
          <div className="px-4 py-3 border-b border-parchment">
            <p className="text-caption text-dusty uppercase">선택 카테고리</p>
            <p className="text-base font-medium text-ink mt-0.5">
              {stats.find((s) => s.column === selected)?.label ?? selected} ·
              샘플 6건
              <span className="ml-2 text-caption text-dusty">
                (가장 긴 + 가장 짧은)
              </span>
            </p>
          </div>
          {loading && (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 bg-parchment/40 rounded animate-pulse"
                />
              ))}
            </div>
          )}
          {error && (
            <p className="p-4 text-caption text-terra">{error}</p>
          )}
          {!loading && !error && samples.length > 0 && (
            <ul className="divide-y divide-parchment max-h-[440px] overflow-auto">
              {samples.map((s) => (
                <li key={s.uuid} className="p-3">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-caption text-graphite">
                      {s.sex} {s.age}세 · {s.province} {s.district}
                      <span className="text-dusty"> · {s.occupation}</span>
                    </span>
                    <span className="text-caption font-mono text-dusty shrink-0">
                      {s.length}자
                    </span>
                  </div>
                  <p className="text-body-sm text-ink leading-relaxed">
                    {s.text}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

// ============================================================
// 출처
// ============================================================

function SourceCard({ meta }: { meta: DatasetOverview["meta"] }) {
  return (
    <SectionCard
      id="source"
      title="데이터 출처 · 라이선스"
      sub="합성 데이터 — 실제 인물·가입자와 무관"
    >
      <div className="text-body-sm text-graphite space-y-1.5">
        <p>
          <a
            href={`https://huggingface.co/datasets/${meta.source}`}
            target="_blank"
            rel="noreferrer"
            className="text-ink underline underline-offset-2 hover:text-terra"
          >
            {meta.source}
          </a>{" "}
          — {meta.license} (상업적 이용 가능, 출처 명시 필수)
        </p>
        <p className="text-caption text-dusty">
          NVIDIA NeMo Data Designer · KOSIS / 대법원 / 국민건강보험공단 / KREI 통계 기반 합성.
        </p>
      </div>
    </SectionCard>
  );
}

// ============================================================
// Loading / Error
// ============================================================

/**
 * 첫 방문 시 데이터셋 통계 fetch 동안 노출되는 스켈레톤.
 *
 * 설계:
 * - 실제 Dashboard와 동일한 섹션 구조·그리드·높이를 placeholder로 재현 → CLS(layout shift) 최소화
 * - SectionCard wrapper를 그대로 재사용해 헤더 톤·간격을 실제와 일치시킴(헤더 텍스트는 실제 라벨 사용)
 * - animate-pulse + motion-reduce:animate-none 으로 접근성 대응
 * - 페이지 하단에 진행 안내 한 줄
 */
function LoadingState() {
  return (
    <div className="flex flex-col gap-8 animate-pulse motion-reduce:animate-none">
      {/* 1. 페이지 헤더 — text-display + 부제 */}
      <header className="flex flex-col gap-2.5">
        <div className="h-3 w-24 rounded bg-snow border border-parchment" />
        <div className="h-10 w-3/4 sm:w-1/2 rounded-[7px] bg-snow border border-parchment" />
        <div className="h-4 w-2/3 sm:w-1/3 rounded bg-snow border border-parchment" />
      </header>

      {/* 2. AnchorNav 자리 */}
      <div className="h-10 rounded-[9.6px] bg-snow border border-parchment" />

      {/* 3. 핵심 지표 — KPI 5장 */}
      <SectionCard title="핵심 지표" sub="데이터셋 메타 요약 · 100만 행 기준">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonMetaCard key={i} />
          ))}
        </div>
      </SectionCard>

      {/* 4. 지역 — 지도(7) + 시도 막대(5) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-7">
          <SectionCard
            title="시군구 인원 분포"
            sub="252개 시군구 · 인원 내림차순"
            noBodyPadding
          >
            <div className="h-[480px] bg-snow flex items-center justify-center">
              <div className="w-2/3 h-2/3 rounded-[9.6px] bg-vellum border border-parchment" />
            </div>
          </SectionCard>
        </div>
        <div className="xl:col-span-5">
          <SectionCard
            title="시도별 인원"
            sub="17개 시도 · 인원 내림차순"
            noBodyPadding
          >
            <div className="h-[480px] bg-snow p-4 flex flex-col gap-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <SkeletonBarRow key={i} width={`${95 - i * 7}%`} />
              ))}
            </div>
          </SectionCard>
        </div>
      </section>

      {/* 5. 인구통계 — 8개 카드 (4-col) */}
      <SectionCard title="인구통계 분포" sub="8개 카테고리 · 1,000,000명 기준">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonDemographicCard key={i} />
          ))}
        </div>
      </SectionCard>

      {/* 6. 직업군 분포 — 좌 그룹 / 우 Top 5 */}
      <SectionCard
        title="직업군 분포"
        sub="KSCO 대분류 기반 17개 그룹"
        noBodyPadding
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 bg-snow">
          <div className="flex flex-col gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <SkeletonBarRow key={i} width={`${90 - i * 7}%`} />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-10 rounded-[7px] bg-vellum border border-parchment"
              />
            ))}
          </div>
        </div>
      </SectionCard>

      {/* 7. 페르소나 텍스트 — 7개 행 */}
      <SectionCard
        title="페르소나 텍스트 길이"
        sub="7개 카테고리 · 카드 클릭 시 샘플 펼침"
        noBodyPadding
      >
        <div className="p-4 flex flex-col gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="h-12 rounded-[7px] bg-snow border border-parchment"
            />
          ))}
        </div>
      </SectionCard>

      {/* 8. 출처 */}
      <SectionCard title="데이터 출처">
        <div className="space-y-2">
          <div className="h-4 w-1/2 rounded bg-snow border border-parchment" />
          <div className="h-4 w-1/3 rounded bg-snow border border-parchment" />
        </div>
      </SectionCard>

      <p className="text-center text-caption text-dusty">
        100만 행 데이터셋 통계를 집계하고 있습니다…
      </p>
    </div>
  );
}

// ============================================================
// 스켈레톤 하위 부품 — 한화 톤(snow/vellum/parchment) 만 사용
// ============================================================

function SkeletonMetaCard() {
  return (
    <div className="h-24 rounded-[9.6px] bg-snow border border-parchment p-3 flex flex-col gap-2">
      <div className="h-3 w-12 rounded bg-vellum border border-parchment" />
      <div className="h-6 w-20 rounded bg-vellum border border-parchment" />
      <div className="h-3 w-16 rounded bg-vellum border border-parchment mt-auto" />
    </div>
  );
}

function SkeletonDemographicCard() {
  return (
    <div className="h-48 rounded-[9.6px] bg-snow border border-parchment p-3 flex flex-col gap-2">
      <div className="h-3 w-16 rounded bg-vellum border border-parchment" />
      <div className="h-3 w-24 rounded bg-vellum border border-parchment" />
      <div className="flex-1 rounded bg-vellum border border-parchment" />
    </div>
  );
}

/** 가로 막대 1줄 — 라벨(고정) + 막대(가변 너비). */
function SkeletonBarRow({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-3 w-16 rounded bg-vellum border border-parchment shrink-0" />
      <div
        className="h-3 rounded bg-vellum border border-parchment"
        style={{ width }}
      />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-terra/10 border border-terra/30 rounded-[9.6px] p-6 text-ink">
      <p className="font-medium mb-1">현황 불러오기 실패</p>
      <p className="text-caption text-graphite">{message}</p>
      <p className="text-caption text-dusty mt-2">
        백엔드(personafit-api)가 가동 중인지, /api/dataset/overview가 정상
        응답하는지 확인 부탁드립니다.
      </p>
    </div>
  );
}
