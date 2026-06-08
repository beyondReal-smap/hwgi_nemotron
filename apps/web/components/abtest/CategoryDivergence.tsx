"use client";

/**
 * 카테고리 다이버징 바 — A vs B의 관심 카테고리 성향 차이를 중앙 0축 기준 좌우로.
 *
 * 버려지던 comparison.category_diff(카테고리별 a/b/delta)를 시각화.
 * - 중앙 0축 기준, A 우세는 왼쪽(marine) / B 우세는 오른쪽(terra)으로 발산.
 * - |delta| 내림차순 정렬, |delta| < 0.05는 stone 회색(미세 차이는 강조 안 함).
 * - 막대 끝에 우세 측·차이값 라벨(예 'B +0.03'). 색만으로 의미 전달하지 않음.
 * - category_diff가 비었거나 모든 delta가 0이면 null(렌더 스킵).
 */

const MARINE = "#4f80b3"; // A
const TERRA = "#d97757"; // B
const STONE = "#9c9a92"; // 미세 차이(중립)

// 강조 임계 — |delta| 이상이면 풀톤, 미만이면 회색.
const EMPHASIS_THRESHOLD = 0.05;
// 막대 최대 폭(반쪽) 기준이 되는 delta — 이 값에 막대가 절반 폭을 채운다.
const DELTA_FULL = 0.2;

// 한국어 카테고리 라벨 매핑 (Nemotron interest 카테고리).
const CATEGORY_LABEL: Record<string, string> = {
  family: "가족",
  sports: "스포츠",
  professional: "전문직",
  travel: "여행",
  culinary: "미식",
  arts: "예술",
};

type CategoryDiff = Record<string, { a: number; b: number; delta: number }>;

type Props = {
  categoryDiff: CategoryDiff;
  labelA: string;
  labelB: string;
};

export function CategoryDivergence({ categoryDiff, labelA, labelB }: Props) {
  const entries = Object.entries(categoryDiff ?? {});
  // 모든 delta가 0이면(또는 빈 객체) 의미 없는 차트 — 렌더 스킵.
  const hasSignal = entries.some(([, v]) => Math.abs(v.delta) > 0);
  if (entries.length === 0 || !hasSignal) return null;

  // |delta| 내림차순 정렬.
  const sorted = [...entries].sort(
    ([, x], [, y]) => Math.abs(y.delta) - Math.abs(x.delta),
  );

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">관심 카테고리 성향 차이</h2>
        <p className="text-body-sm text-dusty mt-1">
          A·B 타겟층의 카테고리별 관심 격차 — 중앙 기준 왼쪽 A, 오른쪽 B로 발산
        </p>
      </header>

      <div className="px-4 py-4 sm:px-5 sm:py-5">
        {/* 좌우 진영 범례 */}
        <div className="flex items-center justify-between text-overline text-dusty mb-3">
          <span className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-[3px] inline-block"
              style={{ background: MARINE, opacity: 0.7 }}
            />
            <span className="text-marine font-medium truncate max-w-[120px]" title={labelA}>
              {labelA}
            </span>
            우세 ◀
          </span>
          <span className="flex items-center gap-1.5">
            ▶ 우세{" "}
            <span className="text-terra font-medium truncate max-w-[120px]" title={labelB}>
              {labelB}
            </span>
            <span
              className="w-2.5 h-2.5 rounded-[3px] inline-block"
              style={{ background: TERRA, opacity: 0.7 }}
            />
          </span>
        </div>

        <ul className="space-y-2.5">
          {sorted.map(([key, v]) => (
            <DivergingRow key={key} cat={key} delta={v.delta} />
          ))}
        </ul>

        <p className="text-caption text-dusty mt-3 leading-relaxed">
          값은 A·B 타겟층의 카테고리 평균 관심도 차이(delta)입니다. |차이| ≥ 0.05만
          색으로 강조하고, 그 미만은 회색(미세 차이)으로 표시합니다.
        </p>
      </div>
    </section>
  );
}

function DivergingRow({ cat, delta }: { cat: string; delta: number }) {
  const label = CATEGORY_LABEL[cat] ?? cat;
  // delta > 0 → B 우세(오른쪽), delta < 0 → A 우세(왼쪽). (백엔드 정의: delta = b - a)
  const towardB = delta > 0;
  const mag = Math.abs(delta);
  const emphasized = mag >= EMPHASIS_THRESHOLD;
  const color = !emphasized ? STONE : towardB ? TERRA : MARINE;

  // 반쪽(50%) 안에서의 막대 폭 — DELTA_FULL에서 절반 폭을 가득 채움.
  const halfPct = Math.min(50, (mag / DELTA_FULL) * 50);
  const winner = mag === 0 ? "동률" : towardB ? "B" : "A";
  const valueLabel =
    mag === 0 ? "차이 없음" : `${winner} +${mag.toFixed(2)}`;

  return (
    <li className="grid grid-cols-[64px_1fr] items-center gap-2">
      <span className="text-body-sm text-ink font-medium text-right truncate" title={label}>
        {label}
      </span>
      <div
        className="relative h-5"
        role="img"
        aria-label={`${label}: ${mag === 0 ? "차이 없음" : `${winner === "A" ? "A" : "B"} 우세 ${mag.toFixed(2)}`}`}
      >
        {/* 트랙 배경 */}
        <div className="absolute inset-0 rounded-[4px] bg-snow border border-parchment" />
        {/* 중앙 0축 */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-parchment" />
        {/* 발산 막대 — A는 중앙에서 왼쪽, B는 중앙에서 오른쪽 */}
        <div
          className="absolute top-0.5 bottom-0.5 rounded-[3px] transition-[width]"
          style={
            towardB
              ? { left: "50%", width: `${halfPct}%`, background: color, opacity: emphasized ? 0.78 : 0.5 }
              : { right: "50%", width: `${halfPct}%`, background: color, opacity: emphasized ? 0.78 : 0.5 }
          }
        />
        {/* 차이값 라벨 — 우세 방향 끝쪽에 배치 */}
        <span
          className={`absolute top-1/2 -translate-y-1/2 text-overline num-tabular font-medium ${
            emphasized ? "text-ink" : "text-dusty"
          } ${towardB ? "right-1.5" : "left-1.5"}`}
        >
          {valueLabel}
        </span>
      </div>
    </li>
  );
}
