import type { AnalyzeResponse } from "@/lib/api";

type Props = {
  result: AnalyzeResponse;
};

/**
 * 분석 결과 상단 KPI 카드.
 *
 * 데이터 기준: **100만 행 모집단 통계(PopulationStats)**.
 * - 우상단 큰 점수: 핵심 타겟(상위 0.5%)의 진입 임계 점수 (이 점수 이상이어야 핵심 타겟)
 * - 4분면 메트릭:
 *   1) 핵심 타겟 인원 (상위 0.5%, 평균 점수 함께)
 *   2) 타겟층 인원 (상위 5%)
 *   3) 타겟층 1순위 시도 (인구 비례 %)
 *   4) 분석 소요 시간
 */
export function ScoreCard({ result }: Props) {
  const { selling_points, elapsed_ms, population_stats } = result;
  const { cohorts, demographics, total_scored } = population_stats;

  const core = cohorts.find((c) => c.name === "core");
  const target = cohorts.find((c) => c.name === "target");

  // 핵심 타겟 진입 점수 (이상이면 상위 0.5%)
  const coreScore = core?.min_score ?? 0;

  // 타겟층 5만 명 기준 1순위 시도
  const provinceGroup = demographics.find((g) => g.column === "province");
  const topProvince = provinceGroup?.bins[0];
  const targetSize = target?.size ?? 0;
  const topProvincePct =
    topProvince && targetSize > 0
      ? (topProvince.count / targetSize) * 100
      : 0;

  const totalMs = elapsed_ms.total ?? 0;

  const scoreTone =
    coreScore >= 80
      ? "text-terra"
      : coreScore >= 65
        ? "text-azure"
        : "text-parchment";

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
          <p className="text-overline text-snow/60">핵심 타겟 진입 점수</p>
          <p className={`text-display font-mono mt-1 ${scoreTone}`}>
            {coreScore.toFixed(1)}
            <span className="text-body text-snow/60 ml-1 font-normal">
              /100
            </span>
          </p>
          <p className="text-caption text-snow/50 mt-1 num-tabular">
            전체 {total_scored.toLocaleString()}명 기준 상위 0.5%
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-parchment">
        <Metric
          label="핵심 타겟"
          value={(core?.size ?? 0).toLocaleString()}
          suffix="명"
          sub={
            core
              ? `평균 ${core.avg_score.toFixed(1)} · 상위 ${core.percentile}%`
              : undefined
          }
        />
        <Metric
          label="타겟층"
          value={targetSize.toLocaleString()}
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
          label="분석 소요"
          value={(totalMs / 1000).toFixed(1)}
          suffix="초"
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
  suffix,
  sub,
}: {
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
}) {
  return (
    <div className="px-3 py-3 sm:px-5 sm:py-4">
      <p className="text-overline text-dusty truncate">{label}</p>
      <p className="text-heading sm:text-title text-ink mt-1.5 truncate num-tabular">
        {value}
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
