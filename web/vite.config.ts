/// <reference types="vitest" />
/**
 * vite.config.ts —— 前端构建与单元测试配置。
 * 说明：本步骤（第 4/5 步）只用到构建与 vitest；Tauri/Capacitor 相关配置留到第 9 步再引入。
 * 依赖顺序（架构 §9 第 2 行）：这是“可运行的壳”，没有它后面所有代码都无法验证。
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 架构 §10 第 1 步要求 localhost:5173 在安全域名白名单内，故端口固定为 5173，避免被自动改端口。
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  test: {
    // 加密层 / 本地层单元测试只依赖 WebCrypto 与（fake-）IndexedDB，无需浏览器环境。
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
    // 串行执行测试文件：本机沙箱对 %TEMP% 的并行写入有限制，vitest 并行 worker 的 SSR 缓存
    // 落盘会触发 EPERM 干扰（与用例无关）。串行可规避，结果更可复现。
    fileParallelism: false,
  },
});
