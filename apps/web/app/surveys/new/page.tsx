import { redirect } from "next/navigation";

/**
 * /surveys/new는 /surveys?mode=new로 통합되었습니다.
 * 외부 링크/북마크 호환을 위해 영구 리다이렉트.
 */
export default function LegacyNewSurveyRedirect(): never {
  redirect("/surveys?mode=new");
}
