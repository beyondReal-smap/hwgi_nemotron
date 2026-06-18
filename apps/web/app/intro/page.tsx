"use client";

import Image from "next/image";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type MouseEvent } from "react";
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
 * v6 변경(대표님 피드백): Hero 좌→우 스캔을 시네마틱 레이더 스윕으로 고도화. 단일 terra 띠 →
 *   4중 레이어(수직 광주 → 패럴랙스 back빔 → comet trail → 빛의 칼날) + 매칭 점 튕김·warm 잔광·
 *   ring ping(strong 점 한정). left 애니 제거(transform:translateX 단일 변환 → 60fps). 칼날 core가
 *   화면 x%를 지나는 시점 ≈ (x/100)*3.2s = 점 --ds 로 맞춰 "칼날→점 점화" 동기 유지. 색은 terra
 *   스펙트럼(peach #f2c9b8 → terra → rust #b85535) 유지, azure는 칼날 가장자리 prismatic 보조만.
 *
 * v7 변경(대표님 피드백): Hero 시그니처를 좌→우 레이더 스윕 → **형상 응집 모핑**으로 교체.
 *   100만 점(150개)이 흩어짐 → 사람(군중) → 한국 지도 → 「1,000,000」 형상으로 응집·해체 순환.
 *   좌표는 heroShapes.ts에 빌드 타임 생성(한국 지도는 public/geo TopoJSON rejection sampling,
 *   결정적 → SSR/CSR 동일). container-type:size + transform:translate(cqw/cqh)로 반응형·GPU 합성
 *   (transform/opacity만 → 60fps). 4중 스윕·매칭 점·ring ping 제거(무한 루프 다이어트).
 *   reduced-motion에선 한국 지도 형상으로 정지.
 *
 * v8 변경(대표님 피드백): 형상 모핑 폐기 → **차분한 데이터 필드**로 교체. 점이 특정 형상(사람/
 *   한국지도/100만)을 흉내내면 중앙 카피에 가려 '제대로 된 형상'으로 안 읽히는 본질적 한계 때문.
 *   대신 160개 점이 형상 없이 은은히 떠다니며(느린 드리프트+미세 트윙클) '100만 규모'만 암시한다.
 *   좌표는 결정적 PRNG로 인라인 생성(heroShapes.ts·gen-hero-shapes.mjs 미사용). 동기화 라벨 제거,
 *   배경 캡션은 담백한 정적 1줄. 가독성 마스크는 헤드라인 우선으로 복원(0.72).
 *
 * v9 변경: 차분한 데이터 필드 유지 + 얇은 신호 연결선, 포인터 글로우, 네 개 오비트 노드, 카드 3D
 *   틸트, 뷰포트 진입 기반 파이프라인 레일로 모션 밀도만 보강.
 *
 * v10 변경(대표님 피드백 — 더 화려하게): ① 헤드라인 단어별 스태거(blur+rise 캐스케이드, 그라디언트
 *   단어별 적용) ② Hero 혜성 스트릭 2개(점 필드 위를 주기적으로 가로지름) ③ 스크롤 패럴랙스(배경
 *   느리게·카피 빠르게, @supports animation-timeline 게이트 — 미지원 브라우저 무동작) ④ 기능 태그
 *   마키 벨트 2줄(양방향, hover 정지, reduced-motion 시 정적 wrap) ⑤ 최종 CTA 회전 conic 보더 글로우
 *   ⑥ CTA 버튼 마그네틱(커서 쪽으로 내용물이 살짝 끌림). 전부 transform/opacity 합성(60fps).
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

// 차분한 데이터 필드 — 100만 규모를 암시하는 앰비언트 점.
// 형상을 만들지 않고 은은히 떠다니기만 한다(느린 드리프트 + 미세 트윙클).
// 위치/움직임은 결정적 PRNG(mulberry32)로 생성 → SSR/CSR 하이드레이션 일치(Math.random 금지).
const FIELD_DOTS = (() => {
  let a = 0x9e3779b9;
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 160 }, (_, i) => ({
    x: +(rnd() * 100).toFixed(2), // 위치 % (left/top)
    y: +(rnd() * 100).toFixed(2),
    sz: +(1.5 + rnd() * 2).toFixed(2), // 지름 px (1.5~3.5)
    dx: +((rnd() - 0.5) * 14).toFixed(1), // 드리프트 진폭 px (±7)
    dy: +((rnd() - 0.5) * 14).toFixed(1),
    dur: +(9 + rnd() * 8).toFixed(1), // 주기 s (9~17, 느리게)
    dl: +(-rnd() * 17).toFixed(1), // 시작 위상(음수 delay)로 desync
    op: +(0.16 + rnd() * 0.26).toFixed(2), // 기본 opacity (0.16~0.42, 차분)
    strong: i % 9 === 0, // 약 11%만 강조점(rust + 미세 글로우)
  }));
})();
const FIELD_LINKS = [
  [3, 21], [21, 47], [47, 86], [12, 39], [39, 74], [74, 118],
  [28, 64], [64, 109], [51, 97], [97, 142], [6, 58], [58, 132],
].map(([a, b], i) => ({
  x1: FIELD_DOTS[a].x,
  y1: FIELD_DOTS[a].y,
  x2: FIELD_DOTS[b].x,
  y2: FIELD_DOTS[b].y,
  d: `${(i * 0.24).toFixed(2)}s`,
}));
// 헤드라인 단어 배열 — 단어별 스태거 등장(--w 인덱스로 delay 계산).
const HEAD_TOP = ["100만", "한국인", "페르소나가"];
const HEAD_BOTTOM = ["당신의", "상품에", "먼저", "답합니다"];
const HERO_NODES = [
  { label: "원문 입력", x: "17%", y: "30%", d: "0s", dur: "8.4s", nx: "16px", ny: "-11px", nx2: "-8px", ny2: "9px", nr: "3deg", nr2: "-2deg" },
  { label: "핵심 소구", x: "78%", y: "25%", d: "0.9s", dur: "9.1s", nx: "-18px", ny: "13px", nx2: "10px", ny2: "-8px", nr: "-4deg", nr2: "2deg" },
  { label: "100만 매칭", x: "82%", y: "64%", d: "1.8s", dur: "8.8s", nx: "-15px", ny: "-15px", nx2: "9px", ny2: "11px", nr: "4deg", nr2: "-2deg" },
  { label: "전략 리포트", x: "20%", y: "69%", d: "2.7s", dur: "9.4s", nx: "18px", ny: "12px", nx2: "-10px", ny2: "-10px", nr: "-3deg", nr2: "2deg" },
];

