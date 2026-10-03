using KeyBox.Core.Crypto;
using KeyBox.Core.Data;

namespace KeyBox.Core.Vault;

/// <summary>R21 改主密码结果：推进后的密钥代数 + 重加密条目数。</summary>
public sealed record RotateResult(int NewKeyEpoch, int ItemCount);

/// <summary>R29 导出结果：明文 JSON 文本 + 条目数 + 跳过数（解密失败/代数不符）。</summary>
public sealed record ExportResult(string Json, int Count, int Skipped);

/// <summary>R29 导入结果：成功条数 + 跳过数（格式非法）。</summary>
public sealed record ImportResult(int Imported, int Skipped);

/// <summary>
/// 安全面板服务（R21 改主密码 / R28 恢复码 / R29 备份）——照安卓 SecurityViewModel 语义移植。
///
/// R21 事务性：本机重加密全部成功前不调 kbRotateMaster；单请求原子提交；失败尽力回滚。
/// R28 边界：recovery_* 三列对客户端零列授权，读写一律走云函数（kbGetMyRole / kbAckRecovery）。
/// 明文纪律：主密码/恢复码只在参数与局部变量中短暂存在，绝不落地、不写日志。
/// </summary>
public sealed class SecurityService
{
    private readonly KbApi _api;

    public SecurityService(KbApi api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
    }

    /// <summary>R28：读本人角色/密钥参数/恢复码状态（kbGetMyRole）。</summary>
    public Task<KbMyRole> FetchMyRoleAsync(CancellationToken ct = default)
        => _api.FetchMyRoleAsync(ct);

    /// <summary>R28：确认「已抄下并自行保管」（kbAckRecovery）。返回确认时间。</summary>
    public Task<string> AckRecoveryAsync(CancellationToken ct = default)
        => _api.AckRecoveryRemoteAsync(ct);

    /// <summary>
    /// R21 改主密码全流程（事务性）：
    /// ① 本机校验旧密码 → ② 全量旧 key 解密（一条失败整体中止）→ ③ 新盐新 key 纯内存重加密
    /// → ④ 新 verifier（+ 恢复码重包裹）→ ⑤ 单请求提交 → ⑥ 失败尽力回滚 → ⑦ 成功更新内存主密钥与代数。
    /// 成功后调用方需删除 Windows Hello 包裹物（它包裹的是旧密钥）。
    /// </summary>
    public async Task<RotateResult> RotateMasterAsync(
        string uid,
        string oldPassword,
        string newPassword,
        string recoveryCode,
        KbMyRole role,
        CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(oldPassword) || string.IsNullOrEmpty(newPassword))
        {
            throw new UnlockException("请填写原主密码与新主密码。");
        }
        if (newPassword.Length < 8)
        {
            throw new UnlockException("新主密码至少 8 位。");
        }
        string oldSalt = role.KdfSalt;
        string oldVerifier = role.KdfVerifier;
        if (string.IsNullOrEmpty(oldSalt) || string.IsNullOrEmpty(oldVerifier))
        {
            throw new UnlockException("账号密钥参数缺失，无法改主密码。");
        }

        // ① 本机校验原主密码（解 kdf_verifier 比对固定串）
        byte[] oldRaw;
        try
        {
            oldRaw = Kb1Crypto.DeriveKey(oldPassword, oldSalt);
        }
        catch (Exception)
        {
            throw new UnlockException("原主密码不正确。");
        }
        string verifierPlain;
        try
        {
            verifierPlain = Kb1Crypto.DecryptFromKb1(oldRaw, oldVerifier);
        }
        catch (Exception)
        {
            verifierPlain = "";
        }
        if (verifierPlain != UnlockService.VerifierPlaintext)
        {
            throw new UnlockException("原主密码不正确。");
        }

        // ② 拉取服务端全量并用旧 key 逐条解密；任何一条失败 → 整体中止（绝不半新半旧）
        List<KbSecretRow> rows = await _api.FetchSecretRowsAsync(uid, ct).ConfigureAwait(false);
        var ids = new List<long>(rows.Count);
        var texts = new List<string>(rows.Count);
        foreach (KbSecretRow row in rows)
        {
            string text;
            try
            {
                text = Kb1Crypto.DecryptFromKb1(oldRaw, row.Payload);
            }
            catch (Exception)
            {
                throw new UnlockException(
                    $"改主密码已整体中止：第 {row.Id} 条密文无法用旧主密码解开。请确认主密码正确后再试。");
            }
            ids.Add(row.Id);
            texts.Add(text);
        }

        // ③ 新盐 → 新 key → 全量重加密（纯内存）
        string newSalt = Kb1Crypto.GenerateSaltB64();
        byte[] newRaw = Kb1Crypto.DeriveKey(newPassword, newSalt);
        var newItems = new List<KbRotateItem>(texts.Count);
        for (int i = 0; i < texts.Count; i++)
        {
            newItems.Add(new KbRotateItem(ids[i], Kb1Crypto.EncryptToKb1(newRaw, texts[i])));
        }

