import type { SplitRule } from "@/lib/api";

type Props = {
  rules?: SplitRule[] | null;
  labelA: string;
  labelB: string;
};

// 표본이 이만큼 미만이면 분기 처방을 '참고용'으로 다뤄야 한다는 임계치.
const SMALL_SAMPLE = 5;

/**
 * 분기 운영 처방전 — split 추천 시 'A로 팔 사람 / B로 팔 사람'을 액션 테이블로.
 *
 * 전용층(swing이 아닌, 각 안에만 끌린 층)의 인구통계 분포에서 도출한 SplitRule을
 * 축(dimension)별 3열 표로 보여, "어떤 사람에게 어느 안을 권할지"를 즉시 행동으로
 * 옮길 수 있게 한다. A=marine, B=terra 고정.
 *
 * graceful: rules가 비었/undefined/null이면 null을 반환해 렌더하지 않는다.
 * 정직성: a_count/b_count는 '명' 분모를 병기하고, 전용층 표본이 작으면(SMALL_SAMPLE 미만)
 * 참고용 주의 문구를 노출한다. 원본 행 인덱스는 노출하지 않는다.
 */
export function SplitPlaybook({ rules, labelA, labelB }: Props) {
  if (!rules || rules.length === 0) return null;

  // 한 줄 요약용 세그먼트 묶음 — 중복 제거 후 최대 3개까지만 노출(나열 과다 방지).
  const aSegments = summarizeSegments(rules.map((r) => r.a_segment));
  const bSegments = summarizeSegments(rules.map((r) => r.b_segment));

  // 전용층 표본이 작은 축이 하나라도 있으면 주의 문구를 띄운다.
  const hasSmallSample = rules.some(
    (r) => r.a_count < SMALL_SAMPLE || r.b_count < SMALL_SAMPLE,
  );

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">분기 운영 처방전</h2>
        <p className="text-body-sm text-dusty mt-1">
          어떤 사람에게 어느 안을 — 전용층 분포에서 도출
        </p>
      </header>

      {/* 한 줄 요약 */}
      <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-parchment bg-snow/40">
        <p className="text-body-sm text-graphite leading-relaxed">
          <span className="text-marine font-semibold">{labelA}</span>는{" "}
          <span className="text-ink font-medium">{aSegments}</span>에,{" "}
          <span className="text-terra font-semibold">{labelB}</span>는{" "}
          <span className="text-ink font-medium">{bSegments}</span>에 강합니다.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <caption className="sr-only">
            인구통계 축별로 {labelA}에 강한 전용층과 {labelB}에 강한 전용층을 비교한
            분기 운영 처방표
          </caption>
          <thead>
            <tr className="bg-snow/60 text-overline">
              <th scope="col" className="text-left px-4 py-2.5 font-medium text-graphite">
                축
              </th>
              <th scope="col" className="text-left px-4 py-2.5 font-medium text-marine">
                {labelA}로
              </th>
              <th scope="col" className="text-left px-4 py-2.5 font-medium text-terra">
                {labelB}로
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, idx) => (
              <tr
                key={rule.dimension}
                className={`${idx % 2 === 0 ? "bg-vellum" : "bg-snow/30"} border-t border-parchment`}
              >
                <th
                  scope="row"
                  className="text-left px-4 py-2.5 text-ink font-medium align-top"
                >
                  {rule.dimension}
                </th>
                <td className="px-4 py-2.5 align-top">
                  <span className="text-ink">{rule.a_segment}</span>
                  <span className="text-dusty num-tabular ml-1.5">
                    {rule.a_count.toLocaleString()}명
                  </span>
                </td>
                <td className="px-4 py-2.5 align-top">
                  <span className="text-ink">{rule.b_segment}</span>
                  <span className="text-dusty num-tabular ml-1.5">
                    {rule.b_count.toLocaleString()}명
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasSmallSample && (
        <div className="px-4 pb-4 pt-3 sm:px-5">
          <p className="text-caption text-dusty leading-relaxed">
            일부 축은 전용층 표본이 작아(5명 미만) 대표 세그먼트가 흔들릴 수 있습니다.
            방향성 참고용으로만 활용하세요.
          </p>
        </div>
      )}
    </section>
  );
}

/** 세그먼트 목록을 중복 제거 후 최대 3개까지 ', '로 잇고, 더 있으면 '외 N개'로 축약. */
function summarizeSegments(segments: string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const seg of segments) {
    const s = seg.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    unique.push(s);
  }
  if (unique.length === 0) return "특정 층";
  const head = unique.slice(0, 3).join(", ");
  const rest = unique.length - 3;
  return rest > 0 ? `${head} 외 ${rest}개` : head;
}
