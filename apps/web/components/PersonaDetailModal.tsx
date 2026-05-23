"use client";

import { useEffect, useState } from "react";
import { getPersonaDetail, type PersonaDetail } from "@/lib/api";

/**
 * 페르소나 상세 모달 — 단일 페르소나의 풀 프로필.
 *
 * 구성:
 *  - 헤더: 성별/나이/지역 + close 버튼
 *  - 인구통계 그리드: 학력/혼인/가구/직업/주거 등
 *  - 페르소나 텍스트 7종(persona + 6 카테고리) — 펼치기 가능
 *  - skills/hobbies/career_goals — 있으면 표시
 */

const TEXT_LABELS: Record<string, string> = {
  persona: "종합 페르소나",
  professional_persona: "직업 페르소나",
  sports_persona: "스포츠 페르소나",
  arts_persona: "예술 페르소나",
  travel_persona: "여행 페르소나",
  culinary_persona: "요리 페르소나",
  family_persona: "가족 페르소나",
  skills_and_expertise: "전문성·기술",
  hobbies_and_interests: "취미·관심사",
  career_goals_and_ambitions: "경력 목표",
};

const META_LABELS: Record<string, string> = {
  sex: "성별",
  age: "연령",
  marital_status: "혼인상태",
  family_type: "가구 유형",
  housing_type: "주거 형태",
  education_level: "최종 학력",
  bachelors_field: "전공",
  occupation: "직업",
  province: "시도",
  district: "시군구",
  military_status: "병역",
};

export function PersonaDetailModal({
  uuid,
  onClose,
}: {
  uuid: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<PersonaDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["persona"]));

  useEffect(() => {
    if (!uuid) {
      setDetail(null);
      setExpanded(new Set(["persona"]));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPersonaDetail(uuid)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  // ESC로 닫기 + body scroll-lock
  useEffect(() => {
    if (!uuid) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [uuid, onClose]);

  if (!uuid) return null;

  function toggleExpand(key: string) {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="persona-modal-title"
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4 bg-onyx/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* 모바일: 풀스크린(100dvh), sm+ : 최대 3xl + max-h-90vh */}
      <div className="bg-vellum border-0 sm:border border-parchment rounded-none sm:rounded-[9.6px]
                      w-full sm:max-w-3xl h-[100dvh] sm:h-auto sm:max-h-[90vh]
                      overflow-hidden flex flex-col">
        {/* 헤더 — SectionCard 패턴, sticky */}
        <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-4 py-3 sm:px-5 sm:py-4
                           flex items-start justify-between gap-3 shrink-0
                           pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <h2 id="persona-modal-title" className="text-title text-ink">
              {detail
                ? `${detail.sex} · ${detail.age}세`
                : loading
                  ? "불러오는 중…"
                  : "페르소나 상세"}
            </h2>
            {detail && (
              <p className="text-body-sm text-dusty mt-1 truncate">
                {detail.province} · {detail.district} · {detail.occupation || "—"}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px]
                       text-graphite rounded-[9.6px] border border-parchment
                       hover:border-terra hover:text-terra transition-colors shrink-0
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
            aria-label="닫기"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        {/* 본문 — 모바일에서 safe-area-bottom 보정 */}
        <div className="overflow-y-auto p-4 sm:p-5 flex flex-col gap-4 sm:gap-5
                        pb-[max(1rem,env(safe-area-inset-bottom))]">
          {loading && (
            <div className="space-y-3 animate-pulse">
              <div className="h-20 bg-snow border border-parchment rounded-[9.6px]" />
              <div className="h-32 bg-snow border border-parchment rounded-[9.6px]" />
              <div className="h-32 bg-snow border border-parchment rounded-[9.6px]" />
            </div>
          )}

          {error && (
            <div className="bg-terra/10 border border-terra/30 text-ink px-4 py-3 rounded-[9.6px]">
              <p className="font-medium mb-1">상세 정보를 불러오지 못했습니다</p>
              <p className="text-caption text-graphite">{error}</p>
            </div>
          )}

          {detail && !loading && (
            <>
              {/* 인구통계 그리드 */}
              <section>
                <p className="text-overline text-dusty mb-2">인구통계</p>
                <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-2 text-body-sm">
                  {Object.entries(META_LABELS).map(([key, label]) => {
                    const v = detail[key];
                    if (v === null || v === undefined || v === "") return null;
                    return (
                      <div key={key} className="flex gap-2 min-w-0">
                        <dt className="text-dusty shrink-0">{label}</dt>
                        <dd className="text-ink truncate">{String(v)}</dd>
                      </div>
                    );
                  })}
                </dl>
              </section>

              {/* 페르소나 텍스트 7종 + skills/hobbies/career */}
              <section className="flex flex-col gap-3">
                <p className="text-overline text-dusty">페르소나 프로필</p>
                {Object.entries(TEXT_LABELS).map(([key, label]) => {
                  const text = detail[key];
                  if (!text || typeof text !== "string") return null;
                  const isOpen = expanded.has(key);
                  return (
                    <div
                      key={key}
                      className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleExpand(key)}
                        className="w-full min-h-[44px] px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-snow/70
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-azure transition-colors"
                        aria-expanded={isOpen}
                      >
                        <span className="text-body-sm font-medium text-ink">{label}</span>
                        <span className="text-caption text-dusty tabular-nums">
                          {text.length}자
                          <span
                            className={`ml-2 inline-block transition-transform ${
                              isOpen ? "rotate-180" : ""
                            }`}
                            aria-hidden
                          >
                            ▾
                          </span>
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-4 py-3 border-t border-parchment text-body-sm text-graphite leading-relaxed whitespace-pre-wrap">
                          {text}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
