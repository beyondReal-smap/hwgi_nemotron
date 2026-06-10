"use client";

import type { ABOverlap } from "@/lib/api";

/**
 * A/B 반응 겹침 — 면적 비례 벤 다이어그램 + 방향성 막대.
 *
 * 2안 전용 직관 시각화. 행렬(CannibalMatrix)보다 "겹치는 정도"를 한눈에 전달.
 * - 벤: 두 코호트를 겹친 원 두 개로. 원의 면적이 반응층 인원에 비례(r ∝ √size),
 *   중심 간 거리는 Jaccard가 클수록 좁혀 시각적으로 더 겹치게.
 *   겹침 영역은 A·B 혼합 톤(azure)으로 칠해 교집합을 명시.
 * - 막대: A→B / B→A 방향성(비대칭)을 가로 막대로. 작은 코호트가 큰 쪽에 더 흡수됨.
 * 겹침은 임베딩 의미 유사도 신호이지 실 구매 잠식이 아니다(면책 1곳 고정).
 */

type Props = { overlap: ABOverlap; labelA: string; labelB: string };

const MARINE = "#4f80b3"; // A
const TERRA = "#d97757"; // B
const AZURE = "#ccdbe8"; // 겹침(A·B 혼합 톤)

// SVG 기하 상수 — viewBox 320×170 안에 두 원이 항상 들어오도록 클램프.
const VB_W = 320;
const VB_H = 170;
const CY = 85;
const R_MIN = 34; // 작은 쪽 최소 반지름 (라벨 가독성 확보)
const R_MAX = 66; // 큰 쪽 최대 반지름 (viewBox 이탈 방지)

