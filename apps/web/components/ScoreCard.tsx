import type { AnalyzeResponse } from "@/lib/api";
import { CountUp } from "@/components/CountUp";

type Props = {
  result: AnalyzeResponse;
};

/**
 * 분석 결과 상단 KPI 카드.
 *
 * 데이터 기준: **100만 행 모집단 통계(PopulationStats)**.
 * - 우상단 큰 점수: 핵심 타겟(상위 0.5%)의 평균 반응 강도 + 모집단 평균 대비 lift.
 *   (진입 점수=min_score는 v3에서 81 고정이라 무의미 → '평균 반응 강도'를 헤드라인으로
 *    승격하고, 이미 계산돼 버려지던 core_lift를 '모집단 평균 대비 +N점'으로 노출한다.)
 * - 4분면 메트릭: 핵심 타겟 인원 / 타겟층 인원 / 공략 1순위 시도 / 100만 전수 스코어링
 *
 * 100만 규모를 체감시키도록 핵심 수치는 CountUp(0→목표값)으로 굴러오른다.
 */
export function ScoreCard({ result }: Props) {
  const { selling_points, elapsed_ms, population_stats } = result;
  const { cohorts, demographics, total_scored } = population_stats;
  const coreLift = population_stats.core_lift;
  const rawMean = population_stats.raw_mean;

  const core = cohorts.find((c) => c.name === "core");
  const target = cohorts.find((c) => c.name === "target");

  // 핵심 타겟 진입 점수 (참조용) + 평균 반응 강도(헤드라인)
  const coreScore = core?.min_score ?? 0;
  const hasCore = !!core && core.size > 0;
  // core가 비면(저매력 제품) 진입 컷으로 폴백 — 옛 이력/공허 cohort 안전 처리
  const heroValue = hasCore ? (core?.avg_score ?? 0) : coreScore;
  const heroLabel = hasCore ? "핵심 타겟 반응 강도" : "핵심 타겟 진입 점수";
  const showLift = hasCore && coreLift != null && rawMean != null;

  // 타겟층 5만 명 기준 1순위 시도
  const provinceGroup = demographics.find((g) => g.column === "province");
  const topProvince = provinceGroup?.bins[0];
  const targetSize = target?.size ?? 0;
  const topProvincePct =
    topProvince && targetSize > 0
      ? (topProvince.count / targetSize) * 100
      : 0;

  const totalMs = elapsed_ms.total ?? 0;

  // 다크(ink) 헤더 위 대비 확보 — 높음=terra(브랜드), 중간=azure, 낮음=stone(약함 신호).
  // 임계는 v3 cohort 컷(core 81 / target 73)과 정합.
  const scoreTone =
    heroValue >= 81
      ? "text-terra"
      : heroValue >= 73
        ? "text-azure"
        : "text-stone";

  return (
    <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
      <div className="bg-ink text-snow px-4 py-4 sm:px-5 sm:py-5 flex flex-col md:flex-row md:items-start md:justify-between gap-4 sm:gap-5">
        <div className="flex-1 min-w-0">
          <p className="text-overline text-snow/60">상품 요약</p>
          <p className="text-title text-snow mt-1.5 sm:mt-2 line-clamp-3">
            {selling_points.summary}
          </p>
        </div>
        <div className="shrink-0 md:text-right">
          <p className="text-overline text-snow/60">{heroLabel}</p>
          <p className={`text-display font-mono mt-1 ${scoreTone}`}>
            <CountUp value={heroValue} decimals={1} />
            <span className="text-body text-snow/60 ml-1 font-normal">
              /100
            </span>
          </p>
          {showLift ? (
            <p className="text-caption mt-1.5 inline-flex items-center gap-1.5 md:justify-end num-tabular">
              <span className="inline-flex items-center gap-0.5 font-semibold text-terra">
                <span aria-hidden>▲</span> +{coreLift!.toFixed(1)}점
              </span>
              <span className="text-snow/55">
                모집단 평균 {rawMean!.toFixed(1)} 대비
              </span>
            </p>
          ) : null}
          <p className="text-caption text-snow/50 mt-1 num-tabular">
            전체 {total_scored.toLocaleString()}명 전수 스코어링 · 상위 0.5%
            {hasCore ? ` 평균 (진입 ≥${coreScore.toFixed(0)})` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-parchment">
        <Metric
          label="핵심 타겟"
          countTo={core?.size ?? 0}
          suffix="명"
          sub={
            core
              ? `평균 ${core.avg_score.toFixed(1)} · 상위 ${core.percentile}%`
              : undefined
          }
        />
        <Metric
          label="타겟층"
          countTo={targetSize}
          suffix="명"
          sub={
            target
              ? `≥ ${target.min_score.toFixed(1)} · 상위 ${target.percentile}%`
              : undefined
          }
        />
        <Metric
          label="공략 1순위 (타겟층 기준)"
          value={topProvince?.label ?? "-"}
          sub={
            topProvince
              ? `${topProvince.count.toLocaleString()}명 (${topProvincePct.toFixed(1)}%)`
              : undefined
          }
        />
        <Metric
          label="100만 전수 스코어링"
          value={(totalMs / 1000).toFixed(1)}
          suffix="초"
          sub={`${total_scored.toLocaleString()}명 전수`}
        />
      </div>

      {selling_points.key_benefits.length > 0 && (
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-t border-parchment bg-snow/60">
          <p className="text-overline text-dusty mb-2">핵심 혜택</p>
          <ul className="flex flex-wrap gap-2">
            {selling_points.key_benefits.map((b) => (
              <li
                key={b}
                className="text-body-sm bg-vellum text-graphite px-3 py-1 rounded-[9.6px] border border-parchment"
              >
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  countTo,
  suffix,
  sub,
}: {
  label: string;
  /** 문자열 값 (지역명 등). countTo가 있으면 무시. */
  value?: string;
  /** 숫자 값 — 제공 시 CountUp(0→값)으로 굴러오름. 100만 규모 체감용. */
  countTo?: number;
  suffix?: string;
  sub?: string;
}) {
  return (
    <div className="px-3 py-3 sm:px-5 sm:py-4">
      <p className="text-overline text-dusty truncate">{label}</p>
      <p className="text-heading sm:text-title text-ink mt-1.5 truncate num-tabular">
        {countTo != null ? (
          <CountUp value={countTo} />
        ) : (
          value
        )}
        {suffix && (
          <span className="text-body-sm text-dusty ml-1 font-normal">
            {suffix}
          </span>
        )}
      </p>
      {sub && <p className="text-caption text-stone mt-1">{sub}</p>}
    </div>
  );
}
