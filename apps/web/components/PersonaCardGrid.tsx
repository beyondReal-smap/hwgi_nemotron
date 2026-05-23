"use client";

import type { PersonaCard } from "@/lib/api";

/**
 * 페르소나 카드/테이블 뷰 토글 + 다중 선택.
 *
 * 디자인 원칙:
 * - 카드 뷰: SectionCard 패턴 일부 차용 (border + bg-snow). 좌상단 체크박스 + 우상단 similarity.
 * - 테이블 뷰: 정보 밀도 우선. 동일 체크박스 + 우측 액션 (상세 보기).
 * - 선택된 카드/행: 좌측 4px terra accent.
 */
export function PersonaCardGrid({
  view,
  personas,
  selected,
  onToggle,
  onOpenDetail,
  hasQuery,
}: {
  view: "card" | "table";
  personas: PersonaCard[];
  selected: Set<string>;
  onToggle: (uuid: string) => void;
  onOpenDetail: (uuid: string) => void;
  hasQuery: boolean;
}) {
  if (personas.length === 0) {
    return (
      <div className="bg-snow border border-parchment rounded-[9.6px] p-10 text-center">
        <p className="text-body text-graphite">조건에 맞는 페르소나가 없습니다</p>
        <p className="text-caption text-dusty mt-1">필터를 완화하거나 자연어 조건을 바꿔보세요</p>
      </div>
    );
  }

  if (view === "card") {
    return (
      <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {personas.map((p) => (
          <PersonaCardItem
            key={p.uuid}
            p={p}
            isSelected={selected.has(p.uuid)}
            onToggle={onToggle}
            onOpenDetail={onOpenDetail}
            showSimilarity={hasQuery}
          />
        ))}
      </ul>
    );
  }

  // 테이블 뷰
  return (
    <div className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead className="bg-vellum">
            <tr className="text-left text-overline text-dusty">
              <th className="px-3 py-2 w-10"></th>
              <th className="px-3 py-2">인적사항</th>
              <th className="px-3 py-2">지역</th>
              <th className="px-3 py-2">직업</th>
              <th className="px-3 py-2">가구</th>
              {hasQuery && <th className="px-3 py-2 text-right">유사도</th>}
              <th className="px-3 py-2 text-right">상세</th>
            </tr>
          </thead>
          <tbody>
            {personas.map((p) => {
              const isSel = selected.has(p.uuid);
              return (
                <tr
                  key={p.uuid}
                  className={`border-t border-parchment transition-colors ${
                    isSel ? "bg-snow" : "hover:bg-snow/60"
                  }`}
                >
                  <td
                    className={`px-3 py-2 ${
                      isSel ? "border-l-4 border-l-terra" : "border-l-4 border-l-transparent"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => onToggle(p.uuid)}
                      className="accent-terra"
                      aria-label={`${p.sex} ${p.age}세 선택`}
                    />
                  </td>
                  <td className="px-3 py-2 text-ink whitespace-nowrap">
                    {p.sex} · {p.age}세
                  </td>
                  <td className="px-3 py-2 text-graphite whitespace-nowrap">
                    {p.province} · {p.district}
                  </td>
                  <td className="px-3 py-2 text-graphite max-w-[14rem] truncate">
                    {p.occupation || "—"}
                  </td>
                  <td className="px-3 py-2 text-graphite max-w-[16rem] truncate">
                    {p.family_type || "—"}
                  </td>
                  {hasQuery && (
                    <td className="px-3 py-2 text-right font-mono text-terra tabular-nums">
                      {p.similarity !== null ? `${(p.similarity * 100).toFixed(1)}%` : "—"}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(p.uuid)}
                      className="text-caption text-graphite hover:text-terra hover:underline"
                    >
                      보기
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// 단일 카드
// ============================================================

function PersonaCardItem({
  p,
  isSelected,
  onToggle,
  onOpenDetail,
  showSimilarity,
}: {
  p: PersonaCard;
  isSelected: boolean;
  onToggle: (uuid: string) => void;
  onOpenDetail: (uuid: string) => void;
  showSimilarity: boolean;
}) {
  return (
    <li
      className={`bg-snow border border-parchment rounded-[9.6px] overflow-hidden flex flex-col transition-shadow hover:shadow-sm ${
        isSelected ? "border-l-4 border-l-terra" : ""
      }`}
    >
      {/* 헤더 — 체크 + 메타 + 유사도 */}
      <header className="px-4 py-3 border-b border-parchment flex items-start justify-between gap-2">
        <label className="flex items-start gap-2.5 cursor-pointer min-w-0 flex-1">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggle(p.uuid)}
            className="accent-terra mt-1 shrink-0"
            aria-label={`${p.sex} ${p.age}세 선택`}
          />
          <div className="min-w-0">
            <p className="text-body text-ink font-medium">
              {p.sex} · {p.age}세
            </p>
            <p className="text-caption text-dusty truncate">
              {p.province} · {p.district}
            </p>
          </div>
        </label>
        {showSimilarity && p.similarity !== null && (
          <span className="text-caption font-mono text-terra tabular-nums shrink-0">
            {(p.similarity * 100).toFixed(1)}%
          </span>
        )}
      </header>

      {/* 본문 — 직업/가구 + persona 발췌 */}
      <div className="px-4 py-3 flex-1 flex flex-col gap-2">
        <dl className="text-caption text-graphite space-y-0.5">
          <div className="flex gap-2">
            <dt className="text-dusty shrink-0 w-12">직업</dt>
            <dd className="text-ink truncate">{p.occupation || "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-dusty shrink-0 w-12">가구</dt>
            <dd className="text-graphite truncate">{p.family_type || "—"}</dd>
          </div>
        </dl>
        <p className="text-body-sm text-graphite leading-relaxed line-clamp-4">
          {p.persona}
        </p>
      </div>

      {/* 액션 */}
      <footer className="px-4 py-2 border-t border-parchment flex justify-end">
        <button
          type="button"
          onClick={() => onOpenDetail(p.uuid)}
          className="text-caption text-graphite hover:text-terra hover:underline"
        >
          상세 보기 →
        </button>
      </footer>
    </li>
  );
}
