"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { SiteFooter } from "@/components/SiteHeader";

/**
 * /intro — PersonaFit 소개 랜딩 (메인 홈, 화려함 v4).
 *
 * 색 정책: terra(#d97757) 브랜드 핵심 + **terra 명암 스펙트럼**(peach #f2c9b8 → #e0875f
 *   → terra → rust #b85535) 확장. 이질색(파랑/초록/보라) 미도입. azure는 cool 보조.
 *
 * v4 변경(대표님 피드백):
 *   1) 100만 매칭 점 필드를 작은 박스 → **Hero 전체 배경**으로(CSS 격자 base + 매칭 terra
 *      점 40개 펄스 + 스캔바). 카피는 중앙 오버레이, vellum radial 마스크로 가독성 확보.
 *   2) 최종 CTA 로고를 **밝은 vellum 배지** 위에 올려 다크 배경 대비 확보.
 *   3) 헤더 로고 → /intro (SiteHeader에서 처리).
 *
 * v5 변경(대표님 피드백): 섹션 배경 교차로 스크롤 구분 강화. HowItWorks는 snow 배경 +
 *   parchment 경계선, 내부 카드는 vellum으로 반전(snow 배경 위 가시성 확보). Hero·Scale은
 *   vellum 배경 + snow 카드 유지. 결과: vellum → snow → vellum → onyx(CTA) 교차.
 *
 * 모든 모션은 prefers-reduced-motion에서 무효화.
 */
export default function IntroPage() {
  const rootRef = useRevealRoot();
  return (
    <div ref={rootRef} className="bg-vellum text-ink overflow-clip">
      <IconDefs />
      <Hero />
      <HowItWorks />
      <ScaleSection />
      <SiteFooter />
      <style jsx global>{introStyles}</style>
    </div>
  );
}

function IconDefs() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <defs>
        <linearGradient id="ic-terra" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e0875f" />
          <stop offset="1" stopColor="#141413" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ============================================================
 * ① Hero — 전체 배경 점 필드 + 중앙 카피
 * ============================================================ */

// 매칭된 타겟 점 — 결정적 해시 좌표(SSR/CSR 동일). x/y는 %.
// 펄스 딜레이를 x위치에 비례시켜 스캔바(좌→우)가 지날 때 그 점이 켜지는 웨이브를 만든다.
const SCAN_PERIOD = 3.2;
const MATCHED = Array.from({ length: 40 }, (_, i) => {
  const x = 3 + ((Math.imul(i + 1, 2654435761) >>> 0) % 94);
  const y = 5 + ((Math.imul(i + 13, 40503) >>> 0) % 90);
  return { x, y, strong: i % 3 === 0, d: ((x / 100) * SCAN_PERIOD).toFixed(2) };
});

function Hero() {
  return (
    <section className="relative isolate min-h-[calc(100dvh-3.5rem)] sm:min-h-[calc(100dvh-4rem)] lg:min-h-[calc(100dvh-5rem)] flex items-center">
      <HeroBackdrop />

      <div className="relative z-10 w-full max-w-[860px] mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <p className="hero-line inline-flex items-center gap-2 rounded-2xl sm:rounded-full border border-terra/30 bg-terra/8 px-4 py-1.5 text-overline text-terra shadow-[0_0_0_4px_rgba(217,119,87,0.05)]" style={{ "--i": 0 } as React.CSSProperties}>
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terra shrink-0" />
          <span className="text-left leading-snug">
            AI 페르소나 타겟 분석
            <span className="hidden sm:inline"> · </span>
            <span className="block sm:inline">Nemotron-Personas-Korea</span>
          </span>
        </p>

        <h1 className="hero-line mt-6 text-balance text-[2.5rem] leading-[1.05] sm:text-[3.6rem] lg:text-[4.6rem] font-bold tracking-[-0.035em]" style={{ "--i": 1 } as React.CSSProperties}>
          <span className="hero-gradient">100만 한국인 페르소나</span>가
          <br className="hidden sm:block" /> 당신의 상품에 먼저 답합니다
        </h1>

        <p className="hero-line mx-auto mt-6 max-w-[42rem] text-body sm:text-[1.125rem] text-graphite leading-relaxed" style={{ "--i": 2 } as React.CSSProperties}>
          상품설명서·약관·마케팅 카피·신상품 컨셉을 입력하면, 합성 한국인 100만 명과
          매칭해 <strong className="font-semibold text-ink">반응할 타겟·반응도·공략 지역·페르소나 의견·A/B 비교</strong>까지 한 번에.
        </p>

        <div className="hero-line mt-9 flex flex-col sm:flex-row items-center justify-center gap-3" style={{ "--i": 3 } as React.CSSProperties}>
          <CtaButton href="/personas" variant="primary">페르소나 탐색하기<ArrowIcon /></CtaButton>
          <CtaButton href="/analyze" variant="ghost">상품 분석 시작하기</CtaButton>
        </div>

        {/* 인라인 미니 스탯 — 반투명 카드로 배경 점과 분리(가독성) */}
        <div className="hero-line mt-10 mx-auto w-fit max-w-full flex flex-col sm:flex-row items-center sm:items-stretch justify-center gap-y-3 gap-x-7 sm:gap-x-9 rounded-[16px] border border-parchment bg-snow/80 backdrop-blur-md px-6 sm:px-7 py-4 shadow-[0_14px_38px_-20px_rgba(20,20,19,0.35)]" style={{ "--i": 4 } as React.CSSProperties}>
          <MiniStat value={1_000_000} suffix="명" label="합성 페르소나 모집단" />
          <Divider />
          <MiniStat value={84} suffix="ms" label="100만 행 전수 검색" />
          <Divider />
          <MiniStat value={252} suffix="개" label="시군구 공략 지역" />
        </div>
      </div>

      {/* 범례 (배경 점 설명) */}
      <div aria-hidden className="hero-line absolute left-4 lg:left-8 bottom-5 hidden sm:flex items-center gap-4 text-caption text-graphite" style={{ "--i": 5 } as React.CSSProperties}>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-terra shadow-[0_0_6px_rgba(217,119,87,0.85)]" />매칭된 타겟</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-stone/45" />전체 모집단</span>
      </div>

      <a href="#how" aria-label="작동 원리로 스크롤" className="scroll-cue absolute left-1/2 bottom-5 -translate-x-1/2 hidden lg:flex flex-col items-center gap-1.5 text-dusty hover:text-terra transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-azure rounded-full p-2">
        <span className="text-caption">스크롤</span>
        <span className="block h-9 w-[22px] rounded-full border border-stone/60 relative">
          <span className="scroll-dot absolute left-1/2 top-1.5 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-terra" />
        </span>
      </a>
    </section>
  );
}

