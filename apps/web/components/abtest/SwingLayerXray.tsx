import { DemographicCard } from "@/components/DistributionCharts";
import type { DemographicGroup, OverlapSegment, SwingPull } from "@/lib/api";

/**
 * 스윙층 X-레이 + 줄다리기 맵.
 *
 * Jaccard(겹침) 한 숫자를 '갈아탈 사람의 얼굴 + 끌림 강도'로 분해한다.
 * - 줄다리기 맵: 스윙층(양쪽 모두 반응) 내부에서 A/B 어느 쪽으로 더 기우는지를
 *   중앙 기준 발산 막대로. mean_delta(평균 기움)·a_lean_ratio(A선호 비율)로 강도 표현.
 * - 3층 카드: 스윙 / A전용 / B전용 각각의 규모 + 핵심 인구통계(연령/가구/시도)를
 *   DemographicCard 재사용으로 노출. 스윙=azure, A전용=marine, B전용=terra 톤.
 * 겹침은 임베딩 의미 유사도 기반 '반응 겹침'이지 실 구매 잠식이 아니다(면책 고정).
 */

type Props = {
  segments?: OverlapSegment[] | null;
  swingPull?: SwingPull | null;
  labelA: string;
  labelB: string;
};

// 3층 카드에 노출할 핵심 인구통계 축 — 연령/가구/시도 (DemographicGroup.column 키와 일치).
const KEY_AXES: readonly string[] = ["age", "family_type", "province"];
// 핵심 축 표본이 부족할 때를 대비한 최대 표시 카드 수.
const MAX_CARDS = 3;

// 세그먼트 톤 — 스윙=azure(양쪽 공유·중립), A전용=marine(A), B전용=terra(B).
const SEGMENT_TONE: Record<
  OverlapSegment["key"],
  { ring: string; chip: string; bg: string }
> = {
  swing: {
    ring: "border-azure/40",
    chip: "bg-azure/20 text-ink",
    bg: "bg-azure/[0.06]",
  },
  a_only: {
    ring: "border-marine/40",
    chip: "bg-marine/20 text-marine",
    bg: "bg-marine/[0.06]",
  },
  b_only: {
    ring: "border-terra/40",
    chip: "bg-terra/20 text-terra",
    bg: "bg-terra/[0.05]",
  },
};

export function SwingLayerXray({ segments, swingPull, labelA, labelB }: Props) {
  if (!segments || segments.length === 0) return null;

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">스윙층 X-레이</h2>
        <p className="text-body-sm text-dusty mt-1">
          두 안에 모두 반응한 층(스윙)과 각 안 전용층의 정체
        </p>
      </header>

      <div className="p-4 sm:p-5 space-y-5">
        {swingPull && (
          <SwingTugOfWar pull={swingPull} labelA={labelA} labelB={labelB} />
        )}

        {/* 3층 카드 — 스윙 / A전용 / B전용 */}
        <div className="space-y-4">
          {segments.map((seg) => (
            <SegmentCard
              key={seg.key}
              segment={seg}
              labelA={labelA}
              labelB={labelB}
            />
          ))}
        </div>

        {/* 정직성 면책 */}
        <p className="text-caption text-dusty leading-relaxed">
          겹침은 AI 추정 기반 &lsquo;반응 겹침&rsquo;이지 실제 구매
          잠식이 아닙니다. 스윙층은 두 안 모두에 반응할 가능성이 높은 층으로,
          한쪽 안만 노출되면 그 안으로 흡수될 수 있습니다.
        </p>
      </div>
    </section>
  );
}

// ============================================================
// 줄다리기 맵 — 스윙층 내부 A/B 끌림 강도(중앙 기준 발산 막대)
// ============================================================

