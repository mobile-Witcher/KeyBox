/**
 * App.tsx —— 应用外壳与最简页面流转（第 4 步：账号与权限）。
 *
 * 流转规则：
 *   - 有会话 → 主界面（本步骤先给占位；VaultPage 在第 6 步实现）。
 *   - 无会话且本机标记“未初始化” → InitPage（R01：仅首次出现）。
 *   - 否则 → LoginPage（可跳 RegisterPage，R03/R04）。
 *
 * 说明：本步骤未引入路由库，用受控状态在页面间切换，减少依赖面。
 *   “是否已初始化”的判断：以本机标记为主；若换设备误入初始化页，云函数会以
 *   ALREADY_INITIALIZED 拒绝（R01 的服务端兜底），届时引导去登录。
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "./lib/api";
import { auth, initError } from "./lib/cloudbase";
import { log } from "./lib/log";
import AdminPage from "./pages/AdminPage";
import InitPage from "./pages/InitPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import VaultPage from "./pages/VaultPage";

type Screen = "loading" | "init" | "login" | "register" | "home" | "admin" | "config-error";

/** 本机“已完成初始化”标记；与服务端 kb_users 非空共同构成“不再出现初始化页”的判据。 */
const INIT_FLAG_KEY = "keybox.initialized";

export default function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>("loading");
  const [displayName, setDisplayName] = useState<string>("");
  const [role, setRole] = useState<string>("user");

  useEffect(() => {
    // 配置缺失时不触碰任何云端调用——渲染指引页（否则打包环境缺 VITE_ 变量会白屏）。
    if (initError) {
      setScreen("config-error");
      return;
    }
    let alive = true;
    (async () => {
      try {
        const { data } = await auth.getSession();
        const session = data?.session;
        const hasSession = Boolean(session) && !session?.user?.is_anonymous;
        if (hasSession && alive) {
          const user = session?.user;
          setDisplayName(user?.user_metadata?.username || user?.id || "已登录用户");
          setScreen("home");
          // 取角色以决定是否显示“管理后台”入口（角色判定在云端，前端不写死）
          const roleRes = await api.getMyRole();
          if (alive && roleRes.ok && roleRes.data) setRole(roleRes.data.role);
          return;
        }
      } catch (error) {
        log.warn("读取会话失败", error);
      }
      if (!alive) return;
      const initialized = localStorage.getItem(INIT_FLAG_KEY) === "1";
      setScreen(initialized ? "login" : "init");
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleInitialized = useCallback(() => {
    localStorage.setItem(INIT_FLAG_KEY, "1");
    setScreen("login");
  }, []);

  const handleLoggedIn = useCallback(async (username: string) => {
    setDisplayName(username);
    setScreen("home");
    // 登录后取角色（决定是否显示管理后台入口）
    const roleRes = await api.getMyRole();
    if (roleRes.ok && roleRes.data) setRole(roleRes.data.role);
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await auth.signOut();
    } catch (error) {
      log.warn("登出失败", error);
    }
    setScreen("login");
  }, []);

  if (screen === "loading") {
    return <CenteredMessage text="正在启动…" />;
  }

  // 配置缺失（例如从源码构建时未填 .env.local）：给出明确指引，而不是白屏。
  if (screen === "config-error") {
    return (
      <CenteredMessage
        text="应用配置缺失，无法连接云端。"
        hint={`${initError}。如果你是从源码构建：请复制 .env.example 为 .env.local，填入你的 CloudBase 环境 ID 与 Publishable Key 后重新构建；安装包用户请重新下载官方构建产物。`}
      />
    );
  }

  if (screen === "init") {
    return <InitPage onInitialized={handleInitialized} onGoLogin={() => setScreen("login")} />;
  }

  if (screen === "login") {
    return (
      <LoginPage
        onLoggedIn={handleLoggedIn}
        onGoRegister={() => setScreen("register")}
      />
    );
  }

  if (screen === "register") {
    return (
      <RegisterPage
        onRegistered={handleLoggedIn}
        onGoLogin={() => setScreen("login")}
      />
    );
  }

  // home：主界面（密钥库；管理员额外显示“管理后台”入口）
  if (screen === "home") {
    return (
      <VaultPage
        username={displayName}
        onSignOut={handleSignOut}
        onOpenAdmin={role === "admin" ? () => setScreen("admin") : undefined}
      />
    );
  }

  // admin：管理后台（第 8 步，仅管理员可达）
  if (screen === "admin") {
    return (
      <AdminPage
        username={displayName}
        onSignOut={handleSignOut}
        onBack={() => setScreen("home")}
      />
    );
  }

  // 兜底（理论不可达）
  return (
    <CenteredMessage
      text="状态异常，请刷新页面。"
      action={{ label: "退出登录", onClick: handleSignOut }}
    />
  );
}

interface CenteredMessageProps {
  text: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}

/** 居中提示块（骨架期用于 loading / home 占位）。 */
function CenteredMessage({ text, hint, action }: CenteredMessageProps): JSX.Element {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h1 className="text-xl font-semibold">KeyBox</h1>
        <p className="mt-3 text-slate-700 dark:text-slate-200">{text}</p>
        {hint ? <p className="mt-2 text-sm text-slate-500">{hint}</p> : null}
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-6 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900"
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
