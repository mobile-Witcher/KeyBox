using KeyBox.Core.Vault;
using Windows.Security.Credentials.UI;

namespace KeyBox.App.Services;

/// <summary>
/// Windows Hello 解锁编排（本批亮点，替代安卓的 BiometricPrompt）：
///   - 首次主密码解锁成功后 EnableAsync：UserConsentVerifier 验证 → DPAPI 包裹 masterKey → hello.bin
///   - 解锁页 TryUnlockAsync：UserConsentVerifier 验证 → 解包 → 拉取 key_epoch → 写内存单例 → 直进列表
///   - Windows Hello 不可用 / 验证未过 / 包裹损坏 → 返回 false，上层自动降级主密码
/// 系统 API 只做「人机验证」；密钥包裹由 Core 的 HelloWrapperStore（DPAPI CurrentUser）负责。
/// </summary>
public sealed class HelloAuthService
{
    private readonly UnlockService _unlock;
    private readonly HelloWrapperStore _store;

    public HelloAuthService(UnlockService unlock, HelloWrapperStore store)
    {
        _unlock = unlock ?? throw new ArgumentNullException(nameof(unlock));
        _store = store ?? throw new ArgumentNullException(nameof(store));
    }

    /// <summary>本机是否已配置 Windows Hello（设备与用户均可用）。</summary>
    public async Task<bool> IsAvailableAsync()
    {
        try
        {
            return await UserConsentVerifier.CheckAvailabilityAsync()
                == UserConsentVerifierAvailability.Available;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>是否已有包裹物存档。</summary>
    public bool HasWrapper => _store.Exists;

    /// <summary>首次主密码解锁后启用：系统验证通过则把 masterKey DPAPI 包裹落盘。返回是否已启用。</summary>
    public async Task<bool> EnableAsync(byte[] masterKeyRaw)
    {
        ArgumentNullException.ThrowIfNull(masterKeyRaw);
        bool verified = await RequestAsync("启用 Windows Hello 解锁 KeyBox");
        if (!verified) return false;
        _store.Save(masterKeyRaw);
        return true;
    }

    /// <summary>
    /// 尝试 Windows Hello 解锁。无包裹物 / 验证未通过 / 包裹损坏 → false（调用方降级主密码）。
    /// 成功 → MasterKeySession 写入（epoch 以服务端为准），返回 true。
    /// </summary>
    public async Task<bool> TryUnlockAsync(string uid, CancellationToken ct = default)
    {
        if (!_store.Exists) return false;

        bool verified = await RequestAsync("使用 Windows Hello 解锁 KeyBox");
        if (!verified) return false;

        byte[]? raw = _store.Load();
        if (raw is null)
        {
            _store.Delete(); // 包裹损坏：清掉并降级主密码
            return false;
        }

        int epoch = await _unlock.FetchKeyEpochAsync(uid, ct);
        MasterKeySession.Set(raw, epoch);
        return true;
    }

    private static async Task<bool> RequestAsync(string message)
    {
        try
        {
            UserConsentVerificationResult result = await UserConsentVerifier.RequestVerificationAsync(message);
            return result == UserConsentVerificationResult.Verified;
        }
        catch (Exception)
        {
            return false;
        }
    }
}
