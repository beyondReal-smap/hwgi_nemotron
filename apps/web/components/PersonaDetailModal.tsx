"use client";

import { useEffect, useState } from "react";
import { getPersonaDetail, type PersonaDetail } from "@/lib/api";

/**
 * 페르소나 상세 모달 — 단일 페르소나의 풀 프로필.
 *
 * 구성:
 *  - 헤더: 성별/나이/지역 + close 버튼
 *  - 인구통계 그리드: 학력/혼인/가구/직업/주거 등
 *  - 페르소나 프로필: 좌측 카테고리 탭 + 우측 본문 (탭 전환 시 우측 영역 크기 고정,
 *    내부 스크롤로 길이 차이 흡수해 카드 높이 흔들림 방지)
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

const TEXT_KEYS = Object.keys(TEXT_LABELS);

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

// 금융·소비 프로파일 (AI Hub 통합, fin_ 컬럼). 인구통계 기반 추정치.
const FIN_INTEREST: [string, string][] = [
  ["보험", "fin_interest_insurance"], ["건강·의료", "fin_interest_health"],
  ["키즈·육아 콘텐츠", "fin_interest_kids"], ["여행·레저", "fin_interest_travel"],
];
const FIN_SPEND: [string, string][] = [
  ["외식", "fin_spend_food"], ["마트", "fin_spend_mart"], ["여행", "fin_spend_travel"],
  ["의료", "fin_spend_med"], ["교육", "fin_spend_edu"], ["자동차", "fin_spend_car"],
  ["문화", "fin_spend_culture"], ["배달", "fin_spend_delivery"],
];

/** 천원 단위 정수 → 읽기 쉬운 한글 금액 (예: 33229 → "3,323만원", 245071 → "2.5억"). */
function fmtWon(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 100000) return `${(n / 100000).toFixed(1)}억`;
  return `${Math.round(n / 10).toLocaleString()}만원`;
}

function FinField({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <dt className="text-dusty shrink-0">{label}</dt>
      <dd className="text-ink truncate">{v}</dd>
    </div>
  );
}

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
  // 좌측 탭에서 선택된 카테고리 키. uuid 전환 시 첫 키로 초기화.
  const [selectedKey, setSelectedKey] = useState<string>(TEXT_KEYS[0]);

  useEffect(() => {
    if (!uuid) {
      setDetail(null);
      setSelectedKey(TEXT_KEYS[0]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedKey(TEXT_KEYS[0]);
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

        {/* 본문 — 좌측 탭+우측 본문 패턴의 영역 안정성을 위해 자체 스크롤 X.
            내부 우측 본문(overflow-y-auto)에서만 스크롤이 발생하도록 overflow-hidden + flex-1 */}
        <div className="flex-1 min-h-0 overflow-hidden p-4 sm:p-5 flex flex-col gap-4 sm:gap-5
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
              {/* 인구통계 그리드 — shrink-0으로 카테고리 영역과 공간 경쟁 차단 */}
              <section className="shrink-0">
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

              {/* 금융·소비 프로파일 (AI Hub 통합, 추정) — fin_ 데이터 있을 때만 */}
              {detail.fin_est_income != null && (
                <section className="shrink-0">
                  <p className="text-overline text-dusty mb-2">
                    금융·소비 프로파일{" "}
                    <span className="text-stone normal-case">(인구통계 기반 추정)</span>
                  </p>
                  <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-2 text-body-sm">
                    <FinField label="추정 연소득" v={fmtWon(detail.fin_est_income)} />
                    <FinField
                      label="소득 상위"
                      v={detail.fin_income_pct != null ? `상위 ${detail.fin_income_pct}%` : "—"}
                    />
                    <FinField label="총자산" v={fmtWon(detail.fin_total_asset)} />
                    <FinField
                      label="주택 보유"
                      v={detail.fin_house_count != null ? `${detail.fin_house_count}채` : "—"}
                    />
                    <FinField
                      label="생애주기"
                      v={detail.fin_life_stage ? String(detail.fin_life_stage) : "—"}
                    />
                    <FinField label="카드소비(3M)" v={fmtWon(detail.fin_card_spend)} />
                  </dl>
                  {(() => {
                    const ints = FIN_INTEREST.filter(([, k]) => detail[k]);
                    const spends = FIN_SPEND.filter(([, k]) => Number(detail[k]) > 0)
                      .sort((a, b) => Number(detail[b[1]]) - Number(detail[a[1]]))
                      .slice(0, 3);
                    return (
                      <>
                        {ints.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <span className="text-caption text-dusty">관심사</span>
                            {ints.map(([lbl, k]) => (
                              <span
                                key={k}
                                className="inline-flex items-center px-2 py-0.5 rounded-[5px] text-overline font-medium bg-terra/15 text-terra border border-terra/30"
                              >
                                {lbl}
                              </span>
                            ))}
                          </div>
                        )}
                        {spends.length > 0 && (
                          <p className="text-caption text-graphite mt-1.5">
                            주요 소비: {spends.map(([lbl]) => lbl).join(" · ")}
                          </p>
                        )}
                      </>
                    );
                  })()}
                </section>
              )}

              {/* 페르소나 프로필 — 좌측 카테고리 탭 + 우측 본문.
                  카테고리 전환 시 우측 영역 크기 고정, 내부에서만 스크롤 → 모달/카드 흔들림 차단. */}
              <section className="flex-1 min-h-0 flex flex-col">
                <p className="text-overline text-dusty mb-2 shrink-0">페르소나 프로필</p>
                <div
                  className="flex-1 min-h-0 grid grid-cols-[120px_minmax(0,1fr)] sm:grid-cols-[180px_minmax(0,1fr)]
                             border border-parchment rounded-[9.6px] overflow-hidden bg-snow"
                >
                  {/* 좌측 탭 리스트 */}
                  <ul
                    role="tablist"
                    aria-label="페르소나 카테고리"
                    className="border-r border-parchment overflow-y-auto bg-vellum"
                  >
                    {TEXT_KEYS.map((key) => {
                      const text = detail[key];
                      if (!text || typeof text !== "string") return null;
                      const isActive = selectedKey === key;
                      return (
                        <li key={key} role="presentation">
                          <button
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-controls="persona-detail-body"
                            onClick={() => setSelectedKey(key)}
                            className={`w-full text-left px-3 py-2.5 border-l-4 transition-colors
                                        focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-azure
                                        ${
                                          isActive
                                            ? "border-l-terra bg-snow text-ink"
                                            : "border-l-transparent text-graphite hover:bg-snow/70 hover:text-ink"
                                        }`}
                          >
                            <span
                              className={`block text-body-sm ${
                                isActive ? "font-semibold" : "font-medium"
                              }`}
                            >
                              {TEXT_LABELS[key]}
                            </span>
                            <span className="block text-caption text-dusty tabular-nums mt-0.5">
                              {text.length}자
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {/* 우측 본문 — flex 자식의 overflow를 위해 min-w-0, 자체 스크롤. */}
                  <div
                    id="persona-detail-body"
                    role="tabpanel"
                    aria-labelledby={selectedKey}
                    className="min-w-0 overflow-y-auto px-4 py-3 text-body-sm text-graphite leading-relaxed whitespace-pre-wrap"
                  >
                    {typeof detail[selectedKey] === "string" && detail[selectedKey]
                      ? (detail[selectedKey] as string)
                      : "(이 카테고리는 비어 있습니다)"}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
