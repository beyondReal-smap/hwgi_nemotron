import { redirect } from "next/navigation";

/**
 * /history는 분석 페이지(/)의 "이력 조회" 모드 탭으로 통합되었습니다.
 * 외부 링크·즐겨찾기 호환을 위해 / 로 영구 리다이렉트.
 */
export default function LegacyHistoryRedirect(): never {
  redirect("/");
}
