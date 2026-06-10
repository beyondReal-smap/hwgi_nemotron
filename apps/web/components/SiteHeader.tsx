"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Sticky 상단 헤더.
 *
 * 디자인 결정:
 * - 한화 톤 유지(vellum/ink/terra/azure). 구조·인터랙션만 정제.
 * - 슬림 높이(py-3) + max-width 1440px 컨테이너.
 * - 스크롤 8px+에서 border-bottom 진하게 + 미세 shadow → 컨텐츠와 분리 명확화.
 * - 로고는 SVG 페르소나 매칭 모티프(두 원이 겹친 벤다이어그램, terra).
 * - 브랜드 설명 카피는 md+에서만 노출(모바일 압축).
 * - 네비 active 표시: 검은 박스 → 하단 indicator(2px terra) + 텍스트 강조.
 *   (UX 가이드: Active State는 color + underline 권장)
 * - 모바일에서 네비 라벨 유지하되 아이콘 보조로 정보 강화.
 */
export function SiteHeader() {
  const pathname = usePathname();
  // 분석 결과는 /survey/[analysisId] 경로를 쓴다. 단, 설문 탭(/surveys)과 prefix가
  // 겹치지 않도록 "/survey/"(슬래시 포함) 또는 정확히 "/survey"만 매칭한다.
  const isAnalyze =
    pathname === "/analyze" ||
    pathname?.startsWith("/analyze/") ||
    pathname === "/survey" ||
    pathname?.startsWith("/survey/");
  const isPersonas = pathname?.startsWith("/personas");
  const isSurveys = pathname?.startsWith("/surveys"); // 통합 설문 탭 (마법사 + 이력)
  const isOverview = pathname?.startsWith("/overview");
  const isABTest = pathname?.startsWith("/abtest");
  const isCannibal = pathname?.startsWith("/cannibal");

  const scrolled = useScrolled(8);

  return (
    <header
      className={`sticky top-0 z-30 bg-vellum/95 backdrop-blur transition-[box-shadow,border-color] duration-200 ${
        scrolled
          ? "border-b border-onyx/15 shadow-[0_1px_0_rgba(20,20,19,0.04),0_4px_16px_-8px_rgba(20,20,19,0.12)]"
          : "border-b border-parchment"
      }`}
    >
      <div className="max-w-[1440px] mx-auto px-3 sm:px-4 lg:px-8 h-14 sm:h-16 lg:h-20 flex items-center justify-between gap-2 sm:gap-4">
        {/* 브랜드 — 모바일에서는 마크만 표시(좁은 화면 폭 절약) */}
        <Link
          href="/intro"
          className="flex items-center gap-1 sm:gap-1.5 group rounded-[9.6px] focus:outline-none focus-visible:ring-2 focus-visible:ring-azure shrink-0"
          aria-label="PersonaFit 소개 홈으로 이동"
        >
          <BrandMark />
          <div className="leading-tight hidden sm:block">
            <span className="text-title text-ink tracking-tight transition-colors group-hover:text-terra">
              PersonaFit
            </span>
          </div>
        </Link>

        {/* 네비 */}
        <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="주요 메뉴">
          <NavLink
            href="/overview"
            active={!!isOverview}
            icon={<IconOverview />}
            label="현황"
          />
          <NavLink
            href="/personas"
            active={!!isPersonas}
            icon={<IconUsers />}
            label="탐색"
          />
          {/* 그룹 구분 — 둘러보기(현황·탐색) │ 분석·시뮬레이션(분석·A/B·겹침·설문) */}
          <span
            aria-hidden
            className="mx-1 sm:mx-1.5 h-5 w-px bg-parchment shrink-0 self-center"
          />
          <NavLink
            href="/analyze"
            active={!!isAnalyze}
            icon={<IconAnalyze />}
            label="분석"
          />
          <NavLink
            href="/abtest"
            active={!!isABTest}
            icon={<IconABTest />}
            label="A/B 테스트"
          />
          <NavLink
            href="/cannibal"
            active={!!isCannibal}
            icon={<IconCannibal />}
            label="겹침 분석"
          />
          <NavLink
            href="/surveys"
            active={!!isSurveys}
            icon={<IconSurvey />}
            label="설문"
          />
        </nav>
      </div>
    </header>
  );
}

// ============================================================
// 브랜드 마크 — PersonaFit 로고(원본 PNG의 녹색을 terra로 치환). vellum 배경·라운드
// 사각형은 PNG 자체에 포함되므로 컨테이너 없이 그대로 노출.
// (apps/web/public/personafit-terra.png — 128×128)
// ============================================================

function BrandMark() {
  return (
    <Image
      src="/personafit-terra.png"
      alt=""
      width={44}
      height={44}
      className="w-9 h-9 sm:w-10 sm:h-10 lg:w-11 lg:h-11 rounded-[9.6px]
                 transition-transform group-hover:-rotate-2 group-active:scale-95 motion-reduce:group-hover:rotate-0 motion-reduce:group-active:scale-100"
      priority
    />
  );
}