function SwingTugOfWar({
  pull,
  labelA,
  labelB,
}: {
  pull: SwingPull;
  labelA: string;
  labelB: string;
}) {
  const { swing_size, a_mean, b_mean, a_lean_ratio, mean_delta } = pull;

  // A선호 비율(0~1)을 막대 비율로. 중앙(50%)이 완전 박빙.
  const aLeanPct = clamp01(a_lean_ratio) * 100;
  const bLeanPct = 100 - aLeanPct;
  const absDelta = Math.abs(mean_delta);
  // 표시 정밀도(0.1점)에서 0.0이면 박빙으로 본다 — "0.0점 기움인데 한쪽 우위" 모순 방지.
  const tie = absDelta < 0.05;
  const leansA = mean_delta > 0; // 평균 점수가 A로 기우는가
  const winner: "A" | "B" | "tie" = tie ? "tie" : leansA ? "A" : "B";
  const winnerLabel = leansA ? labelA : labelB;

  // 표본이 작으면 평균/비율 해석에 주의 — 분모(스윙 인원) 병기.
  const small = swing_size < 100;

  const aria = tie
    ? `스윙층 ${swing_size}명 중 A선호 ${aLeanPct.toFixed(0)}퍼센트, ` +
      `B선호 ${bLeanPct.toFixed(0)}퍼센트. 평균 점수는 두 안이 박빙.`
    : `스윙층 ${swing_size}명 중 A선호 ${aLeanPct.toFixed(0)}퍼센트, ` +
      `B선호 ${bLeanPct.toFixed(0)}퍼센트. ` +
      `평균 점수는 ${winner === "A" ? labelA : labelB}로 ${absDelta.toFixed(1)}점 기움.`;

  return (
    <div className="rounded-[9.6px] border border-parchment bg-snow/40 p-4">
      <div className="flex items-baseline justify-between gap-2 mb-2.5">
        <h3 className="text-heading text-ink">줄다리기 맵</h3>
        <span className="text-caption text-dusty">
          스윙{" "}
          <span className="num-tabular font-medium text-ink">
            {swing_size.toLocaleString()}명
          </span>{" "}
          내부 끌림
        </span>
      </div>

      {/* A선호 비율 라벨 (막대 위) */}
      <div className="flex items-baseline justify-between text-caption mb-1">
        <span className="text-marine font-medium num-tabular">
          A선호 {aLeanPct.toFixed(0)}%
        </span>
        <span className="text-terra font-medium num-tabular">
          {bLeanPct.toFixed(0)}% B선호
        </span>
      </div>

      {/* 중앙 기준 발산 막대 — 왼쪽 marine(A) / 오른쪽 terra(B), 가운데 박빙선 */}
      <div
        className="relative h-4 rounded-[5px] bg-vellum border border-parchment overflow-hidden flex"
        role="img"
        aria-label={aria}
      >
        <div
          className="h-full bg-marine/70 transition-[width] motion-reduce:transition-none"
          style={{ width: `${aLeanPct}%` }}
        />
        <div
          className="h-full bg-terra/70 transition-[width] motion-reduce:transition-none"
          style={{ width: `${bLeanPct}%` }}
        />
        {/* 박빙(50%) 기준선 */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink/30"
        />
      </div>

      {/* 수치 요약 — 평균 대결 + 기움 방향 */}
      <p className="text-body-sm text-graphite mt-2.5 leading-relaxed">
        스윙{" "}
        <span className="num-tabular font-semibold text-ink">
          {swing_size.toLocaleString()}명
        </span>
        : A{" "}
        <span className="num-tabular font-semibold text-marine">
          {a_mean.toFixed(1)}
        </span>{" "}
        vs B{" "}
        <span className="num-tabular font-semibold text-terra">
          {b_mean.toFixed(1)}
        </span>{" "}
        →{" "}
        {tie ? (
          <>
            <span className="font-semibold text-ink">박빙</span>
            <span className="text-dusty">
              {" "}
              (평균차 {absDelta.toFixed(1)}점)
            </span>
            , A선호{" "}
            <span className="num-tabular font-semibold text-ink">
              {aLeanPct.toFixed(0)}%
            </span>
          </>
        ) : (
          <>
            <span
              className={`font-semibold ${winner === "A" ? "text-marine" : "text-terra"}`}
            >
              {winner}
            </span>
            로{" "}
            <span className="num-tabular font-semibold text-ink">
              {absDelta.toFixed(1)}점
            </span>
            , A선호{" "}
            <span className="num-tabular font-semibold text-ink">
              {aLeanPct.toFixed(0)}%
            </span>
            <span className="text-dusty">
              {" "}
              ({winnerLabel} 우위)
            </span>
          </>
        )}
      </p>

      {small && (
        <p className="text-caption text-terra font-medium mt-1.5">
          스윙층이 100명 미만이라 평균·선호 비율은 표본이 작아 흔들릴 수
          있습니다.
        </p>
      )}
    </div>
  );
}

// ============================================================
// 3층 카드 — 한 세그먼트(스윙/A전용/B전용)의 규모 + 핵심 인구통계
// ============================================================

function SegmentCard({
  segment,
  labelA,
  labelB,
}: {
  segment: OverlapSegment;
  labelA: string;
  labelB: string;
}) {
  const tone = SEGMENT_TONE[segment.key];
  // 핵심 축(연령/가구/시도) 우선 노출 — 없으면 앞쪽 축으로 채워 최대 3개.
  const cards = pickKeyDemographics(segment.demographics);
  const desc = describeSegment(segment.key, labelA, labelB);

  return (
    <div className={`rounded-[9.6px] border ${tone.ring} ${tone.bg} p-4`}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 mb-1">
        <span
          className={`inline-flex items-center rounded-[5px] px-2 py-0.5 text-overline font-semibold ${tone.chip}`}
        >
          {segment.label}
        </span>
        <span className="num-tabular text-heading font-semibold text-ink">
          {segment.size.toLocaleString()}명
        </span>
      </div>
      <p className="text-caption text-dusty mb-3 leading-relaxed">{desc}</p>

      {cards.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cards.map((dem) => (
            // DemographicGroup은 DemographicColumn(column/label/bins)에 구조적으로
            // 호환되므로 그대로 전달(ExclusiveTab과 동일 패턴).
            <DemographicCard key={dem.column} dem={dem} />
          ))}
        </div>
      ) : (
        <p className="text-caption text-dusty">
          이 층의 인구통계 분포 데이터가 없습니다.
        </p>
      )}
    </div>
  );
}

