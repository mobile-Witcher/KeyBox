namespace KeyBox.Core.Vault;

/// <summary>
/// 主密钥的内存级单例（照安卓 MasterSession / 鸿蒙 session.ets 模式）。
/// masterKeyRaw 原始字节**绝不落盘**（唯一落盘形式是 Windows Hello 的 DPAPI 包裹物）。
/// 生命周期：解锁成功写入，退出登录/锁定清空（先抹零再置空）。
/// </summary>
public static class MasterKeySession
{
    private static byte[]? _raw;

    /// <summary>密钥代数（kb_users.key_epoch，解锁时写入；拉取密文行时做代数比对）。</summary>
    public static int KeyEpoch { get; private set; }

    public static bool IsUnlocked => _raw is not null;

    public static void Set(byte[] value, int epoch)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length != 32) throw new ArgumentException("主密钥必须为 32 字节", nameof(value));
        _raw = (byte[])value.Clone(); // 拷贝一份，避免外部持有/清零影响
        KeyEpoch = epoch;
    }

    /// <summary>取主密钥原始字节（返回拷贝，避免调用方改坏内部状态）。</summary>
    public static byte[]? MasterKeyRaw() => _raw?.Clone() as byte[];

    /// <summary>锁定/退出登录时清空：先抹零再置空。</summary>
    public static void Clear()
    {
        if (_raw is not null)
        {
            Array.Clear(_raw);
            _raw = null;
        }
        KeyEpoch = 0;
    }
}
