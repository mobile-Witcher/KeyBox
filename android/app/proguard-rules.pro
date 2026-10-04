# ─────────────────────────────────────────────────────────────────────────────
# KeyBox 原生端 R8 / ProGuard 规则（release 构建启用 minify + shrinkResources）
#
# 依赖面：OkHttp / Okio（官方内置 consumer 规则）+ 平台内置 org.json +
#         Jetpack Compose（AGP 自动注入规则）。无 kotlinx.serialization / Gson。
# 本文件仅补充「防御性保留」，确保升级依赖后不易因规则缺失而崩溃。
# ─────────────────────────────────────────────────────────────────────────────

# 保留源码元数据，便于线上崩溃栈回溯到行号
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
-keepattributes Signature,InnerClasses,EnclosingMethod
-keepattributes *Annotation*,RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations

# ── OkHttp / Okio ────────────────────────────────────────────────────────────
# 官方 jar 已含 consumer-proguard 规则，这里再显式兜底一层，防止依赖升级后规则丢失。
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-keepclassmembers class okhttp3.** { *; }
-keepclassmembers class okio.** { *; }

# ── org.json ─────────────────────────────────────────────────────────────────
# Android 平台内置（android.jar 提供实现），无需 keep；如未来改用
# kotlinx.serialization / Gson，须追加 @Serializable / @Keep 对应的保留规则。

# ── 应用自身数据模型 ─────────────────────────────────────────────────────────
# 保守保留 data 包下的模型/DTO，避免任何潜在反射访问被裁剪。
-keep class com.keybox.app.data.** { *; }

# ── Android 组件入口（AGP 默认已生成，此处冗余声明以自证）─────────────────────
-keep class com.keybox.app.KeyBoxApplication { *; }
-keep class com.keybox.app.MainActivity { *; }
