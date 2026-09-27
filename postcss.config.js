/**
 * postcss.config.js —— Tailwind v3 的 PostCSS 管线（架构 §2 技术选型：Tailwind CSS）。
 * 注意：这里用 tailwindcss v3（配置式），与架构 §9 文件清单里的 tailwind.config.ts 对应；
 *       tailwindcss v4 改为 @tailwindcss/postcss 且不再用 JS 配置，本步骤不采用。
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
