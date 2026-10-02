using System.Security.Cryptography;

namespace KeyBox.Core.Vault;

/// <summary>
/// Windows Hello 解锁的包裹物存储：DPAPI（ProtectedData，CurrentUser 作用域）加密主密钥，
/// 落盘 %APPDATA%\KeyBox\hello.bin。
///
/// 安全模型（照安卓 PinLockStore 的包裹语义，只是把 PIN 派生换成系统级 DPAPI）：
///   - 包裹物只对当前 Windows 用户可解（DataProtectionScope.CurrentUser，密钥由系统凭据保护）；
///   - 主密钥明文只在内存（MasterKeySession），落盘的只有 DPAPI 密文；
///   - 包裹物损坏/解不开 → 返回 null，调用方删除并降级主密码解锁。
/// </summary>
public sealed class HelloWrapperStore
{
    /// <summary>默认包裹物路径：%APPDATA%\KeyBox\hello.bin。</summary>
    public static string DefaultPath { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "KeyBox",
        "hello.bin");

    /// <summary>固定附加熵（DPAPI optionalEntropy；与字节内容一起参与加密，非密钥）。</summary>
    private static readonly byte[] Entropy = System.Text.Encoding.UTF8.GetBytes("keybox-hello-wrapper-v1");

    private readonly string _path;

    public HelloWrapperStore(string? path = null)
    {
        _path = string.IsNullOrWhiteSpace(path) ? DefaultPath : path!;
    }

    public string FilePath => _path;

    /// <summary>是否已有 Windows Hello 包裹物。</summary>
    public bool Exists => File.Exists(_path);

    /// <summary>用 DPAPI（CurrentUser）加密主密钥并落盘（原子写：临时文件 + 替换）。</summary>
    public void Save(byte[] masterKeyRaw)
    {
        ArgumentNullException.ThrowIfNull(masterKeyRaw);
        if (masterKeyRaw.Length != 32) throw new ArgumentException("主密钥必须为 32 字节", nameof(masterKeyRaw));
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Windows Hello 解锁仅支持 Windows");
        }

        byte[] protectedBytes = ProtectedData.Protect(masterKeyRaw, Entropy, DataProtectionScope.CurrentUser);

        string? dir = Path.GetDirectoryName(_path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        string tmp = _path + ".tmp";
        File.WriteAllBytes(tmp, protectedBytes);
        File.Move(tmp, _path, overwrite: true);
    }

    /// <summary>解开包裹物返回主密钥原始字节；文件缺失/损坏/非 32 字节一律返回 null（不抛错）。</summary>
    public byte[]? Load()
    {
        if (!File.Exists(_path)) return null;
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            byte[] protectedBytes = File.ReadAllBytes(_path);
            byte[] raw = ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.CurrentUser);
            return raw.Length == 32 ? raw : null;
        }
        catch (Exception ex) when (ex is CryptographicException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>删除包裹物（退出登录 / 用户关闭 Hello 解锁）。</summary>
    public void Delete()
    {
        if (File.Exists(_path)) File.Delete(_path);
    }
}