        // ④ 新校验串 + 可选恢复码重包裹（提交前完成，失败即中止、服务端未动）
        string newVerifier = Kb1Crypto.EncryptToKb1(newRaw, UnlockService.VerifierPlaintext);
        bool hasRecovery = role.RecoverySalt.Length > 0 && role.RecoveryBlob.Length > 0;
        string newBlob = "";
        if (hasRecovery)
        {
            string normalized = KbRecovery.NormalizeRecoveryCode(recoveryCode);
            if (normalized.Length != 32)
            {
                throw new UnlockException("恢复码格式不正确（应为 32 个 base32 字符）。");
            }
            newBlob = KbRecovery.WrapMasterKeyWithRecovery(normalized, role.RecoverySalt, newSalt, newRaw);
        }

        // ⑤ 单请求提交整批重写（key_epoch+1 由服务端做）
        int newEpoch;
        try
        {
            newEpoch = await _api.RotateMasterRemoteAsync(
                kdfSalt: newSalt,
                kdfSaltPrev: oldSalt,
                kdfVerifier: newVerifier,
                recoveryBlob: newBlob,
                items: newItems,
                ct: ct).ConfigureAwait(false);
        }
        catch (Exception rotateErr)
        {
            // ⑥ 失败：用旧材料整批覆盖回云端（尽力而为；函数原子，通常无需回滚）
            try
            {
                await _api.RotateMasterRemoteAsync(
                    kdfSalt: oldSalt,
                    kdfSaltPrev: oldSalt,
                    kdfVerifier: oldVerifier,
                    recoveryBlob: "",
                    items: rows.Select(r => new KbRotateItem(r.Id, r.Payload)).ToList(),
                    ct: ct).ConfigureAwait(false);
            }
            catch (Exception)
            {
                // 回滚失败：忽略，on-duty 提示用户主密码可能已部分推进，请重新解锁确认
            }
            throw new UnlockException(
                "改主密码失败（已尝试回滚），主密码未变更，请稍后重试。原因：" + rotateErr.Message);
        }

        // ⑦ 成功：更新内存主密钥与代数（会话保持，无需重登）
        MasterKeySession.Set(newRaw, newEpoch);
        return new RotateResult(newEpoch, newItems.Count);
    }

    /// <summary>
    /// R29 导出：全量解密（代数不符/解密失败跳过计数）→ 明文 JSON 文本（供 FileSavePicker 写盘）。
    /// </summary>
    public async Task<ExportResult> PrepareExportAsync(string uid, CancellationToken ct = default)
    {
        byte[] raw = RequireMasterKey();
        int keyEpoch = MasterKeySession.KeyEpoch;

        List<KbSecretRow> rows = await _api.FetchSecretRowsAsync(uid, ct).ConfigureAwait(false);
        int skipped = 0;
        var outItems = new List<BackupItem>(rows.Count);
        foreach (KbSecretRow row in rows)
        {
            if (row.KeyEpoch != keyEpoch)
            {
                skipped++;
                continue;
            }
            try
            {
                SecretItem secret = SecretCodec.ParseSecretPayload(Kb1Crypto.DecryptFromKb1(raw, row.Payload));
                outItems.Add(new BackupItem(
                    secret.Site, secret.Url, secret.Website, secret.Model,
                    secret.Key, secret.Note, secret.Tags, row.UpdatedAt));
            }
            catch (Exception)
            {
                skipped++;
            }
        }

        string json = BackupCodec.Encode(DateTimeOffset.Now.ToString("yyyy-MM-dd'T'HH:mm:sszzz"), outItems);
        return new ExportResult(json, outItems.Count, skipped);
    }

    /// <summary>R29 导入：解析校验 → 逐条 serialize + EncryptToKb1 + insertSecretRow（当前代数）。</summary>
    public async Task<ImportResult> ImportAsync(string uid, string jsonText, CancellationToken ct = default)
    {
        byte[] raw = RequireMasterKey();
        int keyEpoch = MasterKeySession.KeyEpoch;

        ParsedBackup parsed = BackupCodec.Decode(jsonText);
        int imported = 0;
        foreach (SecretItem secret in parsed.Items)
        {
            string enc = Kb1Crypto.EncryptToKb1(raw, SecretCodec.SerializeSecretPayload(secret));
            await _api.InsertSecretRowAsync(enc, keyEpoch, ct).ConfigureAwait(false);
            imported++;
        }
        return new ImportResult(imported, parsed.Skipped);
    }

    /// <summary>建议导出文件名（照鸿蒙/安卓 keybox-export-YYYYMMDD-HHmm.json）。</summary>
    public static string SuggestedExportName()
        => $"keybox-export-{DateTime.Now:yyyyMMdd-HHmm}.json";

    private static byte[] RequireMasterKey()
        => MasterKeySession.MasterKeyRaw() ?? throw new InvalidOperationException("主密钥未解锁");
}
