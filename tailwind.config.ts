/**
 * tailwind.config.ts —— Tailwind CSS v3 配置。
 * 只扫描 src 与 index.html；暗色模式用 class 驱动（架构 §10 第 11 步：夜间模式只切 <html> 上的 dark 类）。
 *
 * 主题令牌（R24）：把语义色映射到 index.css 里集中定义的 CSS 变量，
 * 组件用 `bg-kb-surface` / `text-kb-muted` / `border-kb-border` 等，切换主题时自动跟随。
 */
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        kb: {
          bg: "var(--kb-bg)",
          surface: "var(--kb-surface)",
          text: "var(--kb-text)",
          muted: "var(--kb-muted)",
          border: "var(--kb-border)",
          primary: "var(--kb-primary)",
          "primary-contrast": "var(--kb-primary-contrast)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
