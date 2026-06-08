"use client";

import { useEffect, useRef, useState } from "react";

/**
 * CountUp — 숫자가 0→목표값으로 굴러오르는 공용 카운트업.
 *
 * intro 랜딩에만 있던 자산을 디자인시스템 공용 컴포넌트로 승격(ScoreCard·overview·
 * 분석 KPI 등에서 재사용). '100만'이 정적 텍스트가 아니라 차오르는 모션으로 보이면
 * 데이터 규모가 신체적으로 체감되고, 랜딩에서 본 모션이 결과 화면에서 반복돼 일관성이 생긴다.
 *
 * 접근성: prefers-reduced-motion / IntersectionObserver 미지원 시 즉시 최종값을 표시
 * (SSR·저사양 폴백 안전). 뷰포트 진입 시 1회만 재생.
 */
export function CountUp({
  value,
  suffix = "",
  prefix = "",
  decimals = 0,
  durationMs = 1500,
  className,
  suffixClassName,
  prefixClassName,
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  durationMs?: number;
  className?: string;
  suffixClassName?: string;
  prefixClassName?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      setDisplay(value);
      return;
    }
    let raf = 0;
    let start = 0;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const run = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / durationMs, 1);
      setDisplay(value * ease(p));
      if (p < 1) raf = requestAnimationFrame(run);
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          raf = requestAnimationFrame(run);
          io.disconnect();
        }
      },
      { threshold: 0.3, rootMargin: "0px 0px -5% 0px" },
    );
    io.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [value, durationMs]);

  const formatted = display.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref} className={className}>
      {prefix ? <span className={prefixClassName}>{prefix}</span> : null}
      {formatted}
      {suffix ? <span className={suffixClassName}>{suffix}</span> : null}
    </span>
  );
}

export default CountUp;
