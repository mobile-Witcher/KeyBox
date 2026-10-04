package com.keybox.app.data

/**
 * 主密钥的内存级单例（照鸿蒙 session.ets 模式移植）。
 *
 * masterKeyRaw：原始字节不放任何可序列化存储（有落盘退化风险），
 * 用伴生对象单例持有。生命周期：解锁成功写入，退出登录清空，**绝不持久化**。
 */
object MasterSession {

    private var raw: ByteArray? = null

    /** 密钥代数（kb_users.key_epoch，解锁时写入；拉取密文行时做代数比对）。 */
    var keyEpoch: Int = 0
        private set

    val isUnlocked: Boolean
        get() = raw != null

    fun setMasterKey(value: ByteArray, epoch: Int) {
        raw = value.copyOf() // 拷贝一份，避免外部持有/清零影响
        keyEpoch = epoch
    }

    /** 取主密钥原始字节（返回拷贝，避免调用方改坏内部状态）。 */
    fun masterKeyRaw(): ByteArray? = raw?.copyOf()

    /** 退出登录/锁定时清空：先抹零再置空。 */
    fun clear() {
        raw?.fill(0)
        raw = null
        keyEpoch = 0
    }
}
