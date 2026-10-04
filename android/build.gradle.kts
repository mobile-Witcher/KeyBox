// KeyBox 安卓原生端根构建脚本。
// 版本组合（已验证兼容）：JDK 17 / Kotlin 2.0.20 / AGP 8.5.2 / Compose BOM 2024.09.03。
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.jvm) apply false
}
