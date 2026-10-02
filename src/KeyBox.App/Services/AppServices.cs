using KeyBox.Core.Auth;

namespace KeyBox.App.Services;

/// <summary>
/// 应用级服务容器：会话管理（登录 / 刷新 / 持久化）一次性构造，
/// 供 ViewModel 与页面共享；另持有主窗口引用用于导航。
/// </summary>
public static class AppServices
{
    public static SessionManager SessionManager { get; }

    public static MainWindow? MainWindow { get; set; }

    static AppServices()
    {
        // 敏感配置来自环境变量或本地 keys.json（已 gitignore，绝不入库）
        var repository = AuthRepository.FromBuildConfig(new HttpClient());
        SessionManager = new SessionManager(repository, new SessionStore());
    }

    public static void NavigateToHome() => MainWindow?.NavigateToHome();

    public static void NavigateToLogin() => MainWindow?.NavigateToLogin();
}
