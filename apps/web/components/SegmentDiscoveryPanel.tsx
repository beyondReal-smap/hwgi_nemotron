import type { SegmentFinding } from "@/lib/api";

/**
 * 숨은 황금 세그먼트 — 단변량 분포가 못 잡는 교차 조합을 lift(전국 대비 집중 배수) 순으로 노출.
 *
 * 목적: FP 영업 기획용 마이크로 타겟 발굴. 예) "40대 × 자영업 × 자녀 2명"처럼
 * 한 축만 보면 평범하지만 교차하면 타겟 내 비중이 전국 대비 몇 배로 튀는 조합을 찾아준다.
 * - 백엔드 segments(LLM 0콜 집계)를 그대로 표시만 한다. 추가 계산 없음(순수 표시 컴포넌트).
 * - lift 막대는 1.0 기준선 위(>1)만 채움 — "전국보다 얼마나 더 몰렸나"를 직관화.
 * - 정직성: 분모(전국 인원)가 작은 조합은 lift가 과장될 수 있어 하단에 명시.
 */

// lift 막대가 가득 차는 기준 배수 — 5배에서 트랙을 100% 채운다.
const LIFT_FULL = 5;
// 강조 임계 — lift 이상이면 풀톤(marine/azure), 미만이면 옅게.
const LIFT_EMPHASIS = 2;
// 최대 노출 개수.
const MAX_ROWS = 8;

export function SegmentDiscoveryPanel({
  segments,
}: {
  segments?: SegmentFinding[];
}) {
  // graceful: 데이터 없거나 빈 배열이면 렌더 안 함.
  if (!segments || segments.length === 0) return null;

  // lift 내림차순으로 상위 MAX_ROWS개만.
  const rows = [...segments]
    .sort((a, b) => b.lift_ratio - a.lift_ratio)
    .slice(0, MAX_ROWS);

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">숨은 황금 세그먼트</h2>
        <p className="text-body-sm text-dusty mt-1">
          여러 특성이 겹친 고객 조합 — 전국 평균보다 몇 배 더 관심 있는 순
        </p>
      </header>

      <div className="px-4 py-4 sm:px-5 sm:py-5">
        <ul className="space-y-3">
          {rows.map((seg, i) => (
            <SegmentRow key={`${seg.label}-${i}`} seg={seg} />
          ))}
        </ul>

        <p className="text-caption text-dusty mt-4 leading-relaxed">
          매우 적은 고객이 여러 조건을 모두 만족하면 결과가 부정확할 수 있습니다.
        </p>
      </div>
    </section>
  );
}

function SegmentRow({ seg }: { seg: SegmentFinding }) {
  const lift = seg.lift_ratio;
  const emphasized = lift >= LIFT_EMPHASIS;

  // 1.0 기준선 위(>1)만 채움. lift ≤ 1이면 막대 없음(전국 대비 과집중 아님).
  const overByPct = Math.max(0, Math.min(100, ((lift - 1) / (LIFT_FULL - 1)) * 100));
  const liftLabel = `${lift.toFixed(1)}x`;

  return (
    <li className="border border-parchment rounded-[7px] bg-snow/40 px-3 py-3 sm:px-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-body-sm text-ink font-semibold leading-snug">
          {seg.label}
        </p>
        <span
          className={`shrink-0 inline-flex items-center rounded-[5px] px-2 py-0.5 text-body-sm font-semibold num-tabular ${
            emphasized
              ? "bg-marine/20 text-marine"
              : "bg-azure/20 text-graphite"
          }`}
        >
          {liftLabel}
        </span>
      </div>

      {/* lift 막대 — 1.0 기준선 위로 채움 */}
      <div
        className="relative h-2.5 mt-2.5 rounded-[4px] bg-snow border border-parchment overflow-hidden"
        role="img"
        aria-label={`${seg.label}: 전국 평균 대비 관심도 ${liftLabel}`}
      >
        <div
          className={`absolute inset-y-0 left-0 rounded-[3px] transition-[width] motion-reduce:transition-none ${
            emphasized ? "bg-marine" : "bg-azure"
          }`}
          style={{ width: `${overByPct}%`, opacity: emphasized ? 0.8 : 0.55 }}
        />
      </div>

      <p className="text-caption text-dusty mt-2 num-tabular">
        타겟 {seg.target_count.toLocaleString()}명 · 평균{" "}
        {seg.avg_score.toFixed(0)}점 · 전국 {seg.population_count.toLocaleString()}명 중
      </p>
    </li>
  );
}
