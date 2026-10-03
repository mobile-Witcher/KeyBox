namespace KeyBox.Core.Data;

/// <summary>云函数归一化返回体（照安卓 KbFnEnvelope）。</summary>
public sealed record KbFnEnvelope(bool Ok, System.Text.Json.JsonElement? Data, string Error);

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
