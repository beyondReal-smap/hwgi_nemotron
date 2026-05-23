"use client";

import { useMemo, useState } from "react";
import type {
  PersonaFacets,
  PersonaFilterRequest,
} from "@/lib/api";

/**
 * 페르소나 탐색 필터 패널 — /personas 좌측 사이드바.
 *
 * 디자인 원칙:
 * - 한화 토큰만 사용 (vellum/ink/terra/azure/parchment/snow/dusty/graphite/stone)
 * - 모든 입력은 즉시 부모로 onChange (디바운스는 부모에서 처리)
 * - 자연어 입력은 별도 영역으로 분리 (없으면 단순 필터 모드)
 * - 다중 선택 체크박스 그룹은 접기/펼치기로 시각 압축
 */
export function PersonaFilterPanel({
  facets,
  value,
  onChange,
  onReset,
}: {
  facets: PersonaFacets | null;
  value: PersonaFilterRequest;
  onChange: (next: PersonaFilterRequest) => void;
  onReset: () => void;
}) {
  const ageMin = value.age_min ?? facets?.age_range.min ?? 0;
  const ageMax = value.age_max ?? facets?.age_range.max ?? 100;

  function patch(p: Partial<PersonaFilterRequest>) {
    onChange({ ...value, ...p, page: 1 });
  }

  return (
    <aside className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden flex flex-col">
      {/* 헤더 — SectionCard 패턴과 동일 */}
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-title text-ink">필터</h2>
          <p className="text-body-sm text-dusty mt-1">조건을 선택하면 즉시 갱신</p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="text-caption text-graphite px-2 py-1 rounded border border-parchment
                     hover:border-terra hover:text-terra transition-colors shrink-0"
        >
          초기화
        </button>
      </header>

      <div className="p-4 flex flex-col gap-5">
        {/* 자연어 입력 */}
        <section>
          <label className="text-overline text-dusty">자연어 조건 (선택)</label>
          <textarea
            value={value.query ?? ""}
            onChange={(e) => patch({ query: e.target.value || null })}
            placeholder="예: 30대 워킹맘 수도권 거주"
            maxLength={500}
            rows={2}
            className="mt-1 w-full px-3 py-2 bg-snow border border-onyx/15 rounded-[9.6px]
                       text-body-sm text-ink placeholder:text-stone
                       focus:outline-none focus:ring-2 focus:ring-azure focus:border-onyx/30 resize-none"
          />
          {value.query && (
            <p className="text-caption text-dusty mt-1">
              임베딩 코사인 유사도로 결과를 정렬합니다
            </p>
          )}
        </section>

        {/* 연령대 */}
        <FilterGroup label="연령대">
          <div className="flex items-center gap-2 text-body-sm">
            <input
              type="number"
              min={facets?.age_range.min ?? 0}
              max={facets?.age_range.max ?? 120}
              value={ageMin}
              onChange={(e) =>
                patch({ age_min: e.target.value ? Number(e.target.value) : null })
              }
              className="w-20 px-2 py-1.5 bg-snow border border-onyx/15 rounded-[9.6px] text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-azure"
            />
            <span className="text-dusty">~</span>
            <input
              type="number"
              min={facets?.age_range.min ?? 0}
              max={facets?.age_range.max ?? 120}
              value={ageMax}
              onChange={(e) =>
                patch({ age_max: e.target.value ? Number(e.target.value) : null })
              }
              className="w-20 px-2 py-1.5 bg-snow border border-onyx/15 rounded-[9.6px] text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-azure"
            />
            <span className="text-caption text-dusty">세</span>
          </div>
        </FilterGroup>

        {/* 성별 */}
        <FilterGroup label="성별">
          <CheckboxGroup
            options={["남자", "여자"]}
            value={value.sex ?? []}
            onChange={(arr) => patch({ sex: arr as ("남자" | "여자")[] })}
          />
        </FilterGroup>

        {/* 지역 (17개 시도) */}
        {facets && (
          <FilterGroup label="지역 (시도)" collapsible defaultOpen={false}>
            <CheckboxGroup
              options={facets.provinces}
              value={value.provinces ?? []}
              onChange={(arr) => patch({ provinces: arr })}
              cols={2}
            />
          </FilterGroup>
        )}

        {/* 학력 */}
        {facets && (
          <FilterGroup label="학력" collapsible defaultOpen={false}>
            <CheckboxGroup
              options={facets.education_levels}
              value={value.education_levels ?? []}
              onChange={(arr) => patch({ education_levels: arr })}
            />
          </FilterGroup>
        )}

        {/* 가구 유형 — 39개로 매우 많아 검색 입력 형태로 */}
        {facets && (
          <FilterGroup label="가구 유형" collapsible defaultOpen={false}>
            <SearchableCheckList
              options={facets.family_types}
              value={value.family_types ?? []}
              onChange={(arr) => patch({ family_types: arr })}
              placeholder="가구 유형 검색…"
            />
          </FilterGroup>
        )}

        {/* 직업 — 부분 매칭 키워드 */}
        <FilterGroup label="직업 키워드 (부분 매칭)">
          <input
            type="text"
            value={(value.occupations ?? []).join(", ")}
            onChange={(e) =>
              patch({
                occupations: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="예: 의사, 개발자, 교사"
            className="w-full px-3 py-2 bg-snow border border-onyx/15 rounded-[9.6px]
                       text-body-sm text-ink placeholder:text-stone
                       focus:outline-none focus:ring-2 focus:ring-azure focus:border-onyx/30"
          />
          <p className="text-caption text-dusty mt-1">콤마로 구분, 직업명 일부만 입력해도 매칭</p>
        </FilterGroup>
      </div>
    </aside>
  );
}

// ============================================================
// 공통 — FilterGroup (접기/펼치기)
// ============================================================

function FilterGroup({
  label,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  label: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <section>
        <p className="text-overline text-dusty mb-1.5">{label}</p>
        {children}
      </section>
    );
  }

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full text-overline text-dusty hover:text-graphite mb-1.5"
        aria-expanded={open}
      >
        <span>{label}</span>
        <span
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {open && children}
    </section>
  );
}

// ============================================================
// 공통 — 체크박스 그룹
// ============================================================

function CheckboxGroup({
  options,
  value,
  onChange,
  cols = 1,
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  cols?: 1 | 2;
}) {
  function toggle(opt: string) {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  }

  return (
    <ul className={`grid gap-1 ${cols === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
      {options.map((opt) => {
        const checked = value.includes(opt);
        return (
          <li key={opt}>
            <label className="flex items-center gap-2 cursor-pointer text-body-sm text-graphite hover:text-ink">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(opt)}
                className="accent-terra"
              />
              <span className={checked ? "text-ink font-medium" : ""}>{opt}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

// ============================================================
// 공통 — 검색 가능한 체크리스트 (40+ 옵션 대응)
// ============================================================

function SearchableCheckList({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () =>
      options.filter((o) => o.toLowerCase().includes(q.toLowerCase())).slice(0, 30),
    [options, q],
  );

  function toggle(opt: string) {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="px-2.5 py-1.5 bg-snow border border-onyx/15 rounded-[9.6px]
                   text-body-sm text-ink placeholder:text-stone
                   focus:outline-none focus:ring-2 focus:ring-azure"
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 text-caption px-2 py-0.5 bg-snow border border-terra/30 text-terra rounded-full"
            >
              {v}
              <button
                type="button"
                onClick={() => toggle(v)}
                className="hover:text-ink"
                aria-label={`${v} 제거`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <ul className="max-h-44 overflow-auto border border-parchment rounded-[9.6px] bg-snow/50">
        {filtered.length === 0 && (
          <li className="px-3 py-2 text-caption text-stone">결과 없음</li>
        )}
        {filtered.map((opt) => {
          const checked = value.includes(opt);
          return (
            <li key={opt}>
              <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-body-sm text-graphite hover:bg-snow">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                  className="accent-terra"
                />
                <span className={checked ? "text-ink font-medium" : ""}>{opt}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
