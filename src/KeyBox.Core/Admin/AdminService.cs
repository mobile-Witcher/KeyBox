using KeyBox.Core.Data;

namespace KeyBox.Core.Admin;

/// <summary>
/// 管理后台服务（R02 邀请码 / R12 用户列表 / R13 停用启用 / R14 删除数据）——照安卓 AdminRepository 语义。
///
/// 设计（架构 §7.1）：能交给数据库做的一律直连、不套云函数——
///   - R12 用户列表：直连 RPC `kb_admin_user_list()`（DEFINER，函数体内 is_admin() 自检）。
///   - R13 停用/启用：直连 rdb 更新（数据库已有「可改他人行」策略 + 「只可改 status 一列」列级 GRANT）。
///   - R14 删除数据：**唯一**走云函数（持 service_role，按单个 uid 收口）。
/// 前端只渲染白名单字段；即使后端多返回也不使用（纵深防御）。
/// </summary>
public sealed class AdminService
{
    /// <summary>R02：20 人开户上限（与云端 lib.js USER_LIMIT / Web / 鸿蒙 / 安卓一致）。</summary>
    public const int UserLimit = 20;

    private readonly KbApi _api;

    public AdminService(KbApi api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
    }

    /// <summary>R12：读取用户列表（管理员）。非管理员被服务端拒绝，错误原样上抛。</summary>
    public Task<List<AdminUserRow>> ListUsersAsync(CancellationToken ct = default)
        => _api.AdminListUsersAsync(ct);

    /// <summary>R13：改某用户 status（仅 active / disabled 两个可提交值；deleted 由 R14 云函数写入）。</summary>
    public Task SetUserStatusAsync(string uid, string status, CancellationToken ct = default)
        => _api.AdminSetUserStatusAsync(uid, status, ct);

    /// <summary>R02：生成一次性邀请码（展示一次，用一次即失效）。</summary>
    public Task<KbInvite> CreateInviteAsync(CancellationToken ct = default)
        => _api.InviteCreateRemoteAsync(ct);

    /// <summary>R02：作废邀请码（仅本次会话刚生成的码可作废；kb_invites 对客户端零授权）。</summary>
    public Task<long> RevokeInviteAsync(string code, CancellationToken ct = default)
        => _api.InviteRevokeRemoteAsync(code, ct);

    /// <summary>R14：删除某用户全部密钥数据，返回删除条数（唯一 service_role 路径）。</summary>
    public Task<int> DeleteUserDataAsync(string uid, CancellationToken ct = default)
        => _api.AdminDeleteUserDataRemoteAsync(uid, ct);
}
