using KeyBox.Core.Crypto;
using KeyBox.Core.Data;

namespace KeyBox.Core.Vault;

/// <summary>
/// 主密码解锁（拉取服务端密钥参数 → 派生 → 校验 verifier）。
///
/// 流程照安卓解锁页 / Web verifyMasterPassword：
///   1. GET kb_users 取 kdf_salt / kdf_verifier / key_epoch
///   2. DeriveKey(密码, kdf_salt)（PBKDF2-SHA256，600000 轮）
///   3. DecryptFromKb1(kdf_verifier) == "KeyBox-Verify" 即正确
///   4. 成功 → masterKey 进内存单例（绝不持久化）；失败 → UnlockException「主密码错误」，
///      不暴露具体原因（GCM 校验失败 / 前缀错 / 派生异常统一归为密码错误）。
/// 网络/账号类错误（AuthException）原样上抛，由 UI 区分展示。
/// </summary>
public sealed class UnlockService
{
    /// <summary>主密钥校验固定串（架构 §6.1；与 Web VERIFIER_PLAINTEXT 一致）。它不是密钥，只是判据。</summary>
    public const string VerifierPlaintext = "KeyBox-Verify";

    private readonly KbApi _api;

    public UnlockService(KbApi api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
    }

    /// <summary>主密码解锁：成功写 MasterKeySession；密码错抛 UnlockException。</summary>
    public async Task UnlockWithPasswordAsync(string uid, string password, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(password)) throw new UnlockException("主密码错误");

        // 网络/账号错误原样上抛（不是密码问题）
        KbUserInfo info = await _api.FetchMyKeyInfoAsync(uid, ct).ConfigureAwait(false);
        if (string.IsNullOrEmpty(info.KdfSalt) || string.IsNullOrEmpty(info.KdfVerifier))
        {
            throw new UnlockException("主密码错误");
        }

        byte[] key;
        try
        {
            key = Kb1Crypto.DeriveKey(password, info.KdfSalt);
        }
        catch (Exception)
        {
            throw new UnlockException("主密码错误");
        }

        string plain;
        try
        {
            plain = Kb1Crypto.DecryptFromKb1(key, info.KdfVerifier);
        }
        catch (Exception)
        {
            throw new UnlockException("主密码错误");
        }

        if (plain != VerifierPlaintext)
        {
            throw new UnlockException("主密码错误");
        }

        MasterKeySession.Set(key, info.KeyEpoch);
    }

    /// <summary>
    /// 仅拉取 key_epoch（Windows Hello 解锁路径用：包裹物已含主密钥，但代数需以服务端为准，
    /// 供列表解密做代数比对）。
    /// </summary>
    public async Task<int> FetchKeyEpochAsync(string uid, CancellationToken ct = default)
    {
        KbUserInfo info = await _api.FetchMyKeyInfoAsync(uid, ct).ConfigureAwait(false);
        return info.KeyEpoch;
    }
}
