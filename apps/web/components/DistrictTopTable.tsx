import type { RegionStat } from "@/lib/api";

type Props = {
  districts: RegionStat[];
  topN?: number;
};

export function DistrictTopTable({ districts, topN = 10 }: Props) {
  const rows = districts.slice(0, topN);
  if (rows.length === 0) return null;

  const totalCount = districts.reduce((s, d) => s + d.count, 0);
  const maxCount = rows[0]?.count ?? 0;

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-azure px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-title text-ink">Top {rows.length} 공략 시군구</h2>
          <p className="text-body-sm text-dusty num-tabular">
            타겟층 {totalCount.toLocaleString()}명 기준
          </p>
        </div>
        <p className="text-body-sm text-dusty mt-1">
          반응 페르소나가 가장 많이 분포한 행정구역. 영업·마케팅 집중 후보.
        </p>
      </header>

      <ol className="divide-y divide-parchment">
        {rows.map((d, idx) => {
          const widthPct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
          const sharePct = totalCount > 0 ? (d.count / totalCount) * 100 : 0;
          return (
            <li
              key={d.name}
              className="px-4 py-3 sm:px-5 grid grid-cols-[1.75rem_minmax(0,1fr)_auto] sm:grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 sm:gap-3"
            >
              <span className="text-body-sm font-mono text-stone num-tabular">
                #{idx + 1}
              </span>
              <div className="min-w-0">
                <p className="text-body font-semibold text-ink truncate">
                  {d.name}
                </p>
                <div className="mt-1.5 h-1.5 bg-snow rounded-[2px] relative overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-terra/70 rounded-[2px]"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
              <div className="text-right num-tabular shrink-0">
                <p className="text-body font-semibold text-ink">
                  {d.count.toLocaleString()}
                  <span className="text-caption text-dusty font-normal ml-1">
                    명
                  </span>
                </p>
                <p className="text-caption text-stone">
                  {sharePct.toFixed(1)}% · 평균 {d.avg_score.toFixed(1)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
