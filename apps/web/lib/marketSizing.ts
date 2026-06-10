/**
 * 시장 규모 환산 — 100만 합성 페르소나 인원을 전국 인구 규모로 비례 환산한다.
 *
 * ⚠️ 정직성 원칙: 이 환산은 "규모 가늠치"이지 정밀 추정이 아니다.
 * 100만 페르소나가 한국 인구통계 분포를 반영해 생성됐다는 점(KOSIS 등 통계 기반,
 * README 데이터 섹션)을 근거로 한 단순 비례 환산이며, 화면에는 반드시
 * "가늠치" 라벨과 함께 노출해야 한다.
 */

/** 전국 성인 인구 가늠치 (통계청 주민등록 인구 기준 19세 이상, 약 4,400만 명). */
export const KOREA_ADULT_POPULATION = 44_000_000;

/** 합성 페르소나 모집단 크기 (nvidia/Nemotron-Personas-Korea 100만 행). */
export const PERSONA_POPULATION = 1_000_000;

/** 페르소나 인원 → 전국 성인 인구 규모로 비례 환산. */
export function estimateNationalScale(personaCount: number): number {
  return Math.round(
    personaCount * (KOREA_ADULT_POPULATION / PERSONA_POPULATION),
  );
}

/** 큰 인원을 "약 N만 명" 형태의 읽기 쉬운 한국어로. */
export function formatApproxKorean(count: number): string {
  if (count >= 100_000_000) {
    return `약 ${(count / 100_000_000).toFixed(1)}억 명`;
  }
  if (count >= 10_000) {
    return `약 ${Math.round(count / 10_000).toLocaleString("ko-KR")}만 명`;
  }
  return `약 ${count.toLocaleString("ko-KR")}명`;
}

/**
 * 전통 소비자조사 대비 비교 프레임 (업계 통상 범위 가늠치).
 * 외주 정량조사·FGI 1회 기준 — 화면 각주에 "업계 통상 기준" 명시 필수.
 */
export const TRADITIONAL_RESEARCH = {
  duration: "2~6주",
  cost: "수백만~수천만 원",
  footnote:
    "통상적인 외주 소비자조사(정량 설문·FGI) 1회 기준의 가늠치입니다. PersonaFit 결과는 합성 페르소나의 반응 경향으로, 실제 조사를 대체하기보다 본조사 전 예행연습에 적합합니다.",
} as const;