export function OverlapVenn({ overlap, labelA, labelB }: Props) {
  const { a_to_b, b_to_a, jaccard, a_size, b_size, relation } = overlap;
  const pctJ = Math.round(clamp01(jaccard) * 100);

  // 1) 반지름: 면적이 인원에 비례하도록 r ∝ √size. 큰 쪽을 R_MAX에 고정하고
  //    작은 쪽을 비율로 환산하되 R_MIN으로 클램프(0명·극단 비대칭 방어).
  const safeA = Math.max(0, a_size);
  const safeB = Math.max(0, b_size);
  const maxSize = Math.max(safeA, safeB, 1);
  const rA = radiusFor(safeA, maxSize);
  const rB = radiusFor(safeB, maxSize);

  // 2) 중심 거리: 겹침 면적이 Jaccard에 단조 대응하도록 중심 거리를 직접 매핑한다.
  //    d = (rA+rB) − jac·((rA+rB) − |rA−rB|)
  //      · jac=0  → d = rA+rB     (두 원이 외접 — 겹침 0)
  //      · jac=1  → d = |rA−rB|   (작은 원이 큰 원에 포함 — 완전 겹침)
  //    → Jaccard가 양수면 반드시 시각적 겹침(lens)이 생겨 '6%인데 안 겹침' 모순이 사라진다.
  //    최대 거리(rA+rB ≤ 2·R_MAX = 132)라 viewBox(320) 안에 항상 들어온다.
  const jac = clamp01(jaccard);
  const rSum = rA + rB;
  const rDiff = Math.abs(rA - rB);
  const sep = rSum - jac * (rSum - rDiff);
  const cx = VB_W / 2;
  const cxA = cx - sep / 2;
  const cxB = cx + sep / 2;

  // 3) 방향성 비대칭: 작은 코호트→큰 코호트 방향(흡수율 높은 쪽)을 강조.
  //    a_to_b = A 중 B에도 반응한 비율. 값이 클수록 그 방향 흡수가 강함.
  const aAbsorbedMore = a_to_b >= b_to_a; // A가 더 많이 흡수되는가

  const relText =
    relation === "complementary"
      ? "서로 다른 고객층 — 함께 출시하면 시장이 확장됩니다 (보완)"
      : relation === "cannibal"
        ? "같은 고객층을 노립니다 — 동시 운영 시 잠식, 하나로 통합이 효율적 (잠식 위험)"
        : "부분적으로 겹치는 고객층 (중간)";

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-5 py-4">
        <h2 className="text-title text-ink">반응 겹침 한눈에 보기</h2>
        <p className="text-body-sm text-dusty mt-1.5">{relText}</p>
      </header>

      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
        {/* 면적 비례 벤 다이어그램 */}
        <div className="flex flex-col items-center">
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="w-full max-w-[300px]"
            role="img"
            aria-label={`${labelA}(${safeA.toLocaleString()}명)와 ${labelB}(${safeB.toLocaleString()}명)의 반응층 겹침, 면적 비례. 반응층 겹침 ${pctJ}퍼센트`}
          >
            <defs>
              {/* 겹침 영역만 azure로 칠하기 위한 클립 — B 원으로 A 원을 잘라낸다 */}
              <clipPath id="venn-overlap-clip">
                <circle cx={cxB} cy={CY} r={rB} />
              </clipPath>
            </defs>

            {/* A 원 (marine) */}
            <circle
              cx={cxA}
              cy={CY}
              r={rA}
              fill={MARINE}
              fillOpacity={0.34}
              stroke={MARINE}
              strokeWidth={1.5}
            />
            {/* B 원 (terra) */}
            <circle
              cx={cxB}
              cy={CY}
              r={rB}
              fill={TERRA}
              fillOpacity={0.34}
              stroke={TERRA}
              strokeWidth={1.5}
            />
            {/* 교집합 — A 원을 B 원으로 클립해 겹침 영역만 azure 혼합 톤으로 강조 */}
            {jac > 0 && (
              <circle
                cx={cxA}
                cy={CY}
                r={rA}
                fill={AZURE}
                fillOpacity={0.62}
                clipPath="url(#venn-overlap-clip)"
              />
            )}

            {/* 원 안 라벨(A/B) — 색만이 아니라 문자로도 구분 */}
            <text
              x={cxA}
              y={CY + 4}
              textAnchor="middle"
              fontSize="13"
              fontWeight="700"
              fill={MARINE}
            >
              A
            </text>
            <text
              x={cxB}
              y={CY + 4}
              textAnchor="middle"
              fontSize="13"
              fontWeight="700"
              fill={TERRA}
            >
              B
            </text>
          </svg>
          <p className="text-caption text-graphite mt-1">
            겹침 <span className="font-semibold text-ink num-tabular">{pctJ}%</span>{" "}
            <span className="text-dusty">(추정)</span>
          </p>
          {/* 범례 — 원 크기가 인원에 비례함을 명시 */}
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2 text-caption">
            <span className="flex items-center gap-1.5">
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ background: MARINE, opacity: 0.55 }}
              />
              {labelA}{" "}
              <span className="text-dusty num-tabular">
                {safeA.toLocaleString()}명
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ background: TERRA, opacity: 0.55 }}
              />
              {labelB}{" "}
              <span className="text-dusty num-tabular">
                {safeB.toLocaleString()}명
              </span>
            </span>
          </div>
          <p className="text-overline text-dusty mt-1.5">
            원 크기 = 반응 인원 (면적 비례)
          </p>
        </div>

        {/* 방향성 막대 — 비대칭 흡수율 */}
        <div className="space-y-3">
          <Bar
            label={`${labelA} 반응자 중 → ${labelB}에도 반응`}
            value={a_to_b}
            color={MARINE}
            emphasize={aAbsorbedMore}
          />
          <Bar
            label={`${labelB} 반응자 중 → ${labelA}에도 반응`}
            value={b_to_a}
            color={TERRA}
            emphasize={!aAbsorbedMore}
          />
          <p className="text-caption text-dusty pt-1 leading-relaxed">
            방향성은 비대칭입니다 — 작은 코호트가 큰 쪽에 더 많이 흡수되어, A→B와 B→A
            수치가 다를 수 있습니다 (
            {aAbsorbedMore ? labelA : labelB}가 더 많이 흡수되는 방향).
          </p>
        </div>
      </div>

      {/* 면책 — 한 곳으로 통합 */}
      <div className="px-5 pb-4">
        <p className="text-caption text-dusty">
          겹침 인원·비율은 AI 추정 기반이므로 참고용이며, 실제 구매 잠식이 아닙니다.
          (타겟층 기준)
        </p>
      </div>
    </section>
  );
}

/** 면적 비례 반지름 — 큰 쪽을 R_MAX에 고정, 나머지는 √(size/max) 비율 후 R_MIN 클램프. */
function radiusFor(size: number, maxSize: number): number {
  if (size <= 0) return R_MIN;
  const r = R_MAX * Math.sqrt(size / maxSize);
  return Math.max(R_MIN, Math.min(R_MAX, r));
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function Bar({
  label,
  value,
  color,
  emphasize,
}: {
  label: string;
  value: number;
  color: string;
  /** 흡수율이 더 높은(비대칭 강한) 방향 — 진하게, 약한 쪽은 흐리게 */
  emphasize: boolean;
}) {
  const pct = Math.round(clamp01(value) * 100);
  return (
    <div>
      <div className="flex justify-between items-baseline text-caption text-graphite mb-1 gap-2">
        <span>{label}</span>
        <span className="num-tabular font-semibold text-ink shrink-0">{pct}%</span>
      </div>
      <div
        className="h-3 rounded-full bg-snow border border-parchment overflow-hidden"
        role="img"
        aria-label={`${label} ${pct}퍼센트`}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${Math.max(2, pct)}%`,
            background: color,
            opacity: emphasize ? 0.85 : 0.45,
          }}
        />
      </div>
    </div>
  );
}
