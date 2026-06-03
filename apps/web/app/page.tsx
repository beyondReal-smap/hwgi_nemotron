import { redirect } from "next/navigation";

// 루트(/)는 소개 랜딩(/intro)으로 보낸다. 분석 도구는 /analyze 로 이동했다.
export default function RootPage() {
  redirect("/intro");
}
