using KeyBox.Core.Data;
using KeyBox.Core.Crypto;

namespace KeyBox.Core.Vault;

/// <summary>
/// 账号激活服务（R01 首次初始化 / R03 邀请码激活）——Windows 端原先只有网页版实现了这两条流程，
/// 导致原生端"未激活的手机号也能登录到解锁页、而拿到邀请码的新同事却无法在原生端开户"。
///
/// 安全边界：只上传 kdf_salt 与 kdf_verifier（verifier 是主密钥对固定串的 KB1 密文），
/// **主密码与主密钥绝不出本进程**；邀请码有效性 / 是否已占用 / 20 人上限全部由 kbRegister 在云端原子判定。
/// </summary>
public sealed class ActivationService
{
    private readonly KbApi _api;

    public ActivationService(KbApi api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
    }

    /// <summary>探针：本账号是否已激活（未激活时给出该去「首次初始化」还是「邀请码激活」）。</summary>
    public Task<ActivationProbe> ProbeAsync(CancellationToken ct = default) => _api.ProbeActivationAsync(ct);

    /// <summary>
    /// 开户 / 初始化：用主密码生成材料并提交。
    /// <paramref name="inviteCode"/> 为空 → 走 kbInitAdmin（仅当系统没有任何用户时才可能成功）；
    /// 非空 → 走 kbRegister（一次性邀请码）。
    /// 成功返回空串，失败返回可直接展示的中文原因。
    /// </summary>
    public async Task<string> ActivateAsync(string? inviteCode, string masterPassword, CancellationToken ct = default)
    {
        string salt = Kb1Crypto.GenerateSaltB64();
        byte[] raw = Kb1Crypto.DeriveKey(masterPassword, salt);
        string verifier = Kb1Crypto.EncryptToKb1(raw, UnlockService.VerifierPlaintext);
        System.Security.Cryptography.CryptographicOperations.ZeroMemory(raw);

        KbFnEnvelope env = string.IsNullOrWhiteSpace(inviteCode)
            ? await _api.InitAdminAsync(salt, verifier, "", "", ct).ConfigureAwait(false)
            : await _api.RegisterAsync(inviteCode.Trim(), salt, verifier, "", "", ct).ConfigureAwait(false);

        return env.Ok ? "" : Describe(env.Error);
    }

    /// <summary>把云函数错误码翻成用户能懂的话（与网页版 RegisterPage/InitPage 的口径一致）。</summary>
    private static string Describe(string code) => code switch
    {
        "INVALID_CODE" => "邀请码无效或已被使用，请向管理员索取新的邀请码",
        "LIMIT_REACHED" => "已达 20 人开户上限，请联系管理员",
        "ALREADY_INITIALIZED" => "系统已有用户，请改用邀请码激活",
        "MISSING_RECOVERY_PARAMS" => "恢复码参数不完整，请重试",
        "" => "激活失败，请稍后重试",
        _ => "激活失败：" + code,
    };
}