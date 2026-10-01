package com.keybox.app.data

import org.json.JSONArray
import org.json.JSONObject

/** 导出备份的单条明文记录（序列化用；照鸿蒙 BackupItem）。 */
data class BackupItem(
    val site: String,
    val url: String,
    val website: String,
    val model: String,
    val key: String,
    val note: String,
    val tags: List<String>,
    val updatedAt: String,
)

/** 解析导入文件的条目结果：合法条目 + 跳过条数。 */
data class ParsedBackup(
    val items: List<SecretItem>,
    val skipped: Int,
)

/**
 * R29 备份 JSON 编解码（明文；纯本机，无加密）。
 *
 * 文件结构：{ app:"KeyBox", version:1, exportedAt, items:[{site,url,website,model,key,note,tags,updated_at}] }
 * 字段校验照鸿蒙 doImport：site/key 必填，缺失或非法的条目跳过并计数。
 */
object BackupCodec {

    private const val APP = "KeyBox"
    private const val VERSION = 1
    private const val IMPORT_MAX_BYTES = 10 * 1024 * 1024

    /** 导出条目列表 → JSON 文本。 */
    fun encode(exportedAt: String, items: List<BackupItem>): String {
        val arr = JSONArray()
        for (item in items) {
            val obj = JSONObject()
                .put("site", item.site)
                .put("url", item.url)
                .put("website", item.website)
                .put("model", item.model)
                .put("key", item.key)
                .put("note", item.note)
                .put("updated_at", item.updatedAt)
                .put("tags", JSONArray(item.tags))
            arr.put(obj)
        }
        val root = JSONObject()
            .put("app", APP)
            .put("version", VERSION)
            .put("exportedAt", exportedAt)
            .put("items", arr)
        return root.toString(2)
    }

    /**
     * JSON 文本 → 合法条目（site/key 必填，tags 规整去重）；非法条目跳过计数。
     * 文件结构非法（缺 items 数组）或超 10MB 抛异常。
     */
    fun decode(text: String): ParsedBackup {
        if (text.toByteArray(Charsets.UTF_8).size > IMPORT_MAX_BYTES) {
            throw IllegalArgumentException("文件过大（超过 10MB），疑似不是 KeyBox 导出文件")
        }
        val root = try {
            JSONObject(text)
        } catch (e: Exception) {
            throw IllegalArgumentException("文件不是合法 JSON")
        }
        if (!root.has("items") || root.isNull("items")) {
            throw IllegalArgumentException("文件结构不是 KeyBox 导出（缺少 items 数组）")
        }
        val arr = root.optJSONArray("items")
            ?: throw IllegalArgumentException("文件结构不是 KeyBox 导出（items 不是数组）")

        val out = ArrayList<SecretItem>(arr.length())
        var skipped = 0
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i)
            if (obj == null) {
                skipped += 1
                continue
            }
            val site = obj.optString("site").trim()
            val key = obj.optString("key")
            // 站点名与密钥是必填（与新增对话框一致），缺一跳过
            if (site.isEmpty() || key.isEmpty()) {
                skipped += 1
                continue
            }
            out.add(
                SecretItem(
                    site = site,
                    url = obj.optString("url").trim(),
                    website = obj.optString("website").trim(),
                    model = obj.optString("model").trim(),
                    key = key,
                    note = obj.optString("note"),
                    tags = normalizeTags(obj),
                ),
            )
        }
        return ParsedBackup(items = out, skipped = skipped)
    }

    /** tags 缺失/非数组补空数组；去空白、去重（照 toTags 语义）。 */
    private fun normalizeTags(obj: JSONObject): List<String> {
        if (!obj.has("tags") || obj.isNull("tags")) return emptyList()
        val arr = obj.optJSONArray("tags") ?: return emptyList()
        val out = ArrayList<String>()
        for (i in 0 until arr.length()) {
            val t = arr.optString(i).trim()
            if (t.isNotEmpty() && !out.contains(t)) out.add(t)
        }
        return out
    }
}
