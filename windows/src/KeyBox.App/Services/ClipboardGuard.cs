using System;
using Windows.ApplicationModel.DataTransfer;

namespace KeyBox.App;

/// <summary>
/// 剪贴板护栏（真机崩溃修复）。
///
/// 背景：真机上「复制邀请码」会**直接结束进程**。事件日志证据：
///   Microsoft.ui.xaml.dll / stowed exception 0xc000027b，WER 签名 combase.dll + HRESULT <c>0x800401D0</c>
/// 而 0x800401D0 正是 <c>CLIPBRD_E_CANT_OPEN</c>——剪贴板被其它进程（剪贴板管理器、输入法等）占用时，
/// <c>Clipboard.Flush()</c> 会抛异常。原实现裸调剪贴板且无 try/catch，于是瞬时占用就掀翻整个应用
/// （同一段代码在密钥页能跑通，只是因为那一刻剪贴板没被占用——纯时序）。
///
/// 对策：所有剪贴板写入都经此助手，失败只返回 false 由调用方提示重试，绝不让异常逃逸。
/// </summary>
public static class ClipboardGuard
{
    /// <summary>把文本写入剪贴板（并 Flush 使其在退出后仍有效）。成功返回 true；被占用/被策略禁用返回 false。</summary>
    public static bool TrySetText(string text)
    {
        try
        {
            var package = new DataPackage();
            package.SetText(text ?? string.Empty);
            Clipboard.SetContent(package);
            Clipboard.Flush();
            return true;
        }
        catch (Exception)
        {
            // CLIPBRD_E_CANT_OPEN / RPC_E_WRONG_THREAD / 组策略禁用剪贴板等：
            // 都不是致命错误，交给调用方提示「请重试」即可。
            return false;
        }
    }
}