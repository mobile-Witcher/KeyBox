using KeyBox.Core.Admin;
using KeyBox.Core.Auth;
using KeyBox.Core.Data;
using KeyBox.Core.Vault;

namespace KeyBox.App.Services;

/// <summary>
/// 应用级服务容器：会话管理 + RDB 数据访问 + 解锁/密钥库服务 + Windows Hello 解锁。
/// 一次性构造，供 ViewModel 与页面共享；另持有主窗口引用用于导航。
/// 敏感配置来自环境变量或本地 keys.json（已 gitignore，绝不入库）。
/// </summary>
public static class AppServices
{
    public static SessionManager SessionManager { get; }
    public static KbApi KbApi { get; }
    public static UnlockService UnlockService { get; }
    public static VaultService VaultService { get; }
    public static SecurityService SecurityService { get; }
    public static AdminService AdminService { get; }
    public static HelloWrapperStore HelloStore { get; }
    public static HelloAuthService HelloAuth { get; }

    public static MainWindow? MainWindow { get; set; }

    static AppServices()
    {
        var repository = AuthRepository.FromBuildConfig(new HttpClient());
        SessionManager = new SessionManager(repository, new SessionStore());

        // W1 的 401 自动刷新 HttpClient 直接复用：RDB 请求自动附加 Bearer access_token 并 401 续期重试
        KbApi = new KbApi(SessionManager.CreateAuthenticatedClient(), repository.ApiBase);
        UnlockService = new UnlockService(KbApi);
        VaultService = new VaultService(KbApi);
        SecurityService = new SecurityService(KbApi);
        AdminService = new KeyBox.Core.Admin.AdminService(KbApi);
        HelloStore = new HelloWrapperStore();
        HelloAuth = new HelloAuthService(UnlockService, HelloStore);
    }

    /// <summary>当前登录 uid（登录成功后写入会话，重启后从 session.json 恢复）。</summary>
    public static string? CurrentUid => SessionManager.Current?.Uid;

    public static void NavigateToLogin() => MainWindow?.NavigateToLogin();

    public static void NavigateToUnlock() => MainWindow?.NavigateToUnlock();

    public static void NavigateToVault() => MainWindow?.NavigateToVault();

    /// <summary>退出登录：抹零内存主密钥 + 删除 Windows Hello 包裹物 + 删除会话，回登录页。</summary>
    public static void SignOutAndGoLogin()
    {
        MasterKeySession.Clear();
        HelloStore.Delete();
        SessionManager.SignOut();
        MainWindow?.NavigateToLogin();
    }
}
