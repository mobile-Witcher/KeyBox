using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KeyBox.Core.Auth;

namespace KeyBox.App.ViewModels;

/// <summary>
/// 占位主窗口 ViewModel：显示已登录 + uid + 退出登录。
/// 密钥列表等核心功能由 W2 批提供。
/// </summary>
public partial class HomeViewModel : ObservableObject
{
    private readonly SessionManager _sessionManager;

    /// <summary>退出登录成功后触发（页面据此回登录页）。</summary>
    public event Action? LogoutRequested;

    [ObservableProperty]
    private string _uid = "";

    [ObservableProperty]
    private string _welcomeText = "";

    public HomeViewModel(SessionManager sessionManager)
    {
        _sessionManager = sessionManager;
    }

    /// <summary>进入页面时刷新展示（内存会话优先，其次本地存储）。</summary>
    public void LoadSession()
    {
        Session? session = _sessionManager.Current ?? _sessionManager.LoadFromStore();
        Uid = session?.Uid ?? "(未登录)";
        WelcomeText = session is null ? "未登录" : "已登录";
    }

    [RelayCommand]
    private void Logout()
    {
        _sessionManager.SignOut();
        LogoutRequested?.Invoke();
    }
}
