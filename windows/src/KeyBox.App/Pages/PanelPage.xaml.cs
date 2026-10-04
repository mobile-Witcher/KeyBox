using KeyBox.App.Controls;
using KeyBox.App.Services;
using KeyBox.App.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace KeyBox.App.Pages;

/// <summary>
/// W7-F：安全 / 管理 的**独立页面**宿主（原先由 ContentDialog 承载，实例不可复用、也不便深链）。
/// 导航参数区分面板："security"（默认）或 "admin"；
/// 两个面板控件都要求构造函数注入 ViewModel，故在代码里构造后加入 <c>Host</c>。
/// </summary>
public sealed partial class PanelPage : Page
{
    private Func<Task>? _initializeAsync;

    public PanelPage()
    {
        InitializeComponent();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);

        string kind = e.Parameter as string ?? "security";
        if (string.Equals(kind, "admin", StringComparison.OrdinalIgnoreCase))
        {
            TitleText.Text = "管理";
            var admin = new AdminViewModel(AppServices.AdminService, AppServices.CurrentUid);
            Host.Children.Add(new AdminPanelControl(admin));
            _initializeAsync = async () => await admin.InitializeAsync();
        }
        else
        {
            TitleText.Text = "安全";
            var security = new SecurityViewModel(AppServices.SecurityService, AppServices.CurrentUid);
            Host.Children.Add(new SecurityPanelControl(security));
            _initializeAsync = async () => await security.InitializeAsync();
        }

        Loaded += OnLoadedOnce;
    }

    /// <summary>首次加载完成后再拉数据（避免在导航过程中做 IO）。</summary>
    private async void OnLoadedOnce(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoadedOnce;
        if (_initializeAsync is not null)
        {
            await _initializeAsync();
        }
    }

    private void OnBackClick(object sender, RoutedEventArgs e)
    {
        if (Frame.CanGoBack)
        {
            Frame.GoBack();
        }
    }
}
