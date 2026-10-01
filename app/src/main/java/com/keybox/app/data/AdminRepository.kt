package com.keybox.app.data

/**
 * 管理后台数据访问（R02 邀请码 / R12 用户列表 / R13 停用启用 / R14 删除数据）。
 *
 * 设计（架构 §7.1）：能交给数据库做的一律直连、不套云函数——
 *   - R12 用户列表：直连 RPC `kb_admin_user_list()`（DEFINER，函数体内已 is_admin() 自检）。
 *   - R13 停用/启用：直连 rdb 更新（数据库已有「可改他人行」策略 + 「只可改 status 一列」列级 GRANT）。
 *   - R14 删除数据：**唯一**走云函数（持 service_role，按单个 uid 收口）。
 *
 * 前端只渲染白名单字段；即使后端多返回也不使用（纵深防御）。
 * 本类仅做「会话 → KbApi」的薄封装，保证调用侧无需自行取 accessToken。
 */
class AdminRepository(private val kbApi: KbApi, private val sessionStore: SessionStore) {

    /** R12：读取用户列表（管理员）。会话缺失时抛异常。 */
    suspend fun listUsers(): List<AdminUserRow> =
        kbApi.adminListUsers(requireToken())

    /** R13：改某用户 status（仅 active / disabled 两个可提交值）。 */
    suspend fun setUserStatus(uid: String, status: String): Unit {
        if (uid.isEmpty()) throw AuthApiException("MISSING_UID")
        kbApi.adminSetUserStatus(uid, status, requireToken())
    }

    /** R02：生成一次性邀请码。 */
    suspend fun createInvite(): KbInvite = kbApi.inviteCreateRemote(requireToken())

    /** R02：作废邀请码，返回作废的 codeId。 */
    suspend fun revokeInvite(code: String): Long = kbApi.inviteRevokeRemote(code, requireToken())

    /** R14：删除某用户全部密钥数据，返回删除条数。 */
    suspend fun deleteUserData(uid: String): Int {
        if (uid.isEmpty()) throw AuthApiException("MISSING_UID")
        return kbApi.adminDeleteUserDataRemote(uid, requireToken())
    }

    private fun requireToken(): String =
        sessionStore.load()?.accessToken ?: throw AuthApiException("登录态缺失，请重新登录")
}
