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
        terra: "#d97757",
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
