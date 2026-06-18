"use client";

import { useEffect, useState } from "react";
import { getPersonaDetail, type PersonaDetail } from "@/lib/api";

/**
 * 페르소나 상세 모달 — 단일 페르소나의 풀 프로필.
 *
 * 구성:
 *  - 헤더: 원형 아바타 + 성별·연령 타이틀 + 지역·직업 칩 + close 버튼 (snow→vellum 그라데이션)
 *  - 인구통계 그리드: 라벨↑/값↓ 정렬, "오버라인 + 구분선" 섹션 헤더
 *  - 페르소나 프로필: 좌측 카테고리 탭 + 우측 본문 (탭 전환 시 우측 영역 크기 고정,
 *    내부 스크롤로 길이 차이 흡수해 카드 높이 흔들림 방지). active 탭은 우측 terra 인디케이터.
 *  - 등장: 오버레이 fade + 컨테이너 scale-in (motion-reduce 대응)
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

/** 라벨↑/값↓ 세로 정렬 필드 — 인구통계·금융 그리드 공용. */
function Field({ label, v }: { label: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-overline text-stone">{label}</dt>
      <dd className="text-body-sm text-ink truncate mt-0.5">{v}</dd>
    </div>
  );
}

/** 섹션 헤더 — 오버라인 라벨 + 채워지는 구분선. */
function SectionLabel({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-overline text-dusty shrink-0">{children}</span>
      {note && <span className="text-caption text-stone normal-case shrink-0">{note}</span>}
      <span aria-hidden className="h-px flex-1 bg-parchment" />
    </div>
  );
}

/**
 * 페르소나 아바타 — DiceBear personas 일러스트(실존 인물 아님 → 합성 페르소나 적합·초상권 안전).
 * uuid 시드로 결정적(같은 페르소나 = 항상 같은 얼굴), 성별(헤어·수염)·연령(고령 흰머리)·
 * 동양인 외형(밝은 황베이지 피부·검은 머리) 반영. eyes는 눈 보이는 값(open/happy/glasses)으로 제한.
 */
function avatarUrl(uuid: string, sex: unknown, age: unknown): string {
  const female = /여/.test(String(sex ?? "")); // "여자"
  const senior = (Number(age) || 0) >= 60; // 고령 → 흰머리
  const params = new URLSearchParams({
    seed: uuid,
    radius: "50",
    backgroundColor: female ? "f2c9b8" : "ccdbe8", // 여=peach, 남=azure (한화 톤)
    eyes: "open,happy,glasses",
    mouth: "smile,lips,smirk", // 업무용 단정한 표정 — 젖꼭지·찡그림·놀람 배제
    facialHairProbability: female ? "0" : "35",
    skinColor: "f2d3b3,ecc19c,eeb4a4", // 동양인 밝은 황베이지 톤
    hairColor: senior ? "b6b6b6,c8c8c8,d8d8d8" : "1c1c1c,2c222b,362c47", // 고령=흰머리 / 그 외=검정~짙은갈색
    hair: female
      ? "long,extraLong,bobCut,bobBangs,pigtails,curlyBun,straightBun,curly"
      : "shortCombover,buzzcut,fade,sideShave,shortComboverChops,curlyHighTop",
  });
  return `https://api.dicebear.com/9.x/personas/svg?${params.toString()}`;
}

