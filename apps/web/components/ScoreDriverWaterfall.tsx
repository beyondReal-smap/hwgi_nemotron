import type { PopulationStats, ScoreDriver, ConfidenceStats } from "@/lib/api";

/**
 * 점수 DNA — 핵심 타겟 점수가 '왜 이 타겟인가'를 항 단위로 개방하는 유리상자.
 *
 * 분석 점수가 어느 요인(의미 적합도/인구통계/관심사/보험관심)에서 떴는지를
 * '모집단 평균 기여 → 핵심 타겟 기여'의 대비 막대로 분해해 보여준다.
 * delta(= core - pop)가 양이면 그 요인이 타겟을 모집단 위로 끌어올린 동력이다.
 *
 * 정직성:
 * - core_contribution 합은 soft-ceiling 적용 전 raw 기여라, 최종 점수와는 미세차가
 *   날 수 있다. 따라서 '최종 점수'가 아닌 '기여 분해'로만 라벨링한다(부제·각주).
 * - confidence가 있으면 핵심 타겟 평균의 신뢰구간(±)과 컷 민감도를 함께 노출해
 *   표본 크기 변화에 점수가 얼마나 민감한지 투명하게 드러낸다.
 * - 인덱스(원본 행번호)는 노출하지 않는다. 인원/평균/구간만.
 *
 * 인터랙션 없는 순수 표시 컴포넌트 → "use client" 불필요.
 */

// A안 강조 색(marine) — 양의 delta(타겟을 끌어올린 동력)에 사용.
const MARINE = "#4f80b3";
// 주의·부정(terra) — 음의 delta(타겟에서 오히려 약해진 요인)에 사용.
const TERRA = "#d97757";
// 모집단 평균 기여(중립 베이스라인) — 옅은 회색 톤.
const STONE = "#9c9a92";

type Props = {
  stats: PopulationStats;
};

export function ScoreDriverWaterfall({ stats }: Props) {
  const drivers = stats.score_drivers ?? [];
  if (drivers.length === 0) return null;

  // delta 내림차순 — 타겟을 가장 많이 끌어올린 요인이 맨 위로.
  const sorted = [...drivers].sort((a, b) => b.delta - a.delta);

  // 막대 폭 정규화 기준: 모든 기여값(모집단·핵심)의 최대 절대값.
  const maxMag = Math.max(
    1e-6,
    ...sorted.flatMap((d) => [
      Math.abs(d.core_contribution),
      Math.abs(d.pop_contribution),
    ]),
  );

  const top = sorted[0];
  const confidence = stats.confidence ?? null;

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">점수 DNA — 왜 이 타겟인가</h2>
        <p className="text-body-sm text-dusty mt-1">
          핵심 타겟 점수가 어느 요인에서 떴는지 분해 (가산 구조, 정확)
        </p>
      </header>

      <div className="px-4 py-4 sm:px-5 sm:py-5">
        {/* delta 1위 요인 내러티브 — 한 줄로 핵심을 못 박는다.
            delta가 양이면 그 요인이 타겟을 끌어올린 동력, 음이면 모든 요인이
            모집단 아래라 '떴다'고 못 박으면 모순 → 표현을 분기한다. */}
        {top && (
          <p className="text-body-sm text-graphite leading-relaxed">
            {top.delta >= 0 ? (
              <>
                이 타겟은 주로{" "}
                <span className="font-semibold text-ink">‘{top.label}’</span>
                에서 떴습니다
              </>
            ) : (
              <>
                이 타겟은 모든 요인이 모집단 평균을 밑돌며, 그중{" "}
                <span className="font-semibold text-ink">‘{top.label}’</span>
                이 가장 덜 약했습니다
              </>
            )}
            <span
              className={`num-tabular font-semibold ${
                top.delta >= 0 ? "text-marine" : "text-terra"
              }`}
            >
              {" "}
              ({signed(top.delta)})
            </span>
            .
          </p>
        )}

        {/* 범례 — 베이스라인(모집단) vs 핵심 타겟 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-overline text-dusty">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-[3px]"
              style={{ background: STONE, opacity: 0.55 }}
            />
            모집단 평균 기여
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-[3px]"
              style={{ background: MARINE, opacity: 0.85 }}
            />
            핵심 타겟 기여
          </span>
        </div>

        <ul className="mt-3 space-y-3">
          {sorted.map((d) => (
            <DriverRow key={d.key} driver={d} maxMag={maxMag} />
          ))}
        </ul>

        <p className="text-caption text-dusty mt-4 leading-relaxed">
          값은 각 요인이 평균 점수에 기여한 절대량(소수 1자리)입니다. 핵심 타겟
          기여 합은 상한 보정(soft-ceiling) 이전의 raw 분해라, 최종 표시 점수와
          미세한 차이가 있을 수 있습니다.
        </p>

        {confidence && <ConfidencePanel c={confidence} />}
      </div>
    </section>
  );
}

function DriverRow({
  driver,
  maxMag,
}: {
  driver: ScoreDriver;
  maxMag: number;
}) {
  const { label, core_contribution, pop_contribution, delta } = driver;
  // 양의 delta = 타겟을 끌어올림(marine), 음 = 오히려 약해짐(terra).
  const up = delta >= 0;
  const deltaColor = up ? "text-marine" : "text-terra";

  const popPct = clampPct((Math.abs(pop_contribution) / maxMag) * 100);
  const corePct = clampPct((Math.abs(core_contribution) / maxMag) * 100);

  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-body-sm font-medium text-ink" title={label}>
          {label}
        </span>
        <span
          className={`shrink-0 rounded-[5px] border px-1.5 py-0.5 text-overline num-tabular font-semibold ${
            up
              ? "border-marine/30 bg-marine/[0.08] text-marine"
              : "border-terra/30 bg-terra/[0.08] text-terra"
          }`}
        >
          {signed(delta)}
        </span>
      </div>

      {/* 대비 막대: 위=모집단 평균 기여(베이스라인), 아래=핵심 타겟 기여 */}
      <div
        className="mt-1.5 space-y-1"
        role="img"
        aria-label={`${label}: 모집단 평균 기여 ${pop_contribution.toFixed(1)}, 핵심 타겟 기여 ${core_contribution.toFixed(1)}, 차이 ${signed(delta)}`}
      >
        <ContribBar
          pct={popPct}
          value={pop_contribution}
          color={STONE}
          opacity={0.5}
          caption="모집단"
        />
        <ContribBar
          pct={corePct}
          value={core_contribution}
          color={up ? MARINE : TERRA}
          opacity={0.85}
          caption="핵심"
          valueClassName={deltaColor}
        />
      </div>
    </li>
  );
}