function Hero() {
  return (
    <section onMouseMove={trackHeroPointer} className="hero-stage relative isolate min-h-[calc(100dvh-3.5rem)] sm:min-h-[calc(100dvh-4rem)] lg:min-h-[calc(100dvh-5rem)] flex items-center">
      <HeroBackdrop />

      <div className="hero-parallax-copy relative z-10 w-full max-w-[860px] mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <p className="hero-line inline-flex items-center gap-2 rounded-2xl sm:rounded-full border border-terra/30 bg-terra/8 px-4 py-1.5 text-overline text-graphite shadow-[0_0_0_4px_rgba(217,119,87,0.05)]" style={{ "--i": 0 } as React.CSSProperties}>
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terra shrink-0" />
          <span className="text-left leading-snug">
            AI 페르소나 타겟 분석
          </span>
        </p>

        {/* 단어별 스태거 — blur+rise 캐스케이드. 그라디언트는 단어 단위로 적용(분할 시 클리핑 안전). */}
        <h1 className="mt-6 text-balance text-[2.5rem] leading-[1.05] sm:text-[3.6rem] lg:text-[4.6rem] font-bold tracking-[-0.035em]">
          {HEAD_TOP.map((w, i) => (
            <Fragment key={w}>
              <span className="hero-word hero-word-grad" style={{ "--w": i } as React.CSSProperties}>{w}</span>{" "}
            </Fragment>
          ))}
          <br className="hidden sm:block" />
          {HEAD_BOTTOM.map((w, i) => (
            <Fragment key={w}>
              {i > 0 ? " " : null}
              <span className="hero-word" style={{ "--w": i + HEAD_TOP.length } as React.CSSProperties}>{w}</span>
            </Fragment>
          ))}
        </h1>

        <p className="hero-line mx-auto mt-6 max-w-[42rem] text-body sm:text-[1.125rem] text-graphite leading-relaxed" style={{ "--i": 2 } as React.CSSProperties}>
          상품설명서·약관·마케팅 카피·신상품 컨셉을 입력하면, 합성 한국인 100만 명과
          매칭해 <strong className="font-semibold text-ink">반응할 타겟·반응도·공략 지역·페르소나 의견·A/B 비교</strong>까지 한 번에.
        </p>

        <div className="hero-line mt-9 flex flex-col sm:flex-row items-center justify-center gap-3" style={{ "--i": 3 } as React.CSSProperties}>
          <CtaButton href="/overview" variant="primary">데이터 현황 보기<ArrowIcon /></CtaButton>
          <CtaButton href="/personas" variant="ghost">데이터 탐색하기</CtaButton>
        </div>

        {/* 인라인 미니 스탯 — 반투명 카드로 배경 점과 분리(가독성) */}
        <div className="hero-line mt-10 mx-auto w-fit max-w-full flex flex-col sm:flex-row items-center sm:items-stretch justify-center gap-y-3 gap-x-7 sm:gap-x-9 rounded-[16px] border border-parchment bg-snow/80 backdrop-blur-md px-6 sm:px-7 py-4 shadow-[0_14px_38px_-20px_rgba(20,20,19,0.35)]" style={{ "--i": 4 } as React.CSSProperties}>
          <MiniStat value={1_000_000} suffix="명" label="합성 페르소나 모집단" />
          <Divider />
          <MiniStat value={84} suffix="ms" label="100만 행 전수 검색" />
          <Divider />
          <MiniStat value={252} suffix="개" label="시군구 공략 지역" />
        </div>

        {/* Before/After — 마케터의 첫 질문("얼마나 빨라지고 얼마나 아끼나")에 첫 화면에서 답한다. */}
        <p className="hero-line mt-5 mx-auto flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-body-sm" style={{ "--i": 5 } as React.CSSProperties}>
          <span className="text-dusty">기존 소비자조사 2~6주 · 수백만~수천만 원</span>
          <span aria-hidden className="font-semibold text-terra">→</span>
          <span className="font-semibold text-ink">PersonaFit 약 2분 · 추가 조사비 0원</span>
          <span className="text-caption text-dusty">(업계 통상 기준 가늠치)</span>
        </p>
      </div>

      {/* 배경 데이터 필드 캡션 — 형상 없이 규모만 담백하게(회전·모핑 없음). */}
      <div aria-hidden className="hero-line absolute left-4 lg:left-8 bottom-5 hidden sm:flex items-center gap-2 text-caption text-graphite" style={{ "--i": 5 } as React.CSSProperties}>
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terra shrink-0" />
        <span>100만 명 규모의 합성 페르소나와 매칭해 예상 반응을 분석합니다.</span>
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
    <div aria-hidden className="hero-parallax-bg absolute inset-0 -z-10 overflow-hidden">
      <div className="aurora absolute inset-0" />
      <span className="blob absolute -top-24 -left-20 h-[34rem] w-[34rem] rounded-full bg-terra/12 blur-[90px]" />
      <span className="blob absolute top-1/3 -right-28 h-[30rem] w-[30rem] rounded-full bg-azure/50 blur-[90px]" style={{ animationDelay: "2.5s" }} />

      {/* 차분한 데이터 필드 — 100만 규모를 암시하는 앰비언트 점(형상 없음, 느린 드리프트+트윙클).
          left/top %로 배치, transform/opacity만 애니메이션(60fps). */}
      <div className="field absolute inset-0">
        {FIELD_DOTS.map((d, i) => (
          <span
            key={i}
            className={d.strong ? "field-dot field-strong" : "field-dot"}
            style={{
              left: `${d.x}%`, top: `${d.y}%`,
              width: `${d.sz}px`, height: `${d.sz}px`,
              "--dx": `${d.dx}px`, "--dy": `${d.dy}px`, "--op": d.op,
              animationDuration: `${d.dur}s`,
              animationDelay: `${d.dl}s`,
            } as React.CSSProperties}
          />
        ))}
      </div>
      {/* 혜성 스트릭 — 점 필드 위를 주기적으로 가로지르는 terra 빛줄기(보일 때만 0~13% 구간). */}
      <span className="comet" style={{ "--ct": "16%", "--ca": "5deg", "--cdur": "13s", "--cdel": "2s" } as React.CSSProperties} />
      <span className="comet" style={{ "--ct": "62%", "--ca": "-4deg", "--cdur": "17s", "--cdel": "9s" } as React.CSSProperties} />
      <svg className="field-links absolute inset-0 h-full w-full hidden sm:block" viewBox="0 0 100 100" preserveAspectRatio="none">
        {FIELD_LINKS.map((l, i) => (
          <line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            style={{ "--ld": l.d } as React.CSSProperties}
          />
        ))}
      </svg>
      <div className="hero-orbits absolute inset-0 hidden lg:block">
        {HERO_NODES.map((node) => (
          <span
            key={node.label}
            className="hero-node absolute"
            style={{
              left: node.x,
              top: node.y,
              "--nd": node.d,
              "--ndur": node.dur,
              "--nx": node.nx,
              "--ny": node.ny,
              "--nx2": node.nx2,
              "--ny2": node.ny2,
              "--nr": node.nr,
              "--nr2": node.nr2,
            } as React.CSSProperties}
          >
            <span className="node-pulse" />
            <span className="node-label">{node.label}</span>
          </span>
        ))}
      </div>
      <div className="hero-pointer-glow absolute inset-0" />

      {/* 텍스트 가독용 vellum radial 마스크 — 점이 차분해져 헤드라인 가독성 우선으로 복원. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_52%_46%_at_50%_42%,rgba(250,249,245,0.72),rgba(250,249,245,0.25)_58%,transparent_82%)]" />
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
  { step: "02", title: "소구점·타겟 추출", desc: "AI가 핵심 혜택과 반응할 타겟 조건을 구조화해 뽑아냅니다", meta: "핵심 혜택·타겟 조건 자동 추출", icon: <IconSpark />, demo: "extract" as const },
  { step: "03", title: "100만 행 매칭", desc: "의미 유사도 + 규칙·범주 가중치로 100만 페르소나를 전수 검색", meta: "초고속 ~84ms", icon: <IconScan />, demo: "match" as const },
  { step: "04", title: "인사이트", desc: "반응도·응답층·공략 지역·페르소나 의견·판매 전략·리포트로 정리", meta: "지도 · 분포 차트 · 마크다운 리포트", icon: <IconInsight />, demo: "insight" as const },
];
const FEATURES = [
  { title: "약관·상품 분석", desc: "소구점 추출 → 페르소나 매칭 → 반응도·응답층·지역·의견·판매전략 리포트", icon: <IconAnalyze />, demo: "analyze" as const },
  { title: "A/B 테스트", desc: "두 안을 평행 분석하고 비교 표·추천안·판매 전략까지 도출", icon: <IconABTest />, demo: "abtest" as const },
  { title: "페르소나 탐색", desc: "자연어로 검색하면 의미 분석 + 조건 필터로 후보를 카드로 제시", icon: <IconUsers />, demo: "explore" as const },
  { title: "가상 설문", desc: "페르소나 모집단에 질문을 던져 응답 통계와 차트 리포트를 생성", icon: <IconSurvey />, demo: "survey" as const },
  { title: "데이터 현황", desc: "100만 행 데이터셋의 인구통계·지역 분포를 한눈에 시각화", icon: <IconOverview />, demo: "overview" as const },
  { title: "공략 지역 지도", desc: "252개 시군구 단위 반응 집중도를 한국 지도 위에 표시", icon: <IconMap />, demo: "map" as const },
  { title: "겹침 분석", desc: "여러 안의 타겟층이 얼마나 겹치는지 — 중복률·도달 범위·독점층으로 중복을 진단", icon: <IconOverlap />, demo: "overlap" as const },
  { title: "What-if 실험실", desc: "타겟·관심사 슬라이더를 움직이면 100만 분포가 즉시 재계산 — 원본 대비 변화로 즉답", icon: <IconWhatIf />, demo: "whatif" as const },
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
function FeatureDemo({ type }: { type: "analyze" | "abtest" | "explore" | "survey" | "overview" | "map" | "overlap" | "whatif" }) {
  return (
    <div className="feature-demo relative mt-4 h-[84px] overflow-hidden rounded-[10px] border border-parchment bg-snow/70 px-3 py-2.5">
      {type === "analyze" && <DemoAnalyze />}
      {type === "abtest" && <DemoABTest />}
      {type === "explore" && <DemoExplore />}
      {type === "survey" && <DemoSurvey />}
      {type === "overview" && <DemoOverview />}
      {type === "map" && <DemoMap />}
      {type === "overlap" && <DemoOverlap />}
      {type === "whatif" && <DemoWhatIf />}
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

// ⑦ 겹침 분석 — A(marine)·B(terra) 두 원이 팝인하며 교집합(겹침)이 은은히 펄스
function DemoOverlap() {
  return (
    <div className="dm-overlap relative h-full">
      <span className="vn vn-a" />
      <span className="vn vn-b" />
      <span className="vn-x" />
      <span className="absolute left-2 top-1 text-[9px] font-semibold text-marine">A</span>
      <span className="absolute right-2 top-1 text-[9px] font-semibold text-terra">B</span>
      <span className="absolute bottom-0.5 right-1 num-tabular text-[9px] font-semibold text-terra">겹침 28%</span>
    </div>
  );
}

// ⑧ What-if 실험실 — 슬라이더 트랙이 차오르고 thumb가 미세 조정, 델타 칩 pop
const WHATIF_SLIDERS = [
  { w: "64%", d: "0.35s" },
  { w: "42%", d: "0.55s" },
  { w: "78%", d: "0.75s" },
];
function DemoWhatIf() {
  return (
    <div className="dm-whatif relative flex h-full flex-col justify-center gap-[9px] pr-12">
      {WHATIF_SLIDERS.map((s, i) => (
        <span key={i} className="relative h-[5px] w-full rounded-full bg-stone/15">
          <span className="wf-track absolute inset-y-0 left-0 rounded-full bg-terra/55" style={{ "--w": s.w, "--d": s.d } as React.CSSProperties} />
          <span className="wf-thumb absolute h-3 w-3 rounded-full bg-terra border-2 border-snow shadow-[0_1px_3px_rgba(0,0,0,0.25)]" style={{ left: s.w, "--d": s.d } as React.CSSProperties} />
        </span>
      ))}
      <span className="wf-delta absolute right-1 top-1.5 rounded border border-terra/30 bg-terra/10 px-1.5 py-[2px] num-tabular text-[9px] font-semibold text-terra">▲ +12%</span>
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
          <span data-reveal aria-hidden className="hidden lg:block pipeline-rail absolute top-[3.75rem] left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-parchment via-terra/50 to-parchment">
            <span className="rail-dot absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-terra shadow-[0_0_10px_rgba(217,119,87,0.8)]" />
          </span>
          {PIPELINE.map((p, i) => (
            <li key={p.step} data-reveal onMouseMove={trackSpotlight} onMouseLeave={resetSpotlight} className="reveal motion-card spotlight gborder group relative overflow-hidden rounded-[14px] border border-parchment bg-vellum p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-2 hover:shadow-[0_22px_48px_-22px_rgba(20,20,19,0.3)]" style={{ transitionDelay: `${i * 90}ms` }}>
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
            title="기획부터 마케팅까지, 8가지 도구"
            subtitle="분석·A/B·겹침 분석·페르소나 탐색·가상 설문·What-if를 한 곳에서 이어서 진행합니다."
          />
        </div>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f, i) => (
            <article key={f.title} data-reveal onMouseMove={trackSpotlight} onMouseLeave={resetSpotlight} className="reveal motion-card spotlight gborder group relative overflow-hidden rounded-[14px] border border-parchment bg-vellum p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-1.5 hover:shadow-[0_18px_40px_-22px_rgba(20,20,19,0.3)]" style={{ transitionDelay: `${i * 65}ms` }}>
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
  { value: 1_000_000, suffix: "", label: "합성 한국인 페르소나", note: "전수 분석 대상" },
  { value: 84, suffix: "ms", label: "100만 행 전수 검색", note: "고속 유사도 검색" },
  { value: 252, suffix: "개", label: "시군구 공략 지역", note: "17개 시도 / 252 구·군" },
  { value: 22, suffix: "컬럼", label: "페르소나 속성", note: "인물 7종 + 인구통계·지역" },
];
const TAGS = ["약관 분석", "A/B 테스트", "겹침 분석", "페르소나 탐색", "가상 설문", "What-if 실험실", "데이터 현황", "분석 이력", "페르소나 의견", "판매 전략", "공략 지역 지도"];

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
            <div key={s.label} data-reveal onMouseMove={trackSpotlight} onMouseLeave={resetSpotlight} className="reveal motion-card spotlight gborder group relative overflow-hidden rounded-[14px] border border-parchment bg-snow p-6 text-center transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_-22px_rgba(20,20,19,0.3)]" style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="relative">
                <CountUp value={s.value} suffix={s.suffix} />
                <p className="mt-2 text-body-sm font-semibold text-ink">{s.label}</p>
                <p className="mt-1 text-caption text-dusty">{s.note}</p>
              </div>
            </div>
          ))}
        </div>

        {/* 태그 마키 벨트 — 양방향 2줄 무한 흐름, hover 시 정지. reduced-motion은 정적 wrap. */}
        <div data-reveal className="reveal mt-14 space-y-3">
          <MarqueeRow items={TAGS} dur="38s" />
          <MarqueeRow items={[...TAGS].reverse()} reverse dur="52s" />
        </div>

        {/* 회전 conic 보더 — 1.5px 프레임 안에서 빛줄기가 테두리를 따라 돈다(transform rotate = GPU 합성). */}
        <div data-reveal className="reveal cta-frame relative mt-20 overflow-hidden rounded-[16px] bg-onyx/40 p-[1.5px]">
          <span aria-hidden className="cta-spin absolute" />
          <div className="relative overflow-hidden rounded-[15px] bg-onyx text-vellum px-6 py-14 sm:px-12 sm:py-16 text-center">
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
              <CtaButton href="/surveys" variant="onDark">설문 해보기</CtaButton>
            </div>
          </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 태그 무한 마키 — 동일 세그먼트 2벌을 -50% 이동으로 이어붙여 끊김 없이 순환. */
function MarqueeRow({ items, reverse = false, dur }: { items: string[]; reverse?: boolean; dur: string }) {
  return (
    <div className="marquee-mask">
      <div className={reverse ? "marquee-row rev" : "marquee-row"} style={{ "--mdur": dur } as React.CSSProperties}>
        {[0, 1].map((dup) => (
          <div key={dup} aria-hidden={dup === 1} className="marquee-seg flex shrink-0 gap-2.5">
            {items.map((t) => (
              <span key={t} className="whitespace-nowrap rounded-full border border-parchment bg-vellum px-4 py-1.5 text-body-sm text-graphite transition-[color,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-terra/40 hover:text-ink">{t}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
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
      <p data-reveal className="reveal text-overline text-graphite">{eyebrow}</p>
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
    <Link href={href} className={`${base} ${styles}`} onMouseMove={magnetMove} onMouseLeave={magnetLeave}>
      <span className="magnet relative inline-flex items-center gap-2">{children}</span>
    </Link>
  );
}

// 마그네틱 버튼 — 내용물(span)만 커서 쪽으로 최대 ±4px 끌림(버튼 자체는 고정, 레이아웃 불변).
function magnetMove(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mgx", `${(((e.clientX - r.left) / r.width - 0.5) * 8).toFixed(1)}px`);
  el.style.setProperty("--mgy", `${(((e.clientY - r.top) / r.height - 0.5) * 6).toFixed(1)}px`);
}

function magnetLeave(e: MouseEvent<HTMLElement>) {
  e.currentTarget.style.setProperty("--mgx", "0px");
  e.currentTarget.style.setProperty("--mgy", "0px");
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
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty("--mx", `${x * 100}%`);
  el.style.setProperty("--my", `${y * 100}%`);
  el.style.setProperty("--rx", `${((0.5 - y) * 5).toFixed(2)}deg`);
  el.style.setProperty("--ry", `${((x - 0.5) * 6).toFixed(2)}deg`);
}

function resetSpotlight(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  el.style.setProperty("--mx", "50%");
  el.style.setProperty("--my", "50%");
  el.style.setProperty("--rx", "0deg");
  el.style.setProperty("--ry", "0deg");
}

function trackHeroPointer(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--hx", `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty("--hy", `${((e.clientY - r.top) / r.height) * 100}%`);
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
function IconOverlap() {
  return <svg {...S} fill="none"><circle cx="9" cy="12" r="6" fill="rgba(204,219,232,0.4)" stroke={STROKE} /><circle cx="15" cy="12" r="6" fill="rgba(217,119,87,0.16)" stroke={STROKE} /></svg>;
}
function IconWhatIf() {
  return <svg {...S} fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke={STROKE} /><circle cx="9" cy="7" r="2" fill="rgba(217,119,87,0.2)" stroke={STROKE} /><circle cx="15" cy="12" r="2" fill="rgba(204,219,232,0.55)" stroke={STROKE} /><circle cx="8" cy="17" r="2" fill="rgba(217,119,87,0.2)" stroke={STROKE} /></svg>;
}

/* ============================================================
 * intro 전용 스타일
 * ============================================================ */
const introStyles = `
  .hero-line { opacity: 0; transform: translateY(16px); animation: intro-rise 0.7s cubic-bezier(0.16,1,0.3,1) forwards; animation-delay: calc(var(--i,0)*100ms + 80ms); }
  @keyframes intro-rise { to { opacity: 1; transform: translateY(0); } }

  /* 헤드라인 단어별 스태거 — blur+rise 캐스케이드. 그라디언트는 단어 단위(클리핑 안전, 미세 desync는 의도). */
  .hero-word { display: inline-block; opacity: 0; transform: translateY(0.5em) scale(0.96) rotate(1.5deg); filter: blur(7px); animation: word-rise 0.85s cubic-bezier(0.16,1,0.3,1) calc(var(--w,0)*85ms + 160ms) forwards; will-change: transform, filter, opacity; }
  @keyframes word-rise { 60% { filter: blur(0); } to { opacity: 1; transform: none; filter: blur(0); } }
  .hero-word-grad { background-image: linear-gradient(105deg, #e0875f, #d97757 35%, #b85535 80%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: word-rise 0.85s cubic-bezier(0.16,1,0.3,1) calc(var(--w,0)*85ms + 160ms) forwards, intro-pan 7s ease-in-out 1.2s infinite; }
  @keyframes intro-pan { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
  .stat-num { background-image: linear-gradient(120deg, #d97757, #b85535); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .step-num { background-image: linear-gradient(160deg, #9c9a92, #d97757); -webkit-background-clip: text; background-clip: text; color: transparent; transition: background-image 0.3s; }
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

  /* ---------- Hero 차분한 데이터 필드 ----------
   * 100만 규모를 암시하는 앰비언트 점. 형상을 만들지 않고 느린 드리프트 + 미세 트윙클만.
   * 위치는 left/top %, 움직임은 transform/opacity(60fps). 점마다 dur/delay가 달라 무리지지 않음. */
  .field-dot {
    position: absolute; border-radius: 9999px;
    background-color: #d97757; /* terra — 차분한 앰비언트 */
    opacity: var(--op, 0.3);
    transform: translate(0, 0); /* margin 없이 left/top 기준점 — 미세 이동만 */
    animation-name: field-drift;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
    will-change: transform, opacity;
  }
  .field-strong {
    background-color: #b85535; /* rust 강조점 + 미세 글로우 */
    box-shadow: 0 0 6px rgba(184,85,53,0.4);
  }
  /* 드리프트(0→오프셋→0)로 부드럽게 떠다니고, 중간에 살짝 밝아지는 트윙클. */
  @keyframes field-drift {
    0%   { transform: translate(0, 0); opacity: var(--op); }
    50%  { transform: translate(var(--dx), var(--dy)); opacity: calc(var(--op) * 1.6); }
    100% { transform: translate(0, 0); opacity: var(--op); }
  }
  .field-links { opacity: 0.62; mix-blend-mode: multiply; }
  .field-links line {
    stroke: rgba(217,119,87,0.22);
    stroke-width: 0.08;
    stroke-linecap: round;
    stroke-dasharray: 4 11;
    stroke-dashoffset: 15;
    filter: drop-shadow(0 0 2px rgba(217,119,87,0.25));
    animation: field-link-flow 5.4s ease-in-out infinite;
    animation-delay: var(--ld, 0s);
  }
  @keyframes field-link-flow {
    0%, 100% { stroke-dashoffset: 15; opacity: 0.12; }
    45% { stroke-dashoffset: 0; opacity: 0.72; }
  }
  /* 혜성 스트릭 — rotate 후 translateX(회전축 따라 사선 비행). 주기 중 0~13%만 보이고 나머지는 휴지. */
  .comet { position: absolute; left: -12%; top: var(--ct, 20%); width: 170px; height: 2px; border-radius: 9999px; background: linear-gradient(90deg, transparent, rgba(217,119,87,0.55) 55%, #f2c9b8); box-shadow: 0 0 8px rgba(224,135,95,0.55); opacity: 0; transform: rotate(var(--ca,5deg)) translateX(0); animation: comet-fly var(--cdur,15s) cubic-bezier(0.3,0,0.7,1) var(--cdel,0s) infinite; will-change: transform, opacity; }
  @keyframes comet-fly {
    0% { opacity: 0; transform: rotate(var(--ca,5deg)) translateX(0); }
    3% { opacity: 0.85; }
    10% { opacity: 0.85; }
    13%, 100% { opacity: 0; transform: rotate(var(--ca,5deg)) translateX(118vw); }
  }

  /* 스크롤 패럴랙스 — 배경은 느리게 내려가고 카피는 빠르게 떠오르며 페이드.
   * @supports 게이트 필수: 미지원 브라우저에서 animation-timeline 없이 duration 0s + fill both로
   * 최종 상태가 즉시 적용되는 사고 방지. */
  @supports (animation-timeline: view()) {
    .hero-parallax-bg { animation: hero-bg-drift linear both; animation-timeline: view(); animation-range: exit 0% exit 100%; }
    .hero-parallax-copy { animation: hero-copy-drift linear both; animation-timeline: view(); animation-range: exit 0% exit 75%; }
  }
  @keyframes hero-bg-drift { to { transform: translateY(72px); opacity: 0.45; } }
  @keyframes hero-copy-drift { to { transform: translateY(-46px); opacity: 0; } }

  .hero-pointer-glow {
    background: radial-gradient(26rem circle at var(--hx,50%) var(--hy,42%), rgba(217,119,87,0.16), rgba(242,201,184,0.08) 34%, transparent 70%);
    opacity: 0;
    transition: opacity 0.35s ease;
    mix-blend-mode: multiply;
  }
  .hero-stage:hover .hero-pointer-glow { opacity: 1; }
  .hero-node {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transform: translate(-50%, -50%);
    animation: hero-node-drift var(--ndur, 8.8s) ease-in-out infinite;
    animation-delay: var(--nd, 0s);
    will-change: transform;
  }
  .node-pulse {
    position: relative;
    height: 9px;
    width: 9px;
    border-radius: 9999px;
    background: #d97757;
    box-shadow: 0 0 10px rgba(217,119,87,0.72);
    animation: hero-node-core 2.8s ease-in-out infinite;
    animation-delay: var(--nd, 0s);
  }
  .node-pulse::after {
    content: "";
    position: absolute;
    inset: -7px;
    border-radius: inherit;
    border: 1px solid rgba(217,119,87,0.32);
    animation: hero-node-ring 2.4s ease-out infinite;
    animation-delay: var(--nd, 0s);
  }
  .node-label {
    border: 1px solid rgba(222,220,209,0.8);
    background: rgba(255,255,255,0.58);
    backdrop-filter: blur(10px);
    border-radius: 9999px;
    padding: 4px 9px;
    font-size: 11px;
    line-height: 1.2;
    font-weight: 700;
    color: #3d3d3a;
    box-shadow: 0 10px 26px -18px rgba(20,20,19,0.35);
    animation: hero-node-label var(--ndur, 8.8s) ease-in-out infinite;
    animation-delay: calc(var(--nd, 0s) + 0.35s);
  }
  @keyframes hero-node-drift {
    0%, 100% { transform: translate(-50%, -50%) translate3d(0,0,0) rotate(0deg); }
    34% { transform: translate(-50%, -50%) translate3d(var(--nx, 12px), var(--ny, -10px), 0) rotate(var(--nr, 3deg)); }
    68% { transform: translate(-50%, -50%) translate3d(var(--nx2, -8px), var(--ny2, 8px), 0) rotate(var(--nr2, -2deg)); }
  }
  @keyframes hero-node-ring {
    0% { transform: scale(0.72); opacity: 0.72; }
    80%, 100% { transform: scale(1.75); opacity: 0; }
  }
  @keyframes hero-node-core {
    0%, 100% { transform: scale(1); box-shadow: 0 0 10px rgba(217,119,87,0.72); }
    50% { transform: scale(1.22); box-shadow: 0 0 18px rgba(217,119,87,0.88); }
  }
  @keyframes hero-node-label {
    0%, 100% { transform: translateY(0); border-color: rgba(222,220,209,0.8); background: rgba(255,255,255,0.58); }
    50% { transform: translateY(-2px); border-color: rgba(217,119,87,0.42); background: rgba(255,255,255,0.72); }
  }

  /* 아이콘 배지 */
  .icon-face { background: radial-gradient(120% 120% at 30% 18%, rgba(255,255,255,0.92), transparent 55%), linear-gradient(160deg, rgba(217,119,87,0.18), rgba(204,219,232,0.34)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.6), 0 6px 16px -10px rgba(20,20,19,0.4); }
  .badge-ring { background: linear-gradient(135deg, rgba(217,119,87,0.85), rgba(204,219,232,0.7) 55%, rgba(184,85,53,0.6)); opacity: 0; transition: opacity 0.35s ease; filter: blur(0.4px); }
  .group:hover .badge-ring { opacity: 1; }
  .badge-ring.always { opacity: 0.9; }

  .spotlight::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: radial-gradient(240px circle at var(--mx,50%) var(--my,50%), rgba(217,119,87,0.14), transparent 60%); opacity: 0; transition: opacity 0.3s; z-index: 0; }
  .spotlight:hover::before { opacity: 1; }

  .gborder::after { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none; background: linear-gradient(135deg, rgba(217,119,87,0.7), rgba(204,219,232,0.6)); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; opacity: 0; transition: opacity 0.3s; z-index: 1; }
  .gborder:hover::after { opacity: 1; }
  .motion-card {
    transform-style: preserve-3d;
    will-change: transform;
  }
  .motion-card:hover {
    transform: perspective(900px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) translateY(-7px);
  }
  .motion-card .demo-panel,
  .motion-card .feature-demo,
  .motion-card .icon-face,
  .motion-card .stat-num {
    transition: transform 0.3s ease;
  }
  .motion-card:hover .demo-panel,
  .motion-card:hover .feature-demo {
    transform: translateZ(18px);
  }
  .motion-card:hover .icon-face {
    transform: translateZ(12px) scale(1.05);
  }
  .motion-card:hover .stat-num {
    transform: translateZ(12px);
  }

  .shine { overflow: hidden; }
  .shine::after { content: ""; position: absolute; top: 0; bottom: 0; left: -150%; width: 55%; transform: skewX(-20deg); background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent); pointer-events: none; }
  .shine:hover::after { animation: intro-shine 0.9s ease; }
  @keyframes intro-shine { to { left: 160%; } }

  .pipeline-rail { opacity: 0; transform: scaleX(0); transform-origin: left center; }
  .pipeline-rail.is-visible { animation: intro-rail 1.1s cubic-bezier(0.16,1,0.3,1) 0.3s both; }
  @keyframes intro-rail { from { transform: scaleX(0); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }
  /* 점은 라인과 동일한 delay/duration/easing으로 left 0→100% 이동 → 라인이 그려지는 끝을 펜촉처럼 따라간다. */
  .rail-dot { opacity: 0; }
  .pipeline-rail.is-visible .rail-dot { animation: intro-rail-run 1.1s cubic-bezier(0.16,1,0.3,1) 0.3s both; }
  @keyframes intro-rail-run { 0% { left: 0%; opacity: 0; } 8% { opacity: 1; } 100% { left: 100%; opacity: 1; } }

  /* 태그 마키 벨트 — 동일 세그먼트 2벌을 -50% 이동으로 무한 순환(gap 10px 보정 -5px). hover 정지. */
  .marquee-mask { overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); }
  .marquee-row { display: flex; width: max-content; gap: 10px; animation: marquee-l var(--mdur,40s) linear infinite; will-change: transform; }
  .marquee-row.rev { animation-name: marquee-r; }
  .marquee-mask:hover .marquee-row { animation-play-state: paused; }
  @keyframes marquee-l { to { transform: translateX(calc(-50% - 5px)); } }
  @keyframes marquee-r { from { transform: translateX(calc(-50% - 5px)); } to { transform: translateX(0); } }

  /* 최종 CTA 회전 보더 — 프레임보다 큰 conic 레이어를 rotate(GPU). inset -150%로 회전 시 코너 공백 방지. */
  .cta-frame .cta-spin { inset: -150%; background: conic-gradient(from 0deg, transparent 0deg 40deg, rgba(217,119,87,0.9) 75deg, rgba(242,201,184,0.95) 95deg, transparent 150deg 215deg, rgba(204,219,232,0.45) 260deg, transparent 320deg); animation: cta-rotate 9s linear infinite; will-change: transform; }
  @keyframes cta-rotate { to { transform: rotate(360deg); } }

  /* 마그네틱 버튼 — 내용물만 커서 쪽으로 미세 이동. */
  .magnet { transform: translate(var(--mgx,0px), var(--mgy,0px)); transition: transform 0.18s ease-out; will-change: transform; }

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

  /* ⑦ 겹침: 두 원(A·B) 팝인 + 교집합 펄스 (벤다이어그램) */
  .dm-overlap .vn { position: absolute; top: 50%; height: 52px; width: 52px; margin-top: -26px; border-radius: 9999px; border: 1.5px solid; opacity: 0; transform: scale(0.6); }
  .dm-overlap .vn-a { left: 50%; margin-left: -44px; border-color: rgba(79,128,179,0.7); background: rgba(79,128,179,0.14); }
  .dm-overlap .vn-b { left: 50%; margin-left: -8px; border-color: rgba(217,119,87,0.75); background: rgba(217,119,87,0.14); }
  .dm-overlap .vn-x { position: absolute; top: 50%; left: 50%; height: 34px; width: 20px; margin: -17px 0 0 -10px; border-radius: 9999px; background: rgba(217,119,87,0.32); opacity: 0; }
  .reveal.is-visible .dm-overlap .vn-a { animation: dm-pop 0.55s cubic-bezier(0.2,1.5,0.4,1) 0.3s both; }
  .reveal.is-visible .dm-overlap .vn-b { animation: dm-pop 0.55s cubic-bezier(0.2,1.5,0.4,1) 0.45s both; }
  .reveal.is-visible .dm-overlap .vn-x { animation: dm-soft 2.4s ease-in-out 0.75s infinite; }
  @keyframes dm-soft { 0%,100% { opacity: 0.45; } 50% { opacity: 0.85; } }

  /* ⑧ What-if: 트랙 차오름 + thumb 미세 조정 + 델타 칩 pop */
  .dm-whatif .wf-track { width: 0; }
  .dm-whatif .wf-thumb { top: 50%; transform: translate(-50%,-50%); }
  .dm-whatif .wf-delta { opacity: 0; transform: scale(0.6); }
  .reveal.is-visible .dm-whatif .wf-track { animation: dm-fill 0.9s cubic-bezier(0.3,1,0.4,1) var(--d,0s) both; }
  .reveal.is-visible .dm-whatif .wf-thumb { animation: wf-nudge 2.8s ease-in-out calc(var(--d,0s) + 0.9s) infinite; }
  .reveal.is-visible .dm-whatif .wf-delta { animation: dm-pop 0.5s cubic-bezier(0.2,1.5,0.4,1) 1.05s both; }
  @keyframes wf-nudge { 0%,100% { transform: translate(-50%,-50%); } 50% { transform: translate(calc(-50% + 8px),-50%); } }

  @media (prefers-reduced-motion: reduce) {
    .hero-line, .hero-word, .hero-word-grad, .aurora, .aurora-dark, .blob, .pulse-dot::after, .pipeline-rail, .rail-dot,
    .comet, .marquee-row, .cta-spin, .hero-parallax-bg, .hero-parallax-copy,
    .scroll-cue, .scroll-dot, .shine::after, .field-dot, .field-links line, .hero-node, .node-pulse, .node-pulse::after, .node-label,
    .demo-input .typing, .demo-input .ghost, .demo-input .file-chip,
    .demo-extract .chip, .demo-match .md-on, .demo-match .md-scan, .demo-insight .bar,
    .dm-analyze .sweep, .dm-analyze .kw, .dm-abtest .ab-bar, .dm-explore .av,
    .dm-survey .fill, .dm-overview .ring, .dm-map .pin, .dm-map .pin-ring,
    .dm-overlap .vn, .dm-overlap .vn-x, .dm-whatif .wf-track, .dm-whatif .wf-thumb, .dm-whatif .wf-delta {
      animation: none !important;
    }
    .hero-line { opacity: 1 !important; transform: none !important; }
    .hero-word { opacity: 1 !important; transform: none !important; filter: none !important; }
    .hero-word-grad, .stat-num { -webkit-text-fill-color: #b85535; color: #b85535; }
    .comet { display: none !important; }
    /* 마키 정지 → 한 벌만 정적 wrap으로 표시 */
    .marquee-mask { mask-image: none !important; -webkit-mask-image: none !important; }
    .marquee-row { width: 100% !important; justify-content: center; transform: none !important; }
    .marquee-seg { flex-wrap: wrap; justify-content: center; }
    .marquee-seg[aria-hidden="true"] { display: none !important; }
    .magnet { transform: none !important; }
    .hero-parallax-bg, .hero-parallax-copy { transform: none !important; opacity: 1 !important; }
    /* 데이터 필드: 드리프트 정지, 기본 opacity로 정적 표시. */
    .field-dot { transform: none !important; opacity: var(--op, 0.3) !important; }
    .field-links line { opacity: 0.16 !important; stroke-dashoffset: 0 !important; }
    .hero-pointer-glow, .node-pulse::after { display: none !important; }
    .pipeline-rail { opacity: 1 !important; transform: scaleX(1) !important; }
    .rail-dot { left: 100% !important; opacity: 1 !important; }
    .hero-node, .node-label, .motion-card, .motion-card:hover,
    .motion-card:hover .demo-panel, .motion-card:hover .feature-demo,
    .motion-card:hover .icon-face, .motion-card:hover .stat-num {
      transform: none !important;
    }
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
    .dm-overlap .vn, .dm-overlap .vn-x { opacity: 1 !important; transform: scale(1) !important; }
    .dm-whatif .wf-track { width: var(--w) !important; }
    .dm-whatif .wf-delta { opacity: 1 !important; transform: none !important; }
    .dm-whatif .wf-thumb { transform: translate(-50%,-50%) !important; }
    .dm-analyze .sweep, .dm-map .pin-ring { display: none !important; }
  }
`;
