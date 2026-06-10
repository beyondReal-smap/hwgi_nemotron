"use client";

import { DemographicCard } from "@/components/DistributionCharts";
import type {
  CohortStat,
  DistributionBin,
  PopulationStats,
} from "@/lib/api";

type Props = {
  stats: PopulationStats;
};

export function PopulationStatsPanel({ stats }: Props) {
  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">전국 모집단 통계</h2>
        <p className="text-body-sm text-dusty mt-1">
          전체 {stats.total_scored.toLocaleString()}명의 페르소나를 스코어링하여
          산출한 인구통계 분포 (Nemotron 카테고리형 컬럼 전체)
        </p>
        <QualityFlagBadges flags={stats.quality_flags} />
      </header>

      <RawStatsBox stats={stats} />

      <CohortStrip cohorts={stats.cohorts} totalScored={stats.total_scored} />

      <ScoreDistributionBar
        bins={stats.score_distribution}
        cohorts={stats.cohorts}
      />

      <div className="border-t border-parchment p-4 sm:p-5">
        <h3 className="text-heading text-ink mb-1">
          인구통계 분포
        </h3>
        <p className="text-body-sm text-dusty mb-4">
          타겟층({stats.cohorts.find((c) => c.name === "target")?.size.toLocaleString()}명)
          기준 — 점수 ≥{" "}
          {stats.cohorts.find((c) => c.name === "target")?.min_score.toFixed(1)}
        </p>

        {/* 현황(overview)과 동일한 차트 카드로 통일 — DemographicGroup → DemographicColumn 어댑터.
            (total_unique/truncated_to는 차트 카드 subText에 미표시, 스타일 일관 우선) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {stats.demographics
            // 병역(military_status)은 분석 결과 차트에서 제외 (A/B 결과 패널과 동일 정책)
            .filter((g) => g.column !== "military_status")
            .map((g) => (
              <DemographicCard
                key={g.column}
                dem={{ column: g.column, label: g.label, bins: g.bins }}
              />
            ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// raw 분포 통계 박스 (PR-1) — 분포가 [52,78]로 좁아 cohort 인원만으론
// 안 간 매력도 차이가 안 보이는 문제 보완.
// ============================================================

function RawStatsBox({ stats }: { stats: PopulationStats }) {
  // 옛 분석은 raw 통계 필드가 없음 — 안전하게 렌더 생략
  if (stats.raw_mean == null) return null;
  const tiles: Array<{ label: string; value: string; title?: string }> = [
    { label: "평균", value: stats.raw_mean.toFixed(1) },
    { label: "표준편차", value: (stats.raw_std ?? 0).toFixed(2) },
    { label: "중위 (p50)", value: (stats.raw_p50 ?? 0).toFixed(0) },
    { label: "p95", value: (stats.raw_p95 ?? 0).toFixed(0) },
    { label: "p99", value: (stats.raw_p99 ?? 0).toFixed(0) },
    { label: "최대", value: (stats.raw_max ?? 0).toFixed(0) },
    {
      label: "≥80 ('매우 높음')",
      value: (stats.n_above_80 ?? 0).toLocaleString(),
      title: "raw 점수 80 이상 인원 — UI/LLM이 '매우 높음'으로 해석하는 컷",
    },
    {
      label: "≥65 ('높음')",
      value: (stats.n_above_65 ?? 0).toLocaleString(),
      title: "raw 점수 65 이상 인원",
    },
  ];
  return (
    <div className="border-b border-parchment px-4 py-3 sm:px-5 sm:py-3 bg-snow/40">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-overline text-graphite">raw 점수 분포 요약</p>
        {stats.scoring_version !== "v2_hybrid" && (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] text-overline font-medium border bg-stone/15 text-graphite border-stone/30"
            title="구 점수 체계(percentile-rank 균등매핑)로 산출된 분석입니다. 신 분석과 점수·인원 직접 비교에 주의하세요."
          >
            구 점수 체계
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {tiles.map((t) => (
          <div key={t.label} title={t.title}>
            <p className="text-overline text-dusty leading-tight">{t.label}</p>
            <p className="text-body-sm font-semibold text-ink num-tabular tabular-nums">
              {t.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 품질 경고 배지 (PR-1) — 분포 비정상/cohort 의미 약화 자동 감지
// ============================================================

const FLAG_META: Record<string, { label: string; tone: "warn" | "info" }> = {
  distribution_narrow: {
    label: "핵심층 공허 — 제품 매력도 낮음",
    tone: "warn",
  },
  core_low_lift: {
    label: "핵심층이 모집단 평균과 비슷한 수준 — 상품 매력도 낮음",
    tone: "warn",
  },
  mode_inconsistent: {
    label: "cohort 컷 모드 혼재",
    tone: "info",
  },
};

function QualityFlagBadges({ flags }: { flags?: string[] }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {flags.map((f) => {
        const meta = FLAG_META[f];
        if (!meta) return null;
        const isWarn = meta.tone === "warn";
        const tone = isWarn
          ? "bg-warning/12 text-ink border-warning/40"
          : "bg-info/12 text-ink border-info/40";
        return (
          <span
            key={f}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] text-overline font-medium border ${tone}`}
          >
            <FlagIcon warn={isWarn} />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

/** 품질 플래그 아이콘 — 경고(삼각형)/정보(원) 모양으로 색 없이도 구분. */
function FlagIcon({ warn }: { warn: boolean }) {
  if (warn) {
    return (
      <svg
        viewBox="0 0 12 12"
        className="w-3 h-3 shrink-0 text-warning"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6 1.9l4.6 8H1.4z" />
        <path d="M6 5.2v2.1M6 8.9v.02" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 12 12"
      className="w-3 h-3 shrink-0 text-info"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="6" cy="6" r="4.6" />
      <path d="M6 5.4v2.4M6 3.9v.02" />
    </svg>
  );
}

// ============================================================
// Cohort 요약 띠
// ============================================================

function CohortStrip({
  cohorts,
  totalScored,
}: {
  cohorts: CohortStat[];
  totalScored: number;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-parchment">
      {cohorts.map((c) => {
        // 옛 이력 호환: mode/threshold_absolute가 없는 분석은 기존(percentile 고정) 표기 유지
        const hasAbsField = c.threshold_absolute !== undefined && c.mode !== undefined;
        const isAbsolute = hasAbsField && c.mode === "absolute";
        const sharePct = (c.size / totalScored) * 100;
        return (
          <div key={c.name} className="px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-body font-semibold text-ink">{c.label}</p>
              {!hasAbsField ? (
                <p className="text-caption text-dusty num-tabular">
                  상위 {c.percentile}%
                </p>
              ) : isAbsolute ? (
                <p className="text-caption text-terra num-tabular font-medium">
                  ≥{c.threshold_absolute!.toFixed(0)}점 기준
                </p>
              ) : (
                <p
                  className="text-caption text-dusty num-tabular"
                  title={`절대 컷(≥${c.threshold_absolute!.toFixed(0)}점) 인원이 부족해 모집단 상위 ${c.percentile}%로 폴백`}
                >
                  상위 {c.percentile}% 폴백
                </p>
              )}
            </div>
            <p className="text-title font-semibold text-ink num-tabular mt-1.5">
              {c.size.toLocaleString()}
              <span className="text-body-sm font-normal text-dusty ml-1">명</span>
            </p>
            <p className="text-caption text-dusty num-tabular mt-1.5">
              점수 ≥ {c.min_score.toFixed(1)} · 평균 {c.avg_score.toFixed(1)} ·{" "}
              전체의 {sharePct.toFixed(2)}%
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// 점수 히스토그램
// ============================================================

function ScoreDistributionBar({
  bins,
  cohorts,
}: {
  bins: DistributionBin[];
  cohorts: CohortStat[];
}) {
  if (bins.length === 0) return null;

  // y축: 선형 스케일. 로그 스케일은 5배 차이도 막대 길이 19%로만 보여 사용자 직관과
  // 어긋남(예: 8,400 vs 47,000). cohort 컷오프 수직선이 영역을 구분해주므로 hockey-stick은
  // 영역 라벨로 보완. 작은 tail bin은 minHeight 2px로 가시성 확보.
  const counts = bins.map((b) => b.count);
  const totalSeen = counts.reduce((a, b) => a + b, 0);
  const maxCount = Math.max(...counts);

  const coreMin = cohorts.find((c) => c.name === "core")?.min_score ?? 100;
  const targetMin = cohorts.find((c) => c.name === "target")?.min_score ?? 100;
  const interestMin = cohorts.find((c) => c.name === "interest")?.min_score ?? 0;

  // bin 라벨 "{start}~{end}" 파싱 → bin 시작 점수 배열
  const binStarts = bins.map((b) => Number(b.label.split("~")[0]));
  const binEnds = bins.map((b) => Number(b.label.split("~")[1]));
  const xMin = binStarts[0] ?? 0;
  const xMax = binEnds[binEnds.length - 1] ?? 100;
  const xRange = Math.max(1, xMax - xMin);

  // 컷오프 점수의 x축 위치(%) — bin 폭이 0이면 절대 안 들어오지만 방어
  const pct = (score: number) => {
    if (score <= xMin) return 0;
    if (score >= xMax) return 100;
    return ((score - xMin) / xRange) * 100;
  };

  const cutoffs = [
    { score: coreMin, color: "bg-terra", label: "핵심", text: "text-terra" },
    { score: targetMin, color: "bg-azure", label: "타겟", text: "text-azure" },
    { score: interestMin, color: "bg-graphite", label: "관심", text: "text-graphite" },
  ];

  // 스크린리더 요약: role='img' aria-label에 전체 인원·점수 범위·cohort 컷을 상세화.
  // 하단 sr-only에 bin별 인원/비중을 텍스트로 제공해 그래프를 못 보는 사용자도 데이터 접근 가능.
  const histogramLabel =
    `점수 히스토그램 (전체 모집단). 표시 인원 ${totalSeen.toLocaleString()}명, ` +
    `점수 범위 ${xMin}점부터 ${xMax}점. ` +
    `코호트 컷오프: 핵심 ≥${coreMin.toFixed(1)}점, 타겟 ≥${targetMin.toFixed(1)}점, ` +
    `관심 ≥${interestMin.toFixed(1)}점.`;

  return (
    <div className="border-t border-parchment px-4 py-3 sm:px-5 sm:py-4">
      <h3 className="text-heading text-ink mb-1">점수 분포</h3>
      <p className="text-body-sm text-dusty mb-3">
        전체 모집단 100만 명의 점수 분포 (5점 단위). 세로 선은 각 계층의 시작 점수를 표시합니다.
      </p>
      <div
        className="relative flex items-end gap-1 h-32"
        role="img"
        aria-label={histogramLabel}
        aria-describedby="score-distribution-sr-data"
      >
        {bins.map((b, i) => {
          const binStart = binStarts[i];
          const isCore = binStart >= coreMin;
          const isTarget = !isCore && binStart >= targetMin;
          const isInterest = !isCore && !isTarget && binStart >= interestMin;
          const bg = isCore
            ? "bg-terra"
            : isTarget
              ? "bg-azure"
              : isInterest
                ? "bg-graphite/40"
                : "bg-parchment";
          const heightPct = maxCount > 0 ? (b.count / maxCount) * 100 : 0;
          const sharePct = totalSeen > 0 ? (b.count / totalSeen) * 100 : 0;
          return (
            <div
              key={b.label}
              className={`flex-1 ${bg} rounded-t-[2px] transition-all`}
              style={{
                height: `${heightPct}%`,
                minHeight: b.count > 0 ? "2px" : "0",
              }}
              title={`${b.label}점: ${b.count.toLocaleString()}명 (${sharePct.toFixed(2)}%)`}
            />
          );
        })}

        {/* 코호트 컷오프 수직선 — bin 시작점 좌측 기준. 라벨은 상단에. */}
        {cutoffs.map((cut) => {
          const left = pct(cut.score);
          // 동일 위치 겹침 방지: 임계값이 너무 가까우면 라벨이 겹치지만 시각적 표시는 그대로
          return (
            <div
              key={cut.label}
              className="absolute inset-y-0 pointer-events-none"
              style={{ left: `${left}%` }}
            >
              <div className={`absolute inset-y-0 w-px ${cut.color}`} />
              <div
                className={`absolute -top-0.5 -translate-x-1/2 text-overline font-semibold ${cut.text} bg-vellum px-1 leading-none rounded-[3px]`}
              >
                {cut.label}
              </div>
            </div>
          );
        })}
      </div>
      <div id="score-distribution-sr-data" className="sr-only">
        <p>
          점수 분포 데이터 (구간별 인원과 비중). 전체 표시 인원{" "}
          {totalSeen.toLocaleString()}명.
        </p>
        <ul>
          {bins.map((b) => {
            const share = totalSeen > 0 ? (b.count / totalSeen) * 100 : 0;
            return (
              <li key={b.label}>
                {b.label}점 구간: {b.count.toLocaleString()}명 (
                {share.toFixed(2)}%)
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex justify-between text-caption text-stone mt-1.5 num-tabular">
        <span>{xMin}점</span>
        <span>{xMax}점</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-graphite mt-2.5">
        <Legend color="bg-terra" label={`핵심 (≥${coreMin.toFixed(1)}점)`} />
        <Legend color="bg-azure" label={`타겟 (≥${targetMin.toFixed(1)}점)`} />
        <Legend
          color="bg-graphite/40"
          label={`관심 (≥${interestMin.toFixed(1)}점)`}
        />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`inline-block w-2.5 h-2.5 rounded-sm ${color}`} />
      <span>{label}</span>
    </div>
  );
}

// ============================================================
// 인구통계 분포 카드 (컬럼 1개당)
// ============================================================

