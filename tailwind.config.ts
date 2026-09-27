/**
 * tailwind.config.ts —— Tailwind CSS v3 配置。
 * 只扫描 src 下的源码；暗色模式用 class 驱动（架构 §10 第 11 步：夜间模式只需切一个 class，
 * 后续 ThemeToggle 会给 <html> 加上/移除 dark 类）。
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
    },
  },
  plugins: [],
};

export default config;