function ContribBar({
  pct,
  value,
  color,
  opacity,
  caption,
  valueClassName,
}: {
  pct: number;
  value: number;
  color: string;
  opacity: number;
  caption: string;
  valueClassName?: string;
}) {
  return (
    <div className="grid grid-cols-[40px_1fr_44px] items-center gap-2">
      <span className="text-caption text-dusty">{caption}</span>
      <div className="relative h-3.5 rounded-[4px] bg-snow border border-parchment overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-[3px] transition-[width] motion-reduce:transition-none"
          style={{ width: `${pct}%`, background: color, opacity }}
        />
      </div>
      <span
        className={`text-right text-caption num-tabular font-medium ${
          valueClassName ?? "text-graphite"
        }`}
      >
        {value.toFixed(1)}
      </span>
    </div>
  );
}

function ConfidencePanel({ c }: { c: ConfidenceStats }) {
  // ± 폭: CI 절반. (high - low) / 2.
  const halfWidth = Math.max(0, (c.core_ci_high - c.core_ci_low) / 2);
  // 컷 민감도: 컷 -1점 시 늘어나는 인원 / +1점 시 줄어드는 인원.
  const relaxedGain = Math.max(0, c.core_size_relaxed - c.core_size);
  const tightenedLoss = Math.max(0, c.core_size - c.core_size_tightened);
  // 표본이 작으면 구간 추정·민감도 해석에 주의가 필요하다.
  const smallSample = c.core_size < 30;

  return (
    <div className="mt-4 rounded-[7px] border border-parchment bg-snow/40 px-3 py-3">
      <p className="text-overline text-dusty">신뢰도</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <p className="text-body-sm text-graphite">
          핵심 타겟 평균{" "}
          <span className="num-tabular font-semibold text-ink">
            {c.core_mean.toFixed(1)}
          </span>
          <span className="text-dusty num-tabular"> ± {halfWidth.toFixed(1)}</span>
          <span className="text-caption text-dusty"> (95% CI)</span>
        </p>
        <p className="text-body-sm text-graphite num-tabular">
          핵심 인원{" "}
          <span className="font-semibold text-ink">
            {c.core_size.toLocaleString()}명
          </span>
        </p>
      </div>

      <p className="mt-2 text-caption text-graphite leading-relaxed num-tabular">
        컷 민감도: {c.core_cut}점 → {c.core_cut - 1}점이면{" "}
        <span className="font-medium text-marine">+{relaxedGain.toLocaleString()}명</span>,{" "}
        {c.core_cut} → {c.core_cut + 1}점이면{" "}
        <span className="font-medium text-terra">-{tightenedLoss.toLocaleString()}명</span>
      </p>

      {smallSample && (
        <p className="mt-1.5 text-caption text-dusty leading-relaxed">
          핵심 표본이 30명 미만이라 구간·민감도 해석에 주의가 필요합니다.
        </p>
      )}
    </div>
  );
}

// 폭 퍼센트를 0~100으로 안전 클램프 (NaN 방지 포함).
function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

// +N.N / -N.N 부호 표기 (소수 1자리).
function signed(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${Math.abs(v).toFixed(1)}`;
}
