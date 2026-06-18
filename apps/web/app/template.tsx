/**
 * App Router template — 라우트 변경마다 새 인스턴스로 마운트되므로
 * 페이지 전환 시 mount 애니메이션이 매번 발화한다.
 *
 * 방향 결정: 헤더의 탭 순서(/overview → /personas → /analyze → /abtest → /cannibal → /surveys) 기준.
 *  - 더 오른쪽 탭으로 이동: 우측에서 슬라이드 인 (anim-page-enter-right)
 *  - 더 왼쪽 탭으로 이동: 좌측에서 슬라이드 인 (anim-page-enter-left)
 *  - 같은 탭 내 sub-path 이동 또는 첫 진입: 기본 우측 슬라이드
 *
 * 이전 탭 인덱스는 모듈 스코프 변수로 보존 — template은 라우트마다 unmount/remount되지만
 * 모듈 변수는 React lifecycle과 독립이라 라우트 전환 사이에 살아남는다.
 *
 * fill-mode: backwards 라 종료 후 transform이 해제되어 SiteHeader의 sticky가 보존된다.
 */
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const TAB_INDEX: { match: (p: string) => boolean; index: number }[] = [
  { match: (p) => p.startsWith("/overview"), index: 0 },
  { match: (p) => p.startsWith("/personas"), index: 1 },
  { match: (p) => p.startsWith("/surveys"), index: 5 }, // /surveys 먼저 매칭해야 /survey와 충돌 안 함
  { match: (p) => p.startsWith("/abtest"), index: 3 },
  { match: (p) => p.startsWith("/cannibal"), index: 4 }, // 겹침 분석 (A/B와 설문 사이)
  { match: (p) => p.startsWith("/analyze") || p.startsWith("/survey"), index: 2 }, // 분석 탭 (단수 /survey 포함)
];

function getTabIndex(pathname: string): number {
  return TAB_INDEX.find((t) => t.match(pathname))?.index ?? 2;
}

let prevTabIndex = -1;

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentIndex = getTabIndex(pathname);
  const direction: "right" | "left" =
    prevTabIndex === -1 || currentIndex >= prevTabIndex ? "right" : "left";

  useEffect(() => {
    prevTabIndex = currentIndex;
  }, [currentIndex]);

  const animClass =
    direction === "right" ? "anim-page-enter-right" : "anim-page-enter-left";

  return (
    <div key={pathname} className={animClass}>
      {children}
    </div>
  );
}
