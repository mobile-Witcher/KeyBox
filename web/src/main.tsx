/**
 * main.tsx —— 前端入口。挂载 React 应用并加载全局样式（架构 §9 第 2 行）。
 * 明文只活在本机：本文件不接触任何密钥/主密码。
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import App from "./App";
import { initTheme } from "./lib/theme";
import "./index.css";

// 应用启动即落实主题（与 index.html 内联脚本同源，做一次幂等校正）
initTheme();

// 安卓壳：状态栏沉浸（页面延伸到状态栏下）+ 图标颜色跟随主题。
// Web 环境下此插件为 no-op；主题切换时的联动在切换处另行调用。
if (Capacitor.isNativePlatform()) {
  void (async () => {
    try {
      await StatusBar.setOverlaysWebView({ overlay: true });
      const dark =
        localStorage.getItem("keybox.theme") === "dark" ||
        document.documentElement.classList.contains("dark");
      await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    } catch {
      // 非 Android 或插件不可用时静默跳过
    }
  })();
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("找不到 #root 挂载点，index.html 可能被改动");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
