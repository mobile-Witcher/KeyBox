using System.Runtime.InteropServices;

namespace KeyBox.App.Services;

/// <summary>
/// 全局快捷键（Win32 RegisterHotKey）：默认 Ctrl+Shift+K 唤起窗口。
/// 通过 SetWindowSubclass 挂接主窗口消息钩子接收 WM_HOTKEY（WinUI 3 不暴露 WndProc）；
/// Dispose 时 UnregisterHotKey + RemoveWindowSubclass 彻底释放。
/// </summary>
public sealed class GlobalHotKeyService : IDisposable
{
    private const int WM_HOTKEY = 0x0312;
    private const uint MOD_NOREPEAT = 0x4000;
    private const uint VK_K = 0x4B;
    private const int HotKeyId = 0xB01;

    private readonly IntPtr _hwnd;
    private readonly Action _onPressed;
    private readonly SubclassProc _subclassProc;
    private bool _registered;

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate IntPtr SubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, UIntPtr uIdSubclass, IntPtr dwRefData);

    [DllImport("comctl32.dll", SetLastError = true)]
    private static extern bool SetWindowSubclass(IntPtr hWnd, SubclassProc pfnSubclass, UIntPtr uIdSubclass, IntPtr dwRefData);

    [DllImport("comctl32.dll", SetLastError = true)]
    private static extern bool RemoveWindowSubclass(IntPtr hWnd, SubclassProc pfnSubclass, UIntPtr uIdSubclass);

    [DllImport("comctl32.dll")]
    private static extern IntPtr DefSubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    public GlobalHotKeyService(IntPtr windowHandle, Action onPressed)
    {
        _hwnd = windowHandle;
        _onPressed = onPressed;
        _subclassProc = SubclassCallback; // 必须持有委托引用，防止被 GC
    }

    private IntPtr SubclassCallback(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, UIntPtr idSubclass, IntPtr refData)
    {
        if (uMsg == WM_HOTKEY && (int)wParam == HotKeyId)
        {
            try
            {
                _onPressed();
            }
            catch
            {
                // 快捷键回调异常不影响消息循环
            }
            return new IntPtr(1); // 已处理
        }
        return DefSubclassProc(hWnd, uMsg, wParam, lParam);
    }

    /// <summary>注册 Ctrl+Shift+K。返回 false 表示注册失败（如已被其它程序占用），不抛错。</summary>
    public bool Register()
    {
        if (_registered) return true;
        if (!SetWindowSubclass(_hwnd, _subclassProc, (UIntPtr)HotKeyId, IntPtr.Zero))
        {
            return false;
        }
        // MOD_CONTROL(0x0002) | MOD_SHIFT(0x0004) | MOD_NOREPEAT
        _registered = RegisterHotKey(_hwnd, HotKeyId, 0x0002 | 0x0004 | MOD_NOREPEAT, VK_K);
        if (!_registered)
        {
            RemoveWindowSubclass(_hwnd, _subclassProc, (UIntPtr)HotKeyId);
        }
        return _registered;
    }

    public void Dispose()
    {
        if (_registered)
        {
            UnregisterHotKey(_hwnd, HotKeyId);
            _registered = false;
        }
        RemoveWindowSubclass(_hwnd, _subclassProc, (UIntPtr)HotKeyId);
    }
}