// ============================================================
// 네비 항목
// ============================================================

function NavLink({
  href,
  active,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      className={`group relative inline-flex items-center justify-center gap-2
                  min-w-[44px] min-h-[44px] px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-[9.6px] text-body font-medium
                  transition-[color,background-color,transform,box-shadow] duration-200 ease-out
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-azure
                  hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.98]
                  motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100
                  ${
                    active
                      ? "text-ink font-semibold"
                      : "text-graphite hover:text-ink hover:bg-terra/[0.03] hover:shadow-[0_4px_12px_-4px_rgba(20,20,19,0.18),0_1px_3px_-1px_rgba(20,20,19,0.10)]"
                  }`}
    >
      <span
        className={`shrink-0 transition-[color,transform] duration-200 ease-out
                    ${
                      active
                        ? "text-terra scale-110"
                        : "text-dusty group-hover:text-graphite group-hover:scale-105"
                    }
                    motion-reduce:scale-100 motion-reduce:group-hover:scale-100`}
        aria-hidden
      >
        {icon}
      </span>
      {/* 모바일에서는 아이콘만 — 라벨은 sr-only로 보존(스크린리더 호환) */}
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
      {/* active indicator — sticky header 하단에 붙는 2px 막대, scaleX 슬라이드 */}
      <span
        aria-hidden
        className={`nav-indicator absolute left-2 right-2 sm:left-3 sm:right-3 -bottom-[1px] h-[2px] rounded-full bg-terra
                    ${active ? "nav-indicator-active" : "group-hover:bg-terra/40 group-hover:[transform:scaleX(0.5)]"}`}
      />
    </Link>
  );
}

// ============================================================
// 메뉴 아이콘 (Lucide 스타일, currentColor)
// ============================================================

const ICON_CLASS = "w-[18px] h-[18px]";

function IconAnalyze() {
  return (
    <svg
      viewBox="0 0 24 24"
      className={ICON_CLASS}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 21l-4.3-4.3" />
      <circle cx="11" cy="11" r="7" />
      <path d="M8 11h6M11 8v6" />
    </svg>
  );
}

function IconUsers() {
  // 페르소나 탐색 — 두 인물 실루엣
  return (
    <svg
      viewBox="0 0 24 24"
      className={ICON_CLASS}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconSurvey() {
  return (
    <svg
      viewBox="0 0 24 24"
      className={ICON_CLASS}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 4h9a2 2 0 0 1 2 2v13l-3.5-2-3.5 2-3.5-2L5 21V6a2 2 0 0 1 2-2z" />
      <path d="M9 9h6M9 13h4" />
    </svg>
  );
}

function IconABTest() {
  // 두 안 비교 — 좌우 분할 막대 (A/B)
  return (
    <svg
      viewBox="0 0 24 24"
      className={ICON_CLASS}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="8" height="14" rx="1.5" />
      <rect x="13" y="5" width="8" height="14" rx="1.5" />
      <path d="M12 3v18" strokeDasharray="2 2" />
    </svg>
  );
}

function IconCannibal() {
  // 겹침 분석 — 3×3 격자(히트맵) 모티프
  return (
    <svg
      viewBox="0 0 24 24"
      className={ICON_CLASS}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  );
}

function IconOverview() {
  // 데이터셋 현황 — 막대 + 지도 핀 모티프
  return (
    <svg
      viewBox="0 0 24 24"
      className={ICON_CLASS}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* 축 + 막대 3개 */}
      <path d="M4 20V5" />
      <path d="M4 20h16" />
      <path d="M8 17v-5" />
      <path d="M12 17v-9" />
      <path d="M16 17v-7" />
    </svg>
  );
}

// ============================================================
// useScrolled — 페이지 스크롤 위치 임계값 초과 여부
// ============================================================

function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => {
      const y = window.scrollY ?? window.pageYOffset ?? 0;
      setScrolled(y > threshold);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

// ============================================================
// Footer
// ============================================================

function IconTrophy() {
  // 출품작 배지용 트로피 (Lucide 스타일, currentColor)
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-parchment bg-vellum">
      <div className="max-w-[1440px] mx-auto px-4 lg:px-8 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* 왼쪽 — 출품작 크레딧(바이브코딩 경진대회 terra 배지) */}
        <div className="shrink-0">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-terra/30 bg-terra/10 px-3 py-1 text-caption font-semibold text-terra">
            <IconTrophy />
            바이브코딩 경진대회 출품작 · 제작 정진
          </span>
        </div>
        {/* 오른쪽 — 데이터 출처 · 분석 엔진 */}
        <div className="text-caption text-dusty flex flex-col gap-1 sm:text-right">
          <div>
            데이터:{" "}
            <a
              href="https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-ink"
            >
              nvidia/Nemotron-Personas-Korea
            </a>{" "}
            (CC BY 4.0) · 합성 페르소나 기반, 실제 인물과 무관
          </div>
          <div>분석 엔진: OpenAI GPT</div>
        </div>
      </div>
    </footer>
  );
}