function HeroBackdrop() {
  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
      <div className="aurora absolute inset-0" />
      <span className="blob absolute -top-24 -left-20 h-[34rem] w-[34rem] rounded-full bg-terra/12 blur-[90px]" />
      <span className="blob absolute top-1/3 -right-28 h-[30rem] w-[30rem] rounded-full bg-azure/50 blur-[90px]" style={{ animationDelay: "2.5s" }} />

      {/* 100만 모집단 점 필드 — 전체 배경. base는 CSS 격자, 매칭은 terra 점 */}
      <div className="hero-dots absolute inset-0" />
      {MATCHED.map((m, i) => (
        <span
          key={i}
          className={m.strong ? "hero-match hero-match-strong" : "hero-match"}
          style={{ left: `${m.x}%`, top: `${m.y}%`, "--ds": `${m.d}s` } as React.CSSProperties}
        />
      ))}
      {/* 스캔바 */}
      <span className="hero-scan absolute inset-y-0 w-1/4" />

      {/* 텍스트 가독용 vellum radial 마스크 */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_52%_46%_at_50%_42%,rgba(250,249,245,0.92),rgba(250,249,245,0.35)_60%,transparent_82%)]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-vellum" />
    </div>
  );
}

function MiniStat({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  return (
    <div className="text-center">
      <CountUp value={value} suffix={suffix} className="stat-num text-[1.6rem] sm:text-[2rem] font-bold num-tabular leading-none" suffixClassName="text-[0.95rem] text-graphite ml-0.5 font-semibold" />
      <p className="mt-1 text-caption text-dusty">{label}</p>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="hidden sm:block w-px self-stretch bg-parchment" />;
}

/* ============================================================
 * ② 작동 원리 + 핵심 기능
 * ============================================================ */
const PIPELINE = [
  { step: "01", title: "입력", desc: "약관·상품설명서·마케팅 카피·신상품 컨셉을 붙여넣거나 파일로 업로드", meta: "TXT · PDF · DOCX · HWP · HWPX 자동 추출", icon: <IconUpload />, demo: "input" as const },
  { step: "02", title: "소구점·타겟 추출", desc: "LLM이 핵심 혜택과 반응할 타겟 조건을 구조화해 뽑아냅니다", meta: "tool_use 기반 구조화 추출", icon: <IconSpark />, demo: "extract" as const },
  { step: "03", title: "100만 행 매칭", desc: "임베딩 코사인 + 룰·카테고리 가중치로 100만 페르소나를 전수 스캔", meta: "brute-force ~84ms · 인메모리", icon: <IconScan />, demo: "match" as const },
  { step: "04", title: "인사이트", desc: "반응도·코호트·공략 지역·페르소나 의견·FP 전략·리포트로 정리", meta: "지도 · 분포 차트 · 마크다운 리포트", icon: <IconInsight />, demo: "insight" as const },
];
const FEATURES = [
  { title: "약관·상품 분석", desc: "소구점 추출 → 페르소나 매칭 → 반응도·코호트·지역·의견·FP 리포트", icon: <IconAnalyze />, demo: "analyze" as const },
  { title: "A/B 테스트", desc: "두 안을 평행 분석하고 비교 표·추천안·판매 전략까지 도출", icon: <IconABTest />, demo: "abtest" as const },
  { title: "페르소나 탐색", desc: "자연어로 검색하면 시멘틱 + 메타 필터로 후보를 카드로 제시", icon: <IconUsers />, demo: "explore" as const },
  { title: "가상 설문", desc: "페르소나 모집단에 질문을 던져 응답 통계와 차트 리포트를 생성", icon: <IconSurvey />, demo: "survey" as const },
  { title: "데이터 현황", desc: "100만 행 데이터셋의 인구통계·지역 분포를 한눈에 시각화", icon: <IconOverview />, demo: "overview" as const },
  { title: "공략 지역 지도", desc: "252개 시군구 단위 반응 집중도를 한국 지도 위에 표시", icon: <IconMap />, demo: "map" as const },
];

/* ---- 파이프라인 단계별 라이브 미니 데모 ----
 * 카드가 뷰포트에 진입(.reveal.is-visible)하면 CSS 애니메이션이 1회 순차 재생되고,
 * 커서·스캔·점등 등 일부 요소만 은은한 루프를 유지한다. 추가 JS·IntersectionObserver 없음
 * (카드의 기존 reveal 게이팅을 그대로 재사용). 모든 모션은 reduced-motion에서 정적 처리.
 */
function PipelineDemo({ type }: { type: "input" | "extract" | "match" | "insight" }) {
  return (
    <div className="demo-panel relative mt-4 h-[92px] overflow-hidden rounded-[10px] border border-parchment bg-snow/70 px-3 py-2.5">
      {type === "input" && <DemoInput />}
      {type === "extract" && <DemoExtract />}
      {type === "match" && <DemoMatch />}
      {type === "insight" && <DemoInsight />}
    </div>
  );
}

// ① 입력 — 문서명이 타이핑되고 본문 라인이 자리잡는 미니 에디터
function DemoInput() {
  return (
    <div className="demo-input flex h-full flex-col justify-center gap-2">
      <span className="typing inline-block self-start max-w-full text-[11px] font-medium text-ink">무·해지환급형 종신보험 약관.pdf</span>
      <span className="ghost block h-[5px] w-4/5 rounded-full bg-stone/25" style={{ "--d": "1.5s" } as React.CSSProperties} />
      <span className="ghost block h-[5px] w-3/5 rounded-full bg-stone/25" style={{ "--d": "1.7s" } as React.CSSProperties} />
      <span className="file-chip absolute right-2.5 top-2.5 rounded border border-terra/30 bg-terra/10 px-1.5 py-[3px] text-[9px] font-semibold text-terra" style={{ "--d": "1.9s" } as React.CSSProperties}>추출 완료</span>
    </div>
  );
}

// ② 추출 — 소구점·타겟 조건이 칩으로 순차 pop-in
const EXTRACT_CHIPS = ["40–50대", "질병 보장", "납입면제", "수도권", "납입부담↓", "보장성"];
function DemoExtract() {
  return (
    <div className="demo-extract flex h-full flex-wrap content-center items-center gap-1.5">
      {EXTRACT_CHIPS.map((c, i) => (
        <span
          key={c}
          className="chip rounded-full border border-terra/30 bg-terra/10 px-2 py-[3px] text-[10px] font-medium text-terra"
          style={{ "--d": `${(0.3 + i * 0.16).toFixed(2)}s` } as React.CSSProperties}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

// ③ 매칭 — 점 그리드 위로 스캔 웨이브가 지나며 타겟 점이 좌→우로 점등
const MATCH_ON = new Set([2, 4, 7, 9, 12, 15, 18, 20, 23, 25]);
function DemoMatch() {
  return (
    <div className="demo-match relative h-full">
      <div className="grid grid-cols-7 gap-x-2 gap-y-[7px] px-0.5 pt-1">
        {Array.from({ length: 28 }, (_, i) => {
          const on = MATCH_ON.has(i);
          const col = i % 7;
          return (
            <span
              key={i}
              className={on ? "md-dot md-on" : "md-dot"}
              style={on ? ({ "--d": `${(0.3 + col * 0.26).toFixed(2)}s` } as React.CSSProperties) : undefined}
            />
          );
        })}
      </div>
      <span className="md-scan" />
      <span className="absolute bottom-0.5 right-1 num-tabular text-[9px] font-semibold text-terra">~84ms · 100만 행</span>
    </div>
  );
}

// ④ 인사이트 — 반응도 미니 막대 차트가 차오름
const INSIGHT_BARS = [
  { h: 58, strong: false },
  { h: 88, strong: true },
  { h: 72, strong: true },
  { h: 44, strong: false },
  { h: 64, strong: false },
];
function DemoInsight() {
  return (
    <div className="demo-insight relative flex h-full items-end gap-[7px] px-1 pb-1">
      {INSIGHT_BARS.map((b, i) => (
        <span
          key={i}
          className={b.strong ? "bar bar-strong" : "bar"}
          style={{ "--h": `${b.h}%`, "--d": `${(0.3 + i * 0.2).toFixed(2)}s` } as React.CSSProperties}
        />
      ))}
      <span className="absolute right-1 top-0.5 text-[9px] font-semibold text-terra">반응도 ↑</span>
    </div>
  );
}

/* ---- 기능 카드 단계별 라이브 미니 데모 ----
 * PIPELINE 데모와 동일하게 카드 reveal 게이팅 + CSS 애니메이션만 사용. 6개가 동시에 격렬하지
 * 않도록 대부분 1회 재생 후 정지(지도 핫스팟 펄스만 은은한 루프). PIPELINE과 비주얼이 겹치지
 * 않게 차별화: 분석=스캔, A/B=막대 경쟁, 탐색=아바타, 설문=가로바, 현황=도넛, 지도=핫스팟.
 */
function FeatureDemo({ type }: { type: "analyze" | "abtest" | "explore" | "survey" | "overview" | "map" }) {
  return (
    <div className="feature-demo relative mt-4 h-[84px] overflow-hidden rounded-[10px] border border-parchment bg-snow/70 px-3 py-2.5">
      {type === "analyze" && <DemoAnalyze />}
      {type === "abtest" && <DemoABTest />}
      {type === "explore" && <DemoExplore />}
      {type === "survey" && <DemoSurvey />}
      {type === "overview" && <DemoOverview />}
      {type === "map" && <DemoMap />}
    </div>
  );
}

// ① 약관·상품 분석 — 문서 라인 위로 스캔 밴드가 1회 훑고, 소구점 칩이 pop
function DemoAnalyze() {
  return (
    <div className="dm-analyze relative flex h-full flex-col justify-center gap-1.5">
      <span className="block h-[5px] w-full rounded-full bg-stone/20" />
      <span className="block h-[5px] w-11/12 rounded-full bg-stone/20" />
      <span className="block h-[5px] w-2/3 rounded-full bg-stone/20" />
      <span className="kw mt-0.5 w-fit rounded border border-terra/30 bg-terra/10 px-1.5 py-[2px] text-[9px] font-semibold text-terra">소구점 추출</span>
      <span className="sweep" />
    </div>
  );
}

// ② A/B 테스트 — A(marine)·B(terra) 막대가 차오르며 경쟁(B 우위)
function DemoABTest() {
  return (
    <div className="dm-abtest relative flex h-full items-stretch justify-center gap-3">
      <div className="flex flex-col items-center justify-end pb-1">
        <span className="ab-bar bg-marine/80" style={{ "--h": "30px", "--d": "0.3s" } as React.CSSProperties} />
        <span className="mt-1 text-[9px] font-semibold text-marine">A</span>
      </div>
      <span className="self-center text-[9px] font-bold text-dusty">VS</span>
      <div className="flex flex-col items-center justify-end pb-1">
        <span className="ab-bar bg-terra" style={{ "--h": "46px", "--d": "0.45s" } as React.CSSProperties} />
        <span className="mt-1 text-[9px] font-semibold text-terra">B</span>
      </div>
    </div>
  );
}

// ③ 페르소나 탐색 — 검색바 + 후보 아바타가 순차 pop-in
const EXPLORE_AV = ["bg-terra/70", "bg-marine/60", "bg-terra/50", "bg-azure", "bg-terra/35"];
function DemoExplore() {
  return (
    <div className="dm-explore relative flex h-full flex-col justify-center gap-2.5">
      <span className="flex items-center gap-1.5 rounded-full border border-parchment bg-vellum px-2 py-1">
        <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-terra" />
        <span className="text-[9px] text-dusty">40대 · 자녀 둘 · 수도권</span>
      </span>
      <div className="flex items-center gap-1.5">
        {EXPLORE_AV.map((c, i) => (
          <span key={i} className={`av h-5 w-5 rounded-full ${c}`} style={{ "--d": `${(0.5 + i * 0.13).toFixed(2)}s` } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
}

// ④ 가상 설문 — 긍/중/부정 응답 가로 바가 좌→우로 채워짐
const SURVEY_ROWS = [
  { label: "긍정", w: "68%", cls: "bg-terra", d: "0.35s" },
  { label: "중립", w: "44%", cls: "bg-azure", d: "0.5s" },
  { label: "부정", w: "24%", cls: "bg-stone/45", d: "0.65s" },
];
function DemoSurvey() {
  return (
    <div className="dm-survey relative flex h-full flex-col justify-center gap-[7px]">
      {SURVEY_ROWS.map((r) => (
        <div key={r.label} className="flex items-center gap-1.5">
          <span className="w-6 shrink-0 text-[9px] text-graphite">{r.label}</span>
          <span className="relative h-[6px] flex-1 overflow-hidden rounded-full bg-stone/12">
            <span className={`fill absolute inset-y-0 left-0 rounded-full ${r.cls}`} style={{ "--w": r.w, "--d": r.d } as React.CSSProperties} />
          </span>
        </div>
      ))}
    </div>
  );
}

// ⑤ 데이터 현황 — 도넛 게이지가 그려지며 시군구 수 표시
function DemoOverview() {
  return (
    <div className="dm-overview relative flex h-full items-center justify-center gap-3">
      <svg viewBox="0 0 40 40" className="h-[52px] w-[52px] -rotate-90">
        <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="4" className="text-parchment" />
        <circle cx="20" cy="20" r="16" fill="none" stroke="#d97757" strokeWidth="4" strokeLinecap="round" className="ring" />
      </svg>
      <div className="leading-tight">
        <p className="num-tabular text-[1.05rem] font-bold text-ink">252</p>
        <p className="text-[9px] text-dusty">공략 시군구</p>
      </div>
    </div>
  );
}

// ⑥ 공략 지역 지도 — 지역 점 배경 위 핫스팟이 드롭되고 은은하게 펄스
const MAP_PINS = [
  { x: "32%", y: "30%", d: "0.4s" },
  { x: "62%", y: "44%", d: "0.6s" },
  { x: "46%", y: "66%", d: "0.8s" },
];
function DemoMap() {
  return (
    <div className="dm-map relative h-full">
      <span className="map-grid absolute inset-0" />
      {MAP_PINS.map((p, i) => (
        <span key={i} className="pin absolute" style={{ left: p.x, top: p.y, "--d": p.d } as React.CSSProperties}>
          <span className="pin-ring" />
          <span className="pin-core" />
        </span>
      ))}
      <span className="absolute bottom-0.5 right-1 text-[9px] font-semibold text-terra">반응 집중</span>
    </div>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="relative bg-snow border-y border-parchment py-24 sm:py-32 px-4 sm:px-6 lg:px-8 scroll-mt-20">
      <div className="max-w-[1200px] mx-auto">
        <header className="text-center max-w-2xl mx-auto">
          <SectionHeading
            eyebrow="How it works"
            title="입력 한 줄에서 인사이트까지, 네 단계"
            subtitle="데이터를 직접 모으지 않아도, 이미 준비된 100만 합성 페르소나가 당신의 상품을 평가합니다."
          />
        </header>

        <ol className="relative mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <span aria-hidden className="hidden lg:block pipeline-rail absolute top-[3.75rem] left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-parchment via-terra/50 to-parchment">
            <span className="rail-dot absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-terra shadow-[0_0_10px_rgba(217,119,87,0.8)]" />
          </span>
          {PIPELINE.map((p, i) => (
            <li key={p.step} data-reveal onMouseMove={trackSpotlight} className="reveal spotlight gborder group relative overflow-hidden rounded-[14px] border border-parchment bg-vellum p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-2 hover:shadow-[0_22px_48px_-22px_rgba(20,20,19,0.3)]" style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="relative flex items-center justify-between">
                <IconBadge>{p.icon}</IconBadge>
                <span className="step-num text-[2.75rem] num-tabular font-bold leading-none">{p.step}</span>
              </div>
              <h3 className="relative mt-5 text-title text-ink">{p.title}</h3>
              <p className="relative mt-2 text-body-sm text-graphite leading-relaxed">{p.desc}</p>
              <PipelineDemo type={p.demo} />
              <p className="relative mt-4 text-caption text-dusty border-t border-parchment pt-3">{p.meta}</p>
            </li>
          ))}
        </ol>

        <div className="mt-24 text-center max-w-2xl mx-auto">
          <SectionHeading
            eyebrow="한 화면에 담긴 기능"
            title="기획부터 마케팅까지, 6가지 도구"
            subtitle="분석·A/B 테스트·페르소나 탐색·가상 설문을 한 곳에서 이어서 진행합니다."
          />
        </div>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <article key={f.title} data-reveal onMouseMove={trackSpotlight} className="reveal spotlight gborder group relative overflow-hidden rounded-[14px] border border-parchment bg-vellum p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-1.5 hover:shadow-[0_18px_40px_-22px_rgba(20,20,19,0.3)]" style={{ transitionDelay: `${i * 65}ms` }}>
              <div className="relative">
                <IconBadge>{f.icon}</IconBadge>
                <h3 className="mt-5 text-heading text-ink">{f.title}</h3>
                <p className="mt-2 text-body-sm text-graphite leading-relaxed">{f.desc}</p>
              </div>
              <FeatureDemo type={f.demo} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * ③ 데이터 규모 + 최종 CTA
 * ============================================================ */
const STATS = [
  { value: 1_000_000, suffix: "", label: "합성 한국인 페르소나", note: "행 단위 인메모리" },
  { value: 84, suffix: "ms", label: "100만 행 전수 검색", note: "brute-force 코사인" },
  { value: 252, suffix: "개", label: "시군구 공략 지역", note: "17개 시도 / 252 구·군" },
  { value: 26, suffix: "컬럼", label: "페르소나 속성", note: "인물 7종 + 인구통계" },
];
const TAGS = ["약관 분석", "A/B 테스트", "페르소나 탐색", "가상 설문", "데이터 현황", "분석 이력", "페르소나 의견", "FP 판매 전략", "공략 지역 지도"];

function ScaleSection() {
  return (
    <section className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8">
      <div className="max-w-[1200px] mx-auto">
        <header className="text-center max-w-2xl mx-auto">
          <SectionHeading
            eyebrow="By the numbers"
            title="규모가 곧 정밀함입니다"
            subtitle="100만 행을 ~84ms에 전수 검색합니다. 표본이 아니라 모집단 전체가 답합니다."
          />
        </header>

        <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {STATS.map((s, i) => (
            <div key={s.label} data-reveal onMouseMove={trackSpotlight} className="reveal spotlight gborder group relative overflow-hidden rounded-[14px] border border-parchment bg-snow p-6 text-center transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_-22px_rgba(20,20,19,0.3)]" style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="relative">
                <CountUp value={s.value} suffix={s.suffix} />
                <p className="mt-2 text-body-sm font-semibold text-ink">{s.label}</p>
                <p className="mt-1 text-caption text-dusty">{s.note}</p>
              </div>
            </div>
          ))}
        </div>

        <div data-reveal className="reveal mt-14 flex flex-wrap justify-center gap-2.5">
          {TAGS.map((t) => (
            <span key={t} className="rounded-full border border-parchment bg-vellum px-4 py-1.5 text-body-sm text-graphite transition-[color,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-terra/40 hover:text-ink">{t}</span>
          ))}
        </div>

        <div data-reveal className="reveal relative mt-20 overflow-hidden rounded-[16px] border border-onyx/40 bg-onyx text-vellum px-6 py-14 sm:px-12 sm:py-16 text-center">
          <div aria-hidden className="aurora-dark absolute inset-0 opacity-90" />
          <span aria-hidden className="blob absolute -top-20 -right-10 h-64 w-64 rounded-full bg-terra/30 blur-[70px]" />
          <span aria-hidden className="blob absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-azure/20 blur-[80px]" style={{ animationDelay: "3s" }} />
          <div className="relative">
            {/* 밝은 vellum 배지 위에 로고 — 다크 배경 대비 확보 */}
            <span className="relative inline-grid place-items-center h-[68px] w-[68px]">
              <span aria-hidden className="badge-ring always absolute inset-[-3px] rounded-[20px]" />
              <span className="relative grid place-items-center h-[68px] w-[68px] rounded-[18px] bg-vellum border border-parchment shadow-[0_10px_28px_-10px_rgba(0,0,0,0.6)]">
                <Image src="/personafit-terra.png" alt="" width={48} height={48} className="h-12 w-12 rounded-[12px]" />
              </span>
            </span>
            <h2 className="mt-6 text-[1.75rem] sm:text-[2.25rem] font-bold tracking-[-0.02em] text-balance">
              지금, 당신의 상품을 100만 명에게 물어보세요
            </h2>
            <p className="mt-1 mx-auto max-w-xl text-body text-stone">
              약관 한 장, 카피 한 줄로 반응 타겟과 공략 지역을 몇 초 만에 확인하세요.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <CtaButton href="/analyze" variant="primary">상품 분석 시작하기<ArrowIcon /></CtaButton>
              <CtaButton href="/overview" variant="onDark">데이터 현황 보기</CtaButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * 공용 컴포넌트
 * ============================================================ */
/**
 * 섹션 헤더 위계 통일 — eyebrow(overline 12px) → title(H2) → subtitle(body).
 * 세 섹션이 동일 크기·간격·색을 공유해 위계가 흔들리지 않도록 한 곳에서 관리.
 */
function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <>
      <p data-reveal className="reveal text-overline text-terra">{eyebrow}</p>
      <h2
        data-reveal
        className="reveal mt-2 text-[2rem] sm:text-[2.5rem] leading-[1.12] font-bold tracking-[-0.025em] text-ink text-balance"
        style={{ transitionDelay: "60ms" } as React.CSSProperties}
      >
        {title}
      </h2>
      {subtitle ? (
        <p
          data-reveal
          className="reveal mt-1 text-body sm:text-[1.0625rem] text-graphite leading-relaxed"
          style={{ transitionDelay: "120ms" } as React.CSSProperties}
        >
          {subtitle}
        </p>
      ) : null}
    </>
  );
}

function IconBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-grid place-items-center h-14 w-14">
      <span aria-hidden className="badge-ring absolute inset-[-2px] rounded-[14px]" />
      <span className="icon-face relative grid place-items-center h-14 w-14 rounded-[14px] border border-parchment text-terra transition-transform duration-300 group-hover:scale-[1.07] motion-reduce:group-hover:scale-100">
        {children}
      </span>
    </span>
  );
}

function CtaButton({ href, variant, children }: { href: string; variant: "primary" | "ghost" | "onDark"; children: React.ReactNode }) {
  const base = "group/btn shine relative inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-[12px] text-body font-semibold transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-azure active:scale-[0.98] motion-reduce:active:scale-100";
  const styles = {
    primary: "btn-primary text-snow hover:-translate-y-0.5 shadow-[0_10px_24px_-10px_rgba(217,119,87,0.7)] hover:shadow-[0_16px_34px_-10px_rgba(184,85,53,0.85)] focus-visible:ring-offset-vellum motion-reduce:hover:translate-y-0",
    ghost: "border border-stone/50 bg-snow/70 text-ink backdrop-blur hover:-translate-y-0.5 hover:border-terra/50 hover:bg-snow focus-visible:ring-offset-vellum motion-reduce:hover:translate-y-0",
    onDark: "border border-vellum/30 text-vellum hover:-translate-y-0.5 hover:bg-vellum/10 focus-visible:ring-offset-onyx motion-reduce:hover:translate-y-0",
  }[variant];
  return (
    <Link href={href} className={`${base} ${styles}`}>
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </Link>
  );
}

function CountUp({
  value,
  suffix,
  className = "stat-num text-[clamp(1.125rem,5vw,2.5rem)] font-bold num-tabular leading-none",
  suffixClassName = "text-[1.25rem] sm:text-[1.5rem] text-graphite ml-0.5",
}: {
  value: number;
  suffix: string;
  className?: string;
  suffixClassName?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setDisplay(value);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setDisplay(value);
      return;
    }
    let raf = 0;
    let start = 0;
    const DURATION = 1500;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const run = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / DURATION, 1);
      setDisplay(Math.round(value * ease(p)));
      if (p < 1) raf = requestAnimationFrame(run);
    };
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        raf = requestAnimationFrame(run);
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [value]);
  return (
    <p ref={ref} className={className}>
      {display.toLocaleString("ko-KR")}
      <span className={suffixClassName}>{suffix}</span>
    </p>
  );
}

function trackSpotlight(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
}

function useRevealRoot() {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return rootRef;
}

/* ============================================================
 * 듀오톤 아이콘
 * ============================================================ */
const S = { viewBox: "0 0 24 24", className: "w-[26px] h-[26px]", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const STROKE = "url(#ic-terra)";

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px] transition-transform duration-200 group-hover/btn:translate-x-1 motion-reduce:group-hover/btn:translate-x-0">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function IconUpload() {
  return <svg {...S} fill="none"><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="rgba(204,219,232,0.35)" stroke={STROKE} /><path d="M12 16V4" stroke={STROKE} /><path d="M7.5 8.5 12 4l4.5 4.5" stroke={STROKE} /></svg>;
}
function IconSpark() {
  return <svg {...S} fill="none"><path d="M13 3 5 13h6l-1 8 8-11h-6l1-7Z" fill="rgba(217,119,87,0.18)" stroke={STROKE} /></svg>;
}
function IconScan() {
  return <svg {...S} fill="none"><rect x="4" y="4" width="16" height="16" rx="3" fill="rgba(204,219,232,0.3)" stroke={STROKE} /><path d="M4 12h16" stroke={STROKE} /><circle cx="8.5" cy="8" r="1" fill="#d97757" stroke="none" /><circle cx="12" cy="16" r="1" fill="#d97757" stroke="none" /><circle cx="15.5" cy="8" r="1" fill="#d97757" stroke="none" /></svg>;
}
function IconInsight() {
  return <svg {...S} fill="none"><path d="M4 20V4" stroke={STROKE} /><path d="M4 20h16" stroke={STROKE} /><path d="M7 16l3.5-4 3 2L20 7" stroke={STROKE} /><path d="M20 7v3.5M20 7h-3.5" stroke={STROKE} /><circle cx="10.5" cy="12" r="1" fill="#d97757" stroke="none" /></svg>;
}
function IconAnalyze() {
  return <svg {...S} fill="none"><circle cx="11" cy="11" r="7" fill="rgba(217,119,87,0.14)" stroke={STROKE} /><path d="M21 21l-4.3-4.3" stroke={STROKE} /><path d="M8 11h6M11 8v6" stroke={STROKE} /></svg>;
}
function IconABTest() {
  return <svg {...S} fill="none"><rect x="3" y="5" width="8" height="14" rx="2" fill="rgba(217,119,87,0.16)" stroke={STROKE} /><rect x="13" y="5" width="8" height="14" rx="2" fill="rgba(204,219,232,0.4)" stroke={STROKE} /><path d="M6 12h2.5M15.5 12H18" stroke={STROKE} /></svg>;
}
function IconUsers() {
  return <svg {...S} fill="none"><circle cx="9" cy="7" r="3.4" fill="rgba(217,119,87,0.16)" stroke={STROKE} /><path d="M15.5 10.2A3.4 3.4 0 1 0 15 3.6" stroke={STROKE} /><path d="M3 20v-1.5A4 4 0 0 1 7 14.5h4a4 4 0 0 1 4 4V20" fill="rgba(204,219,232,0.3)" stroke={STROKE} /><path d="M17.5 14.7A4 4 0 0 1 21 18.6V20" stroke={STROKE} /></svg>;
}
function IconSurvey() {
  return <svg {...S} fill="none"><path d="M8 4h9a2 2 0 0 1 2 2v13l-3.5-2-3.5 2-3.5-2L5 21V6a2 2 0 0 1 2-2z" fill="rgba(217,119,87,0.14)" stroke={STROKE} /><path d="M9 9h6M9 13h4" stroke={STROKE} /></svg>;
}
function IconOverview() {
  return <svg {...S} fill="none"><path d="M4 20V4" stroke={STROKE} /><path d="M4 20h16" stroke={STROKE} /><rect x="7" y="12" width="2.4" height="5" rx="0.6" fill="rgba(217,119,87,0.5)" stroke={STROKE} /><rect x="11" y="8" width="2.4" height="9" rx="0.6" fill="rgba(217,119,87,0.32)" stroke={STROKE} /><rect x="15" y="10" width="2.4" height="7" rx="0.6" fill="rgba(204,219,232,0.55)" stroke={STROKE} /></svg>;
}
function IconMap() {
  return <svg {...S} fill="none"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" fill="rgba(204,219,232,0.32)" stroke={STROKE} /><path d="M9 4v14M15 6v14" stroke={STROKE} /><circle cx="12" cy="11" r="1.6" fill="#d97757" stroke="none" /></svg>;
}

/* ============================================================
 * intro 전용 스타일
 * ============================================================ */
const introStyles = `
  .hero-line { opacity: 0; transform: translateY(16px); animation: intro-rise 0.7s cubic-bezier(0.16,1,0.3,1) forwards; animation-delay: calc(var(--i,0)*100ms + 80ms); }
  @keyframes intro-rise { to { opacity: 1; transform: translateY(0); } }

  .hero-gradient { background-image: linear-gradient(105deg, #f2c9b8, #d97757 30%, #b85535 60%, #141413 95%); background-size: 220% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: intro-pan 7s ease-in-out infinite; }
  @keyframes intro-pan { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
  .stat-num { background-image: linear-gradient(120deg, #d97757, #b85535); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .step-num { background-image: linear-gradient(160deg, #dedcd1, rgba(217,119,87,0.35)); -webkit-background-clip: text; background-clip: text; color: transparent; transition: background-image 0.3s; }
  .group:hover .step-num { background-image: linear-gradient(160deg, rgba(217,119,87,0.6), #b85535); }
  .btn-primary { background-image: linear-gradient(135deg, #e0875f, #d97757 45%, #b85535); }

  /* Aurora */
  .aurora {
    background:
      radial-gradient(40% 50% at 16% 26%, rgba(217,119,87,0.20), transparent 70%),
      radial-gradient(42% 55% at 84% 22%, rgba(204,219,232,0.5), transparent 72%),
      radial-gradient(50% 50% at 50% 92%, rgba(184,85,53,0.10), transparent 70%);
    background-size: 200% 200%; animation: aurora-flow 16s ease-in-out infinite;
  }
  .aurora-dark {
    background:
      radial-gradient(45% 55% at 20% 25%, rgba(217,119,87,0.32), transparent 70%),
      radial-gradient(40% 50% at 80% 30%, rgba(204,219,232,0.18), transparent 72%),
      radial-gradient(55% 50% at 55% 90%, rgba(184,85,53,0.18), transparent 72%);
    background-size: 200% 200%; animation: aurora-flow 18s ease-in-out infinite;
  }
  @keyframes aurora-flow { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }

  .blob { animation: intro-float 14s ease-in-out infinite; will-change: transform; }
  @keyframes intro-float { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(22px,-26px) scale(1.06); } 66% { transform: translate(-18px,16px) scale(0.96); } }

  .pulse-dot { position: relative; }
  .pulse-dot::after { content: ""; position: absolute; inset: 0; border-radius: 9999px; background: inherit; animation: intro-ping 1.8s cubic-bezier(0,0,0.2,1) infinite; }
  @keyframes intro-ping { 0% { transform: scale(1); opacity: 0.7; } 75%,100% { transform: scale(2.6); opacity: 0; } }

  /* ---------- Hero 전체 배경 점 필드 ---------- */
  .hero-dots {
    background-image: radial-gradient(circle, rgba(156,154,146,0.32) 1.5px, transparent 1.6px);
    background-size: 30px 30px;
    mask-image: radial-gradient(ellipse 95% 85% at 50% 38%, #000 60%, transparent 96%);
    -webkit-mask-image: radial-gradient(ellipse 95% 85% at 50% 38%, #000 60%, transparent 96%);
  }
  /* 매칭 점 — 스캔바와 동기. 평소 차분한 terra, 스캔 통과 순간 밝은 peach로 확대 */
  .hero-match {
    position: absolute; width: 8px; height: 8px; border-radius: 9999px; margin: -4px 0 0 -4px;
    background-color: #d97757; box-shadow: 0 0 6px rgba(217,119,87,0.55);
    animation: match-scan 3.2s linear infinite; animation-delay: var(--ds, 0s);
  }
  .hero-match-strong { width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; }
  @keyframes match-scan {
    0%   { transform: scale(0.82); opacity: 0.5; background-color: #d97757; box-shadow: 0 0 5px rgba(217,119,87,0.45); }
    7%   { transform: scale(1.75); opacity: 1; background-color: #f2c9b8; box-shadow: 0 0 18px rgba(242,201,184,0.95); }
    24%  { transform: scale(1.05); opacity: 0.82; background-color: #d97757; box-shadow: 0 0 8px rgba(217,119,87,0.7); }
    100% { transform: scale(0.82); opacity: 0.5; background-color: #d97757; box-shadow: 0 0 5px rgba(217,119,87,0.45); }
  }
  .hero-scan {
    left: -25%;
    background: linear-gradient(90deg, transparent, rgba(217,119,87,0.12) 45%, rgba(217,119,87,0.20) 50%, rgba(217,119,87,0.12) 55%, transparent);
    animation: hero-scan-move 3.2s linear infinite;
  }
  @keyframes hero-scan-move { 0% { left: -25%; } 100% { left: 100%; } }

  /* 아이콘 배지 */
  .icon-face { background: radial-gradient(120% 120% at 30% 18%, rgba(255,255,255,0.92), transparent 55%), linear-gradient(160deg, rgba(217,119,87,0.18), rgba(204,219,232,0.34)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.6), 0 6px 16px -10px rgba(20,20,19,0.4); }
  .badge-ring { background: linear-gradient(135deg, rgba(217,119,87,0.85), rgba(204,219,232,0.7) 55%, rgba(184,85,53,0.6)); opacity: 0; transition: opacity 0.35s ease; filter: blur(0.4px); }
  .group:hover .badge-ring { opacity: 1; }
  .badge-ring.always { opacity: 0.9; }

  .spotlight::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: radial-gradient(240px circle at var(--mx,50%) var(--my,50%), rgba(217,119,87,0.14), transparent 60%); opacity: 0; transition: opacity 0.3s; z-index: 0; }
  .spotlight:hover::before { opacity: 1; }

  .gborder::after { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none; background: linear-gradient(135deg, rgba(217,119,87,0.7), rgba(204,219,232,0.6)); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; opacity: 0; transition: opacity 0.3s; z-index: 1; }
  .gborder:hover::after { opacity: 1; }

  .shine { overflow: hidden; }
  .shine::after { content: ""; position: absolute; top: 0; bottom: 0; left: -150%; width: 55%; transform: skewX(-20deg); background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent); pointer-events: none; }
  .shine:hover::after { animation: intro-shine 0.9s ease; }
  @keyframes intro-shine { to { left: 160%; } }

  .pipeline-rail { transform-origin: left center; animation: intro-rail 1.1s cubic-bezier(0.16,1,0.3,1) 0.3s both; }
  @keyframes intro-rail { from { transform: scaleX(0); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }
  /* 점은 라인과 동일한 delay/duration/easing으로 left 0→100% 이동 → 라인이 그려지는 끝을 펜촉처럼 따라간다. */
  .rail-dot { animation: intro-rail-run 1.1s cubic-bezier(0.16,1,0.3,1) 0.3s both; }
  @keyframes intro-rail-run { 0% { left: 0%; opacity: 0; } 8% { opacity: 1; } 100% { left: 100%; opacity: 1; } }

  .scroll-cue { animation: intro-fade-late 0.6s ease-out 1.2s both; }
  .scroll-dot { animation: intro-scroll-dot 1.8s ease-in-out infinite; }
  @keyframes intro-fade-late { from { opacity: 0; } to { opacity: 1; } }
  @keyframes intro-scroll-dot { 0% { transform: translate(-50%,0); opacity: 1; } 70% { transform: translate(-50%,14px); opacity: 0; } 100% { transform: translate(-50%,0); opacity: 0; } }

  .reveal { opacity: 0; transform: translateY(28px); transition: opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1); }
  .reveal.is-visible { opacity: 1; transform: none; }

  /* ---------- 파이프라인 단계별 라이브 미니 데모 ---------- */
  /* 카드가 reveal로 보일 때(.is-visible) 데모가 재생. 진입 전엔 카드가 opacity:0이라 정지 상태는 비노출 */

  /* ① 입력: 문서명이 좌→우로 타이핑(clip-path)되고, 커서는 텍스트(.pdf) 끝에 붙어 타이핑 후 깜빡 */
  .demo-input .typing { white-space: nowrap; overflow: hidden; border-right: 1.5px solid #d97757; }
  .demo-input .ghost, .demo-input .file-chip { opacity: 0; }
  /* dm-type(타이핑) → 끝나는 1.7s 시점부터 dm-caret(깜빡) 무한 */
  .reveal.is-visible .demo-input .typing { animation: dm-type 1.4s steps(20,end) 0.3s both, dm-caret 0.8s step-end 1.7s infinite; }
  .reveal.is-visible .demo-input .ghost { animation: dm-fade 0.4s ease-out var(--d,0s) both; }
  .reveal.is-visible .demo-input .file-chip { animation: dm-pop 0.5s cubic-bezier(0.2,1.5,0.4,1) var(--d,0s) both; }
  @keyframes dm-type { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
  @keyframes dm-caret { 50% { border-color: transparent; } }
  @keyframes dm-fade { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; transform: none; } }

  /* ② 추출: 칩 stagger pop-in */
  .demo-extract .chip { opacity: 0; transform: scale(0.6); }
  .reveal.is-visible .demo-extract .chip { animation: dm-pop 0.5s cubic-bezier(0.2,1.5,0.4,1) var(--d,0s) both; }
  @keyframes dm-pop { to { opacity: 1; transform: scale(1); } }

  /* ③ 매칭: 점 그리드 + 스캔 웨이브 + 좌→우 점등 */
  .demo-match .md-dot { width: 4px; height: 4px; border-radius: 9999px; background: rgba(156,154,146,0.3); justify-self: center; }
  .demo-match .md-on { background: #d97757; }
  .reveal.is-visible .demo-match .md-on { animation: dm-blink 2.6s ease-in-out var(--d,0s) infinite; }
  .demo-match .md-scan { position: absolute; top: 0; bottom: 0; width: 22%; left: -25%; pointer-events: none; background: linear-gradient(90deg, transparent, rgba(217,119,87,0.18) 50%, transparent); }
  .reveal.is-visible .demo-match .md-scan { animation: dm-scan 2.6s linear 0.3s infinite; }
  @keyframes dm-blink {
    0%, 100% { transform: scale(1); background: #d97757; box-shadow: 0 0 0 rgba(217,119,87,0); }
    12% { transform: scale(1.7); background: #f2c9b8; box-shadow: 0 0 8px rgba(242,201,184,0.9); }
    34% { transform: scale(1.05); background: #d97757; box-shadow: 0 0 4px rgba(217,119,87,0.6); }
  }
  @keyframes dm-scan { to { left: 100%; } }

  /* ④ 인사이트: 반응도 막대가 또렷한 간격으로 순차 솟아오름(overshoot 탄력) */
  .demo-insight .bar { flex: 1; height: 0; min-width: 0; opacity: 0; border-radius: 4px 4px 0 0; background: linear-gradient(180deg, rgba(217,119,87,0.45), rgba(184,85,53,0.4)); }
  .demo-insight .bar-strong { background: linear-gradient(180deg, #e0875f, #b85535); }
  .reveal.is-visible .demo-insight .bar { animation: dm-grow 0.7s cubic-bezier(0.34,1.45,0.5,1) var(--d,0s) both; }
  @keyframes dm-grow { from { height: 0; opacity: 0.25; } to { height: var(--h); opacity: 1; } }

  /* ---------- 기능 카드 6종 라이브 미니 데모 ---------- */
  /* ① 분석: 스캔 밴드 1회 스윕 + 소구점 칩 pop */
  .dm-analyze .sweep { position: absolute; top: 0; bottom: 0; left: -32%; width: 32%; pointer-events: none; background: linear-gradient(90deg, transparent, rgba(217,119,87,0.22) 50%, transparent); }
  .dm-analyze .kw { opacity: 0; }
  .reveal.is-visible .dm-analyze .sweep { animation: dm-sweep 1.3s ease-in-out 0.3s 1 forwards; }
  .reveal.is-visible .dm-analyze .kw { animation: dm-pop 0.5s cubic-bezier(0.2,1.5,0.4,1) 1.25s both; }
  @keyframes dm-sweep { from { left: -32%; } to { left: 100%; } }

  /* ② A/B: 막대 차오름(dm-grow 공유, px 높이) */
  .dm-abtest .ab-bar { width: 14px; height: 0; opacity: 0; border-radius: 4px 4px 0 0; }
  .reveal.is-visible .dm-abtest .ab-bar { animation: dm-grow 0.8s cubic-bezier(0.34,1.4,0.5,1) var(--d,0s) both; }

  /* ③ 탐색: 아바타 stagger pop-in(dm-pop 공유) */
  .dm-explore .av { opacity: 0; transform: scale(0.5); }
  .reveal.is-visible .dm-explore .av { animation: dm-pop 0.5s cubic-bezier(0.2,1.5,0.4,1) var(--d,0s) both; }

  /* ④ 설문: 가로 응답 바 좌→우 채움 */
  .dm-survey .fill { width: 0; }
  .reveal.is-visible .dm-survey .fill { animation: dm-fill 0.9s cubic-bezier(0.3,1,0.4,1) var(--d,0s) both; }
  @keyframes dm-fill { from { width: 0; } to { width: var(--w); } }

  /* ⑤ 현황: 도넛 게이지 stroke 그리기 (둘레 2π·16 ≈ 100.5, ~70% 채움) */
  .dm-overview .ring { stroke-dasharray: 100.5; stroke-dashoffset: 100.5; }
  .reveal.is-visible .dm-overview .ring { animation: dm-ring 1.1s cubic-bezier(0.3,1,0.4,1) 0.35s forwards; }
  @keyframes dm-ring { to { stroke-dashoffset: 30; } }

  /* ⑥ 지도: 지역 점 배경 + 핫스팟 드롭 후 은은한 펄스(유일한 무한 루프) */
  .dm-map .map-grid { background-image: radial-gradient(circle, rgba(156,154,146,0.28) 1px, transparent 1.3px); background-size: 12px 12px; mask-image: radial-gradient(ellipse 70% 78% at 50% 50%, #000 52%, transparent 86%); -webkit-mask-image: radial-gradient(ellipse 70% 78% at 50% 50%, #000 52%, transparent 86%); }
  .dm-map .pin { opacity: 0; }
  .dm-map .pin-core { position: absolute; left: 0; top: 0; width: 7px; height: 7px; margin: -3.5px; border-radius: 9999px; background: #d97757; box-shadow: 0 0 7px rgba(217,119,87,0.7); }
  .dm-map .pin-ring { position: absolute; left: 0; top: 0; width: 7px; height: 7px; margin: -3.5px; border-radius: 9999px; border: 1.5px solid rgba(217,119,87,0.7); transform: scale(1); }
  .reveal.is-visible .dm-map .pin { animation: dm-pin 0.5s cubic-bezier(0.2,1.5,0.4,1) var(--d,0s) both; }
  .reveal.is-visible .dm-map .pin-ring { animation: dm-pulse 2.6s ease-out calc(var(--d,0s) + 0.6s) infinite; }
  @keyframes dm-pin { from { opacity: 0; transform: translateY(-7px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes dm-pulse { 0% { transform: scale(1); opacity: 0.75; } 80%, 100% { transform: scale(2.8); opacity: 0; } }

  @media (prefers-reduced-motion: reduce) {
    .hero-line, .hero-gradient, .aurora, .aurora-dark, .blob, .pulse-dot::after, .pipeline-rail, .rail-dot,
    .scroll-cue, .scroll-dot, .shine::after, .hero-match, .hero-scan,
    .demo-input .typing, .demo-input .ghost, .demo-input .file-chip,
    .demo-extract .chip, .demo-match .md-on, .demo-match .md-scan, .demo-insight .bar,
    .dm-analyze .sweep, .dm-analyze .kw, .dm-abtest .ab-bar, .dm-explore .av,
    .dm-survey .fill, .dm-overview .ring, .dm-map .pin, .dm-map .pin-ring {
      animation: none !important;
    }
    .hero-line { opacity: 1 !important; transform: none !important; }
    .hero-gradient, .stat-num { -webkit-text-fill-color: #d97757; color: #d97757; }
    .hero-match { transform: none; }
    .reveal { transition: none !important; opacity: 1 !important; transform: none !important; }
    /* 데모는 최종 상태로 정적 표시 */
    .demo-input .typing { clip-path: none !important; border-right: 0 !important; }
    .demo-input .ghost, .demo-input .file-chip, .demo-extract .chip { opacity: 1 !important; transform: none !important; }
    .demo-insight .bar { height: var(--h) !important; opacity: 1 !important; }
    .demo-match .md-scan { display: none !important; }
    /* 기능 카드 데모 최종 상태 */
    .dm-analyze .kw, .dm-explore .av, .dm-map .pin { opacity: 1 !important; transform: none !important; }
    .dm-abtest .ab-bar { height: var(--h) !important; opacity: 1 !important; }
    .dm-survey .fill { width: var(--w) !important; }
    .dm-overview .ring { stroke-dashoffset: 30 !important; }
    .dm-analyze .sweep, .dm-map .pin-ring { display: none !important; }
  }
`;
