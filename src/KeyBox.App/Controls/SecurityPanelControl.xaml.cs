using KeyBox.App.Services;
using KeyBox.App.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.Storage.Streams;
using WinRT.Interop;

namespace KeyBox.App.Controls;

/// <summary>
/// 安全面板（ContentDialog 承载）：R21 改主密码 / R28 恢复码 / R29 备份导出导入。
/// 文件选择用 WinUI 原生 FileSavePicker / FileOpenPicker（InitializeWithWindow 绑定主窗口句柄）。
/// 确认区为内联（避免 WinUI 嵌套 ContentDialog 限制）。
/// </summary>
public sealed partial class SecurityPanelControl : UserControl
{
    public SecurityViewModel ViewModel { get; }

    public SecurityPanelControl(SecurityViewModel viewModel)
    {
        ViewModel = viewModel;
        InitializeComponent();
    }

    // ---- R28 恢复码 ----

    private void OnAckRecoveryClick(object sender, RoutedEventArgs e)
    {
        _ = ViewModel.AckRecoveryAsync();
    }

    // ---- R21 改主密码 ----

    private void OnRotateClick(object sender, RoutedEventArgs e)
    {
        ViewModel.RequestRotate();
    }

    private void OnRotateCancelClick(object sender, RoutedEventArgs e)
    {
        ViewModel.DismissRotateConfirm();
    }

    private async void OnRotateConfirmClick(object sender, RoutedEventArgs e)
    {
        await ViewModel.DoRotateAsync();
    }

    // ---- R29 备份导出 ----

    private void OnExportClick(object sender, RoutedEventArgs e)
    {
        ViewModel.RequestExport();
    }

    private void OnExportCancelClick(object sender, RoutedEventArgs e)
    {
        ViewModel.DismissExportConfirm();
    }

    private async void OnExportConfirmClick(object sender, RoutedEventArgs e)
    {
        bool ok = await ViewModel.PrepareExportAsync();
        if (!ok) return;

        var picker = new FileSavePicker
        {
            SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
            SuggestedFileName = KeyBox.Core.Vault.SecurityService.SuggestedExportName(),
        };
        picker.FileTypeChoices.Add("JSON 文件", new List<string> { ".json" });
        InitializeWithWindow.Initialize(picker, WindowHandle);

        StorageFile? file = await picker.PickSaveFileAsync();
        if (file is null)
        {
            ViewModel.CancelExport();
            return;
        }
        await FileIO.WriteTextAsync(file, ViewModel.PendingExportJson, UnicodeEncoding.Utf8);
        ViewModel.NotifyExportWritten();
    }

    // ---- R29 备份导入 ----

    private async void OnImportClick(object sender, RoutedEventArgs e)
    {
        var picker = new FileOpenPicker
        {
            SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
            ViewMode = PickerViewMode.List,
        };
        picker.FileTypeFilter.Add(".json");
        InitializeWithWindow.Initialize(picker, WindowHandle);

        StorageFile? file = await picker.PickSingleFileAsync();
        if (file is null) return;

        string text = await FileIO.ReadTextAsync(file, UnicodeEncoding.Utf8);
        await ViewModel.ImportAsync(text);
    }

    private static IntPtr WindowHandle
        => WindowNative.GetWindowHandle(AppServices.MainWindow!);
}