// ============================================================
// 헬퍼
// ============================================================

/** 핵심 축(age/family_type/province) 우선 + 부족 시 앞쪽 축으로 채워 최대 3개. */
function pickKeyDemographics(
  demographics: DemographicGroup[],
): DemographicGroup[] {
  const byCol = new Map(demographics.map((g) => [g.column, g]));
  const picked: DemographicGroup[] = [];
  const seen = new Set<string>();

  for (const col of KEY_AXES) {
    const g = byCol.get(col);
    if (g && !seen.has(col)) {
      picked.push(g);
      seen.add(col);
    }
  }
  for (const g of demographics) {
    if (picked.length >= MAX_CARDS) break;
    if (!seen.has(g.column)) {
      picked.push(g);
      seen.add(g.column);
    }
  }
  return picked.slice(0, MAX_CARDS);
}

/** 세그먼트별 한 줄 설명 — 스윙/전용층의 의미를 정직하게 명시. */
function describeSegment(
  key: OverlapSegment["key"],
  labelA: string,
  labelB: string,
): string {
  switch (key) {
    case "swing":
      return "두 안 모두에 반응한 층 — 노출되는 안으로 흡수될 수 있는 갈아탈 후보층입니다.";
    case "a_only":
      return `오직 ${labelA}에만 반응한 고유층 — ${labelB}와 겹치지 않습니다.`;
    case "b_only":
      return `오직 ${labelB}에만 반응한 고유층 — ${labelA}와 겹치지 않습니다.`;
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
