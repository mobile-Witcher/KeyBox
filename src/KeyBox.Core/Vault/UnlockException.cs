namespace KeyBox.Core.Vault;

/// <summary>
/// 解锁失败（主密码错误 / 密文损坏等）。UI 只应展示「主密码错误」一类通用文案，
/// 不得把具体原因暴露给用户或日志（与 Web verifyMasterPassword 的失败一律返回 false 同语义）。
/// </summary>
public sealed class UnlockException : Exception
{
    public UnlockException(string message)
        : base(message)
    {
    }
}
