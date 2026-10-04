namespace KeyBox.Core.Data;

/// <summary>云函数归一化返回体（照安卓 KbFnEnvelope）。</summary>
public sealed record KbFnEnvelope(bool Ok, System.Text.Json.JsonElement? Data, string Error, bool? Initialized = null);

/// <summary>
/// 登录后的"是否已激活"探针结果（R01/R03 门禁，照网页版 api.ts 的 ApiResult.initialized 语义）。
///   Activated   = true：本账号已在 kb_users 中且可取到密钥参数 → 直接进解锁页
///   Initialized = false：系统还没有任何用户 → 前端应引导「首次初始化」（kbInitAdmin）
///   Initialized = true ：系统已有用户但本账号未激活 → 前端应引导「邀请码激活」（kbRegister）
/// </summary>
public sealed record ActivationProbe(bool Activated, bool? Initialized, string Status, string Error)
{
    /// <summary>行存在但被停用/软删：不能放进解锁页，应给出明确提示。</summary>
    public bool IsBlocked => Status is "deleted" or "disabled"
        || Error.Contains("DISABLED", StringComparison.OrdinalIgnoreCase)
        || Error.Contains("DELETED", StringComparison.OrdinalIgnoreCase)
        || Error.Contains("NOT_ACTIVE", StringComparison.OrdinalIgnoreCase);
}

/// <summary>kb_users 的密钥参数行（解锁校验用；照安卓 KbUserInfo）。</summary>
public sealed record KbUserInfo(
    string KdfSalt,
    string KdfVerifier,
    int KeyEpoch);

/// <summary>kb_secrets 一行（只取渲染所需列；照安卓 KbSecretRow）。</summary>
public sealed record KbSecretRow(
    long Id,
    string Payload,
    int KeyEpoch,
    string UpdatedAt);

/// <summary>一条密钥的明文字段（与 Web SecretPlain / 安卓 SecretItem / 鸿蒙 secretcodec 对齐）。</summary>
public sealed record SecretItem(
    string Site,
    string Url,
    string Website,
    string Model,
    string Key,
    string Note,
    List<string> Tags);

/// <summary>本人角色 + 密钥参数 + 恢复码材料状态（kbGetMyRole 返回；recovery_* 仅回本人）。</summary>
public sealed record KbMyRole(
    string Role,
    string Status,
    string KdfSalt,
    string KdfVerifier,
    int KeyEpoch,
    string RecoverySalt,
    string RecoveryBlob,
    string RecoveryAckAt);

/// <summary>kbRotateMaster 的单条重加密密文行。</summary>
public sealed record KbRotateItem(long Id, string Payload);

/// <summary>导出备份的单条明文记录（序列化用；照安卓 BackupItem）。</summary>
public sealed record BackupItem(
    string Site,
    string Url,
    string Website,
    string Model,
    string Key,
    string Note,
    List<string> Tags,
    string UpdatedAt);

/// <summary>解析导入文件的条目结果：合法条目 + 跳过条数。</summary>
public sealed record ParsedBackup(List<SecretItem> Items, int Skipped);

/// <summary>R12 管理员用户列表行（kb_admin_user_list 白名单字段，不含任何密文/敏感列）。</summary>
public sealed record AdminUserRow(
    string Uid,
    string Username,
    string Status,
    string CreatedAt,
    int ItemCount);

/// <summary>R02 一次性邀请码（kbInviteCreate 返回）。</summary>
public sealed record KbInvite(string Code, string CreatedAt);
