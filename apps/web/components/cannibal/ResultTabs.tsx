"use client";

export type ResultTab = "matrix" | "coverage" | "multiplicity" | "exclusive";

const TABS: { value: ResultTab; label: string; sub: string }[] = [
  { value: "matrix", label: "겹침 행렬", sub: "얼마나 겹치나" },
  { value: "coverage", label: "커버리지", sub: "몇 개로 충분한가" },
  { value: "multiplicity", label: "노출 분포", sub: "몇 겹 노출인가" },
  { value: "exclusive", label: "전용층", sub: "고유 반응층" },
];

/** 겹침 분석 결과 보기 탭 — abtest ModeTabs 패턴(슬라이딩 pill). */
export function ResultTabs({
  value,
  onChange,
}: {
  value: ResultTab;
  onChange: (t: ResultTab) => void;
}) {
  const activeIdx = TABS.findIndex((t) => t.value === value);
  return (
    <div
      role="tablist"
      aria-label="겹침 분석 결과 보기"
      className="relative inline-grid grid-cols-4 w-full bg-vellum border border-parchment rounded-[9.6px] p-0.5"
    >
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 left-0.5 rounded-[7px] bg-snow border border-parchment transition-transform duration-200"
        style={{
          width: `calc((100% - 0.25rem) / ${TABS.length})`,
          transform: `translateX(${activeIdx * 100}%)`,
        }}
      />
      {TABS.map((t) => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={`relative z-10 px-1.5 sm:px-4 py-1.5 sm:py-2 rounded-[7px] text-body-sm font-medium transition-colors
                        ${active ? "text-ink" : "text-graphite hover:text-ink"}`}
          >
            <span className="block font-semibold">{t.label}</span>
            <span
              className={`block text-overline mt-0.5 ${active ? "text-graphite" : "text-dusty"}`}
            >
              {t.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}