/** 로딩/폴백용 사람 실루엣 (한화 톤, currentColor). */
function IconPerson() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-6 h-6 sm:w-7 sm:h-7 text-terra"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
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

  // 헤더 칩 — 지역·직업 (빈 값 제외)
  const chips = detail
    ? [detail.province, detail.district, detail.occupation].filter(
        (x): x is string | number => x != null && x !== "",
      )
    : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="persona-modal-title"
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4
                 bg-onyx/40 backdrop-blur-sm anim-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* 모바일: 풀스크린(100dvh), sm+ : 최대 3xl + max-h-90vh + 부유 그림자 */}
      <div className="bg-vellum border-0 sm:border border-parchment rounded-none sm:rounded-[16px]
                      w-full sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[90vh]
                      overflow-hidden flex flex-col
                      sm:shadow-[0_24px_64px_-16px_rgba(20,20,19,0.35)]
                      anim-scale-in motion-reduce:animate-none">
        {/* 헤더 — 아바타 + 타이틀 + 칩, snow→vellum 그라데이션 */}
        <header className="bg-gradient-to-br from-snow via-snow to-vellum border-b border-parchment
                           px-4 py-4 sm:px-6 sm:py-5 flex items-start gap-3 sm:gap-4 shrink-0
                           pt-[max(1rem,env(safe-area-inset-top))]">
          {/* 아바타 */}
          <div className="shrink-0 w-11 h-11 sm:w-14 sm:h-14 rounded-full overflow-hidden
                          bg-gradient-to-br from-terra/15 to-azure/35 border border-parchment
                          flex items-center justify-center">
            {loading ? (
              <span className="w-5 h-5 rounded-full bg-parchment animate-pulse motion-reduce:animate-none" />
            ) : detail ? (
              // 실존 인물이 아닌 일러스트 아바타(DiceBear). 외부 SVG라 next/image 대신 img 사용.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl(uuid, detail.sex, detail.age)}
                alt=""
                width={56}
                height={56}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <IconPerson />
            )}
          </div>

          {/* 타이틀 + 칩 */}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id="persona-modal-title" className="text-heading text-ink tracking-tight">
              {detail
                ? `${detail.sex} · ${detail.age}세`
                : loading
                  ? "불러오는 중…"
                  : "페르소나 상세"}
            </h2>
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {chips.map((x, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full
                               bg-vellum border border-parchment text-caption text-graphite"
                  >
                    {String(x)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 닫기 */}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px]
                       text-graphite rounded-[9.6px] border border-parchment bg-vellum/60
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
            <div className="space-y-3 animate-pulse min-h-[420px] motion-reduce:animate-none">
              <div className="h-20 bg-snow border border-parchment rounded-[10px]" />
              <div className="h-32 bg-snow border border-parchment rounded-[10px]" />
              <div className="h-32 bg-snow border border-parchment rounded-[10px]" />
            </div>
          )}

          {error && (
            <div className="bg-terra/10 border border-terra/30 text-ink px-4 py-3 rounded-[10px]">
              <p className="font-medium mb-1">상세 정보를 불러오지 못했습니다</p>
              <p className="text-caption text-graphite">{error}</p>
            </div>
          )}

          {detail && !loading && (
            <>
              {/* 인구통계 그리드 — shrink-0으로 카테고리 영역과 공간 경쟁 차단 */}
              <section className="shrink-0">
                <SectionLabel>인구통계</SectionLabel>
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
                  {Object.entries(META_LABELS).map(([key, label]) => {
                    const v = detail[key];
                    if (v === null || v === undefined || v === "") return null;
                    return <Field key={key} label={label} v={String(v)} />;
                  })}
                </dl>
              </section>

              {/* 금융·소비 프로파일 (AI Hub 통합, 추정) — fin_ 데이터 있을 때만 */}
              {detail.fin_est_income != null && (
                <section className="shrink-0">
                  <SectionLabel note="인구통계 기반 추정">금융·소비 프로파일</SectionLabel>
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
                    <Field label="추정 연소득" v={fmtWon(detail.fin_est_income)} />
                    <Field
                      label="소득 상위"
                      v={detail.fin_income_pct != null ? `상위 ${detail.fin_income_pct}%` : "—"}
                    />
                    <Field label="총자산" v={fmtWon(detail.fin_total_asset)} />
                    <Field
                      label="주택 보유"
                      v={detail.fin_house_count != null ? `${detail.fin_house_count}채` : "—"}
                    />
                    <Field
                      label="생애주기"
                      v={detail.fin_life_stage ? String(detail.fin_life_stage) : "—"}
                    />
                    <Field label="카드소비(3M)" v={fmtWon(detail.fin_card_spend)} />
                  </dl>
                  {(() => {
                    const ints = FIN_INTEREST.filter(([, k]) => detail[k]);
                    const spends = FIN_SPEND.filter(([, k]) => Number(detail[k]) > 0)
                      .sort((a, b) => Number(detail[b[1]]) - Number(detail[a[1]]))
                      .slice(0, 3);
                    return (
                      <>
                        {ints.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                            <span className="text-caption text-dusty">관심사</span>
                            {ints.map(([lbl, k]) => (
                              <span
                                key={k}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-overline font-medium bg-terra/15 text-terra border border-terra/30"
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
                <div className="shrink-0">
                  <SectionLabel>페르소나 프로필</SectionLabel>
                </div>
                <div
                  className="flex-1 min-h-0 grid grid-cols-[128px_minmax(0,1fr)] sm:grid-cols-[200px_minmax(0,1fr)]
                             border border-parchment rounded-[10px] overflow-hidden bg-snow"
                >
                  {/* 좌측 탭 리스트 — 카테고리명만(글자수는 우측 헤더로 이동해 노이즈 정리) */}
                  <ul
                    role="tablist"
                    aria-label="페르소나 카테고리"
                    className="border-r border-parchment overflow-y-auto bg-vellum/60 py-1"
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
                            className={`relative w-full text-left px-3 py-2.5 text-body-sm transition-colors
                                        focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-azure
                                        ${
                                          isActive
                                            ? "bg-snow text-ink font-semibold"
                                            : "text-graphite font-medium hover:bg-snow/60 hover:text-ink"
                                        }`}
                          >
                            {TEXT_LABELS[key]}
                            {/* active 인디케이터 — 좌측에 terra 막대(요청) */}
                            {isActive && (
                              <span
                                aria-hidden
                                className="absolute left-0 inset-y-1.5 w-[2.5px] rounded-full bg-terra"
                              />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {/* 우측 컬럼 — 고정 카테고리 헤더 + 스크롤 본문.
                      폭 축소(모달 2xl + 탭 200px)로 한 줄 길이를 가독 범위(약 65자)로 제한. */}
                  <div className="min-w-0 flex flex-col">
                    <div className="flex items-baseline gap-2 px-4 sm:px-5 py-2.5 border-b border-parchment/70 bg-snow shrink-0">
                      <span className="text-overline text-graphite">{TEXT_LABELS[selectedKey]}</span>
                      {typeof detail[selectedKey] === "string" && detail[selectedKey] && (
                        <span className="text-caption text-stone tabular-nums">
                          {(detail[selectedKey] as string).length}자
                        </span>
                      )}
                    </div>
                    <div
                      id="persona-detail-body"
                      role="tabpanel"
                      aria-labelledby={selectedKey}
                      key={selectedKey}
                      className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 text-body-sm text-graphite leading-relaxed whitespace-pre-wrap anim-fade-in motion-reduce:animate-none"
                    >
                      {typeof detail[selectedKey] === "string" && detail[selectedKey]
                        ? (detail[selectedKey] as string)
                        : "(이 카테고리는 비어 있습니다)"}
                    </div>
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
