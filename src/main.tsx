/**
 * main.tsx —— 前端入口。挂载 React 应用并加载全局样式（架构 §9 第 2 行）。
 * 明文只活在本机：本文件不接触任何密钥/主密码。
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("找不到 #root 挂载点，index.html 可能被改动");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
