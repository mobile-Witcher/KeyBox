using KeyBox.App.ViewModels;
using Microsoft.UI.Xaml.Controls;

namespace KeyBox.App.Controls;

/// <summary>新增/编辑密钥表单（供 ContentDialog 承载；x:Bind 绑定宿主 ViewModel）。</summary>
public sealed partial class EditorFormControl : UserControl
{
    public VaultViewModel ViewModel { get; }

    public EditorFormControl(VaultViewModel viewModel)
    {
        ViewModel = viewModel;
        InitializeComponent();
    }
}
