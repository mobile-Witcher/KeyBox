import type { CapacitorConfig } from "@capacitor/cli";

/**
 * capacitor.config.ts —— Capacitor（Android 原生外壳）配置（架构 §9 / §10 第 9、11 步）。
 *
 * 作用：把 Vite 构建出的静态站点（`dist/`）包进一个 Android WebView 外壳，
 *   由 `npx cap add android` 生成 `android/` 工程，再由 `npx cap sync android`
 *   把最新的 `dist/` 与插件同步进去。
 *
 * 字段说明：
 *   - `appId`：Android 包名（反向域名，一经发布不可更改）。
 *   - `appName`：桌面图标与任务栏显示名。
 *   - `webDir`：**必须**与 vite.config.ts 的 build.outDir 一致（本项目为 `dist`）。
 *
 * 注意：本文件只在执行 `npx cap ...` 时被 CLI 读取，**不参与前端打包**；
 *   它已从 build 的 TS 扫描范围（tsconfig.include = ["src", "vite.config.ts"]）中排除。
 */
const config: CapacitorConfig = {
  appId: "com.jidongzhanshi.keybox",
  appName: "KeyBox",
  webDir: "dist",
  android: {
    // 生产环境应始终走 HTTPS；此处显式关闭“允许混合内容”，避免明文降级。
    allowMixedContent: false,
  },
};

export default config;
