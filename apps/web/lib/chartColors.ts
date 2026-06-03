/**
 * 데이터 시각화 공통 색 토큰.
 *
 * recharts는 fill/stroke에 hex 문자열을 직접 받으므로 Tailwind 클래스 대신 상수로 관리한다.
 * 한화 톤(vellum #faf9f5 배경)과 조화되도록 채도를 낮춘 muted 팔레트이며, 브랜드색
 * terra·marine을 앞에 배치해 연속성을 유지한다.
 *
 * 적용 원칙:
 *  - 도넛/파이/범례 등 **다계열 구분이 필요한 곳**에서만 팔레트를 쓴다.
 *  - 단일 계열 막대·지도 밀도맵은 단색(terra) 그라데이션 유지가 데이터 시각화 정석.
 *  - 여러 차트에 흩어져 있던 축/그리드 하드코딩 색을 한 곳에서 통일한다.
 */

// 정성(qualitative) 팔레트 — 인접 색을 색상환에서 떨어뜨려 배치해 적록색맹에서도 구분이 쉽도록 함.
// 채도 35~55% · 명도 50~64%로 대역을 맞춰 vellum 배경에서 한 화면에 섞여도 튀지 않는다.
export const CHART_PALETTE = [
  "#d97757", // terra  (브랜드 주황)
  "#4f80b3", // marine (브랜드 파랑)
  "#6f9e5f", // sage   (녹)
  "#d9a441", // amber  (호박)
  "#9a72ab", // plum   (자주)
  "#4ba39b", // teal   (청록)
  "#cf7a8c", // rose   (장미)
  "#5f7891", // slate  (청회)
  "#b1543c", // clay   (적갈)
  "#8d934f", // moss   (올리브)
] as const;

/** 팔레트에서 i번째 색을 순환 반환. */
export function chartColor(i: number): string {
  return CHART_PALETTE[i % CHART_PALETTE.length];
}

// ── 차트 축·그리드 공통 색 (여러 차트의 반복 하드코딩 통일) ──
export const CHART_GRID = "#dedcd1"; // parchment — CartesianGrid
export const CHART_AXIS = "#dedcd1"; // parchment — 축선(stroke)
export const CHART_TICK = "#73726c"; // dusty    — 수치 눈금 라벨
export const CHART_TICK_STRONG = "#3d3d3a"; // graphite — 카테고리 라벨
export const CHART_LABEL = "#3d3d3a"; // graphite — 막대 값 라벨
export const CHART_FONT = "SUITE";
export const CHART_CURSOR = "rgba(217, 119, 87, 0.08)"; // terra 8% — hover 커서
export const CHART_SINGLE = "#d97757"; // terra — 단일 계열 막대 기본색
export const CHART_CELL_STROKE = "#faf9f5"; // vellum — 도넛 조각 구분선

// ── 막대 순위 강조 ──
// 막대는 길이 비교가 핵심이라 도넛식 다색은 피한다. 대신 최댓값(1위) 막대만 풀톤,
// 그 외는 muted 투명도로 낮춰 "가장 큰 항목"을 한눈에 띄운다(NPS 구간색과 같은 '의미 있는 색' 원칙).
// <Bar fill={CHART_SINGLE}> 안에서 <Cell fillOpacity={barTopOpacity(count, max)} />로 사용.
export const CHART_BAR_MUTED_OPACITY = 0.42; // 1위 외 막대의 fill 투명도

/** 막대 순위 강조용 fill 투명도. 최댓값 막대는 1(풀톤), 그 외는 muted. */
export function barTopOpacity(count: number, max: number): number {
  return count >= max ? 1 : CHART_BAR_MUTED_OPACITY;
}

// ── 시맨틱 상태색 (recharts용 hex) ──
// Tailwind 토큰(success/warning/danger/info)과 동일값. 차트는 클래스를 못 받으므로 hex로 제공.
// NPS·만족도 등 "의미가 있는 순서형" 데이터의 구간 색칠에 사용한다.
export const SEMANTIC = {
  success: "#4f8a52", // 추천·긍정·완료
  warning: "#c2892e", // 중립·주의
  danger: "#c5483a", // 비추천·부정·실패
  info: "#4f80b3", // 정보·진행 (marine)
} as const;

/** NPS 점수(0~10) → 구간 색. 추천자(9-10)/중립(7-8)/비추천(0-6). */
export function npsColor(score: number): string {
  if (score >= 9) return SEMANTIC.success;
  if (score >= 7) return SEMANTIC.warning;
  return SEMANTIC.danger;
}
