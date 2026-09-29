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
          /** 次级表面：表头、hover 行、内嵌区块 */
          "surface-2": "var(--kb-surface-2)",
          text: "var(--kb-text)",
          muted: "var(--kb-muted)",
          border: "var(--kb-border)",
          /** 强边框：需要明确分隔时 */
          "border-strong": "var(--kb-border-strong)",
          primary: "var(--kb-primary)",
          "primary-hover": "var(--kb-primary-hover)",
          "primary-contrast": "var(--kb-primary-contrast)",
          danger: "var(--kb-danger)",
          success: "var(--kb-success)",
          warning: "var(--kb-warning)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
