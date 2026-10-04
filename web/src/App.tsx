/**
 * App.tsx —— 应用外壳与页面流转。
 *
 * 【2026-09-29 变更】登录改为平台原生手机号验证码，页面流转规则随之简化：
 *   - 无平台会话 → LoginPage（手机号 + 验证码）
 *   - 有会话但尚未激活 → kbGetMyRole 返回 USER_NOT_FOUND，按其附带的 `initialized` 分流：
 *       initialized=false（系统还没有任何用户）→ InitPage（首次初始化，建管理员）
 *       initialized=true （系统已有用户）      → RegisterPage（输入邀请码激活）
 *   - 有会话且已激活 → 主界面（VaultPage；管理员可进管理后台）
 *
 * 为什么去掉“本机已初始化标记”：该标记一旦与服务端不一致（清空服务端、换设备）就会把用户
 * 卡在无账号可登的死角。现在**一切以服务端状态为权威**，不存在这类死锁。
 *
 * 说明：未引入路由库，用受控状态在页面间切换，减少依赖面。
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

interface Resolved {
  screen: Screen;
  role: string;
  displayName: string;
}

/** 读取平台会话并决定该进哪一页（服务端状态为唯一权威）。 */
async function resolveScreen(): Promise<Resolved> {
  try {
    const { data } = await auth.getSession();
    const session = data?.session;
    const hasSession = Boolean(session) && !session?.user?.is_anonymous;
    if (!hasSession) return { screen: "login", role: "user", displayName: "" };

    const user = session?.user;
    const displayName = user?.user_metadata?.username || user?.id || "已登录用户";

    const roleRes = await api.getMyRole();
    if (roleRes.ok && roleRes.data) {
      return { screen: "home", role: roleRes.data.role, displayName };
    }
    if (roleRes.error === "USER_NOT_FOUND") {
      // 未激活：系统是否已有用户决定去「初始化」还是「邀请码激活」
      return { screen: roleRes.initialized ? "register" : "init", role: "user", displayName };
    }
    // 其他错误（网络/会话失效等）→ 退回登录页
    log.warn("解析页面失败", roleRes.error);
    return { screen: "login", role: "user", displayName };
  } catch (error) {
    log.warn("读取会话失败", error);
    return { screen: "login", role: "user", displayName: "" };
  }
}

export default function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>("loading");
  const [displayName, setDisplayName] = useState<string>("");
  const [role, setRole] = useState<string>("user");

  /** 重新解析并落到目标页面（登录成功 / 激活完成 / 启动时统一走这里）。 */
  const refresh = useCallback(async (): Promise<void> => {
    const next = await resolveScreen();
    setDisplayName(next.displayName);
    setRole(next.role);
    setScreen(next.screen);
  }, []);

  useEffect(() => {
    // 配置缺失时不触碰任何云端调用——渲染指引页（否则打包环境缺 VITE_ 变量会白屏）。
    if (initError) {
      setScreen("config-error");
      return undefined;
    }
    let alive = true;
    void (async () => {
      const next = await resolveScreen();
      if (!alive) return;
      setDisplayName(next.displayName);
      setRole(next.role);
      setScreen(next.screen);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await auth.signOut();
    } catch (error) {
      log.warn("登出失败", error);
    }
    setDisplayName("");
    setRole("user");
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

  if (screen === "login") {
    return <LoginPage onLoggedIn={() => void refresh()} />;
  }

  if (screen === "init") {
    return <InitPage onInitialized={() => void refresh()} onSignOut={() => void handleSignOut()} />;
  }

  if (screen === "register") {
    return <RegisterPage onRegistered={() => void refresh()} onSignOut={() => void handleSignOut()} />;
  }

  // home：主界面（密钥库；管理员额外显示“管理后台”入口）
  if (screen === "home") {
    return (
      <VaultPage
        username={displayName}
        onSignOut={() => void handleSignOut()}
        onOpenAdmin={role === "admin" ? () => setScreen("admin") : undefined}
      />
    );
  }

  // admin：管理后台（仅管理员可达）
  if (screen === "admin") {
    return (
      <AdminPage
        username={displayName}
        onSignOut={() => void handleSignOut()}
        onBack={() => setScreen("home")}
      />
    );
  }

  // 兜底（理论不可达）
  return (
    <CenteredMessage
      text="状态异常，请刷新页面。"
      action={{ label: "退出登录", onClick: () => void handleSignOut() }}
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
      <div className="w-full max-w-md rounded-xl border border-kb-border bg-kb-surface p-8 text-center shadow-sm dark:border-kb-border dark:bg-kb-surface">
        <h1 className="text-xl font-semibold">KeyBox</h1>
        <p className="mt-3 text-kb-text">{text}</p>
        {hint ? <p className="mt-2 text-sm text-kb-muted">{hint}</p> : null}
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-6 rounded-lg kb-btn-primary"
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
