import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        vellum: "#faf9f5",
        ink: "#141413",
        onyx: "#1f1e1d",
        graphite: "#3d3d3a",
        dusty: "#73726c",
        stone: "#9c9a92",
        parchment: "#dedcd1",
        snow: "#ffffff",
        azure: "#ccdbe8",
        marine: "#4f80b3",
        terra: "#d97757",
        // 시맨틱 상태색 — vellum 배경과 조화되도록 채도를 낮춘 muted 톤.
        // 색만으로 의미를 전달하지 않도록 항상 아이콘/라벨과 병기한다.
        // danger는 terra(브랜드 주황)와 혼동되지 않게 더 붉고 진하게(hue↓ light↓).
        success: "#4f8a52", // 완료·긍정·안정
        warning: "#c2892e", // 주의·경고
        danger: "#c5483a", // 실패·부정·위험
        info: "#4f80b3", // 정보·진행 (marine과 동일값, 의미 명시용 별칭)
      },
      fontFamily: {
        sans: ["SUITE", "AtoZ", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["SUITE", "AtoZ", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [typography],
};
export default config;
