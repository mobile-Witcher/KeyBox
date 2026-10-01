package com.keybox.app.data

import org.json.JSONArray
import org.json.JSONObject

/** 一条密钥的明文字段（与 Web 端 SecretPlain / 鸿蒙 secretcodec.ets 对齐）。 */
data class SecretItem(
    val site: String,
    val url: String,
    val website: String,
    val model: String,
    val key: String,
    val note: String,
    val tags: List<String>,
)

/**
 * 密钥明文 payload 的解析（纯本机，无网络无加密）。
 * 容错照鸿蒙 toPlain/toTags 模式：缺失/类型不符的字段补空串/空数组，不阻断渲染。
 */
fun parseSecretPayload(json: String): SecretItem {
    val obj = JSONObject(json)
    fun str(name: String): String =
        if (obj.has(name) && !obj.isNull(name)) obj.optString(name) else ""

    val tags = ArrayList<String>()
    if (obj.has("tags") && !obj.isNull("tags")) {
        val arr = obj.optJSONArray("tags")
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val t = arr.optString(i)
                if (t.isNotEmpty() && !tags.contains(t)) {
                    tags.add(t)
                }
            }
        }
    }

    return SecretItem(
        site = str("site"),
        url = str("url"),
        website = str("website"),
        model = str("model"),
        key = str("key"),
        note = str("note"),
        tags = tags,
    )
}

/**
 * 把明文 + tags 序列化成 payload JSON（照鸿蒙 serializePlain / Web serializePlain 口径）：
 * 字段顺序 site/url/website/model/key/note/tags；tags 为空时整个省略 tags 键（与旧数据互通）。
 */
fun serializeSecretPayload(item: SecretItem): String {
    val obj = JSONObject()
    obj.put("site", item.site)
    obj.put("url", item.url)
    obj.put("website", item.website)
    obj.put("model", item.model)
    obj.put("key", item.key)
    obj.put("note", item.note)
    if (item.tags.isNotEmpty()) {
        obj.put("tags", JSONArray(item.tags))
    }
    return obj.toString()
}

/** 规整用户输入的分类串：逗号/中文逗号/顿号分隔，去空白去重（照鸿蒙表单行为）。 */
fun parseTags(raw: String): List<String> = raw.split(',', '，', '、')
    .map { it.trim() }
    .filter { it.isNotEmpty() }
    .distinct()

/** 脱敏展示：sk-c8ab…9f2e 形态（首 7 字符 + 省略号 + 末 4 字符）。 */
fun maskKey(key: String): String = when {
    key.isEmpty() -> "（无密钥）"
    key.length <= 12 -> key
    else -> key.take(7) + "…" + key.takeLast(4)
}
