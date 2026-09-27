/**
 * cloudbase.ts —— CloudBase Web SDK 初始化（架构 §9 第 4 行）。
 *
 * 硬约束：
 *   - env / publishable key / region 一律走 import.meta.env，绝不硬编码（硬约束 4）。
 *   - PG 模式必须用 app.rdb()，禁用 app.database() / db.collection()（已实测本环境为 PG）。
 *
 * 已核实的 SDK 口径（技能文档 postgresql-development-cloudbase、auth-web-cloudbase）：
 *   - 初始化形状：cloudbase.init({ env, region, accessKey, auth: { detectSessionInUrl: true } })
 *   - app.auth 为属性形式；app.rdb() 为方法形式。
 *   - auth.getSession() 是登录态的唯一判据；不要用 auth.getUser()。
 */
import cloudbase from "@cloudbase/js-sdk";

const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID;
const region = import.meta.env.VITE_CLOUDBASE_REGION || "ap-shanghai";
const publishableKey = import.meta.env.VITE_PUBLISHABLE_KEY;

if (!envId) {
  // 只提示缺哪个键名，绝不打印任何真值。
  throw new Error(
    "缺少 VITE_CLOUDBASE_ENV_ID：请复制 .env.example 为 .env.local 并填入真实环境 ID"
  );
}
if (!publishableKey) {
  throw new Error(
    "缺少 VITE_PUBLISHABLE_KEY：请复制 .env.example 为 .env.local 并填入 publishable key"
  );
}

/** 全局唯一的 CloudBase 应用实例（禁止在多处重新 init）。 */
export const app = cloudbase.init({
  env: envId,
  region,
  accessKey: publishableKey,
  auth: { detectSessionInUrl: true },
});

/**
 * Auth 客户端。
 * 说明：@cloudbase/js-sdk v3 的官方 Auth 技能写作 `app.auth`（属性）；部分旧文档写作 `app.auth()`。
 * 这里采用属性形式；若某版本报 “app.auth is not a function”，改回 `app.auth()` 即可（待核实：具体版本行为）。
 */
export const auth = app.auth;

/** PG 数据访问客户端。架构 §9 明确：必须 app.rdb()，查询用 postgREST 风格链式方法。 */
export const db = app.rdb();
