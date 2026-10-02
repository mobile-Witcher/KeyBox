namespace KeyBox.Core.Data;

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
