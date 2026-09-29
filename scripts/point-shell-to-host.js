/**
 * point-shell-to-host.js —— 把桌面壳（Tauri）指向线上托管页面。
 *
 * 为什么需要（2026-09-29 实测定位）：安装包内置页面的源是 `http://tauri.localhost`
 * （Windows/Android WebView 的自定义协议源），它**不在 CloudBase 环境安全域名白名单**里，
 * 而体验版套餐又**不支持自定义安全域名**（调用 addSecurityDomain 返回"当前套餐无法执行此操作"），
 * 结果桌面端的所有云端请求被跨域拒绝 → 表现为"登录失败"。
 *
 * 解决办法：让壳直接加载托管网址（Tauri 2 的 `frontendDist` 支持远程 URL）。
 * 此时 WebView 的源就是托管域名（**已在白名单**），跨域限制自然消失。
 * 附带好处：网页更新后 app 无需重新打包分发。
 *
 * 用法（CI 或本地打包远程版时）：
 *   KEYBOX_HOSTING_URL=https://<你的托管域名> node scripts/point-shell-to-host.js
 * 未设置该环境变量时不改动任何文件（保持内置资源，用于本地调试）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const url = String(process.env.KEYBOX_HOSTING_URL || "").trim();
const confPath = resolve(process.cwd(), "src-tauri/tauri.conf.json");

if (!url) {
  console.log("[shell] KEYBOX_HOSTING_URL 未设置 → 保持内置资源（frontendDist 不变）");
  process.exit(0);
}
if (!/^https:\/\//i.test(url)) {
  console.error("[shell] KEYBOX_HOSTING_URL 必须是 https:// 开头的地址，收到：" + url);
  process.exit(1);
}

const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.build.frontendDist = url.replace(/\/+$/, "");
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n", "utf8");
console.log("[shell] tauri.conf.json 的 frontendDist → " + conf.build.frontendDist);
