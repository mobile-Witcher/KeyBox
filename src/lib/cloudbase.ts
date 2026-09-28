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

const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID as string | undefined;
const region = (import.meta.env.VITE_CLOUDBASE_REGION as string | undefined) || "ap-shanghai";
const publishableKey = import.meta.env.VITE_PUBLISHABLE_KEY as string | undefined;

/**
 * 配置缺失时的降级（R：修复"CI 构建的安装包白屏"）：
 *   旧实现在这里直接 throw → 整个前端无法挂载 → 用户只看到深色空屏，无从得知原因。
 *   现在改为记录 initError、不创建实例；App.tsx 检测到 initError 时渲染"配置缺失"指引页。
 * 注意：auth / db 两个门面在配置缺失时为 null（运行时不可用）；
 *   但 App.tsx 已用 initError 门禁，配置缺失时不会渲染任何会触碰它们的页面。
 */
export const initError: string | null = (() => {
  const missing: string[] = [];
  if (!envId) missing.push("VITE_CLOUDBASE_ENV_ID");
  if (!publishableKey) missing.push("VITE_PUBLISHABLE_KEY");
  return missing.length ? `缺少环境变量：${missing.join("、")}` : null;
})();

type AppInstance = ReturnType<typeof cloudbase.init>;

/** 全局唯一的 CloudBase 应用实例（禁止在多处重新 init）；配置缺失时为 null。 */
export const app: AppInstance | null = initError
  ? null
  : cloudbase.init({
      env: envId as string,
      region,
      accessKey: publishableKey as string,
      auth: { detectSessionInUrl: true },
    });

/** 供需要“非空调用”的模块取实例；配置缺失时抛出与界面一致的指引错误（调用方有 try/catch 兜底）。 */
export function requireApp(): AppInstance {
  if (!app) throw new Error(`CLOUD_CONFIG_MISSING: ${initError ?? "配置缺失"}`);
  return app;
}

/** Auth 客户端的非空门面（配置缺失时抛指引错误，由调用方 try/catch 兜底）。 */
export function requireAuth(): AppInstance["auth"] {
  return requireApp().auth;
}

/**
 * Auth 客户端。
 * 说明：@cloudbase/js-sdk v3 的官方 Auth 技能写作 `app.auth`（属性）；部分旧文档写作 `app.auth()`。
 * 这里采用属性形式；若某版本报 “app.auth is not a function”，改回 `app.auth()` 即可（待核实：具体版本行为）。
 * 配置缺失时为 null——App.tsx 以 initError 门禁，不会在缺失时调用它。
 */
export const auth = app ? app.auth : (null as unknown as AppInstance["auth"]);

/** PG 数据访问客户端。架构 §9 明确：必须 app.rdb()，查询用 postgREST 风格链式方法。 */
export const db = app
  ? app.rdb()
  : (null as unknown as ReturnType<AppInstance["rdb"]>);

/**
 * 取得“真实登录”的会话（唯一登录判据）。
 * 已核实（postgresql-development / auth-web 技能）：只用 auth.getSession()，不要用 auth.getUser()
 * （后者在无真实用户名密码会话时也可能返回非空包装对象）。
 * 返回 null 表示未登录 / 匿名会话。
 */
export async function getActiveSession(): Promise<{
  uid: string;
  username: string;
} | null> {
  try {
    const { data } = await auth.getSession();
    const session = data?.session;
    if (!session || session.user?.is_anonymous) return null;
    const uid = session.user?.id;
    if (!uid) return null;
    const username = session.user?.user_metadata?.username || String(uid);
    return { uid: String(uid), username: String(username) };
  } catch {
    return null;
  }
}
