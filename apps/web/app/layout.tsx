import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PersonaFit — 타겟 페르소나 분석기",
  description:
    "상품설명서·약관을 입력하면 Nemotron-Personas-Korea 기반으로 반응할 타겟과 공략 지역을 알려드립니다.",
  applicationName: "PersonaFit",
  // app/icon.png · apple-icon.png · opengraph-image.png 은 Next.js가 파일 기반으로 자동 인식.
  // 여기서는 공유 카드(카카오톡·슬랙·트위터) 메타만 명시적으로 보강.
  openGraph: {
    type: "website",
    siteName: "PersonaFit",
    title: "PersonaFit — 타겟 페르소나 분석기",
    description:
      "상품설명서·약관을 입력하면 Nemotron-Personas-Korea 기반으로 반응할 타겟과 공략 지역을 알려드립니다.",
    locale: "ko_KR",
  },
  twitter: {
    card: "summary_large_image",
    title: "PersonaFit — 타겟 페르소나 분석기",
    description:
      "상품설명서·약관을 입력하면 Nemotron-Personas-Korea 기반으로 반응할 타겟과 공략 지역을 알려드립니다.",
  },
};

// 모바일 뷰포트 — iOS notch(safe-area) 대응, 사용자 줌 허용
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#faf9f5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="font-sans antialiased min-h-[100dvh] [padding-left:env(safe-area-inset-left)] [padding-right:env(safe-area-inset-right)]">
        {children}
      </body>
    </html>
  );
}
