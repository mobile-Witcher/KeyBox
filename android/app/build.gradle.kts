import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// ────────────────────────────────────────────────────────────────────────────
// 敏感配置（非签名）：从 keys.properties（优先）或 local.properties 读取；
// 两个文件均已 gitignore，绝不入库。CI 环境读不到真实值时用空串兜底——
// 仅影响运行时联网，不影响编译。
// ────────────────────────────────────────────────────────────────────────────
val secretProps = Properties().apply {
    val keysFile = rootProject.file("keys.properties")
    val file = if (keysFile.exists()) keysFile else rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
// 优先读环境变量（CI 注入），其次 keys.properties / local.properties。
// 环境变量方案不受 Gradle 配置缓存影响，避免 CI 复用了缓存里的空值。
val envId: String = (System.getenv("KEYBOX_ENV_ID") ?: "") .ifEmpty { secretProps.getProperty("ENV_ID", "") }
val publishableKey: String = (System.getenv("KEYBOX_PUBLISHABLE_KEY") ?: "") .ifEmpty { secretProps.getProperty("PUBLISHABLE_KEY", "") }

// ────────────────────────────────────────────────────────────────────────────
// Release 签名配置：从 key.properties 读取（依次尝试仓库根目录 → app 模块目录）。
// 该文件由本地手工填写或 CI 从 GitHub Secrets 解码生成，均已 gitignore，绝不入库。
//
// 优雅降级：key.properties 不存在、或四个字段任一缺失时 hasSigningConfig=false，
// release 构建产出【未签名】包而非直接失败——保证本地无 keystore 也能 assembleDebug。
//
// key.properties 字段（见 key.properties.example）：
//   storeFile=keybox-release.jks      keystore 路径（相对仓库根目录或绝对路径）
//   storePassword=****                keystore 口令
//   keyAlias=keybox                   密钥别名
//   keyPassword=****                  该别名口令
// ────────────────────────────────────────────────────────────────────────────
val keyPropsFile = listOf(
    rootProject.file("key.properties"),
    project.file("key.properties"),
).firstOrNull { it.exists() }

val keyProps = Properties().apply {
    if (keyPropsFile != null) keyPropsFile.inputStream().use { load(it) }
}

val keystorePath: String? = keyProps.getProperty("storeFile")
val hasSigningConfig: Boolean = keyPropsFile != null &&
    !keystorePath.isNullOrBlank() &&
    !keyProps.getProperty("storePassword").isNullOrBlank() &&
    !keyProps.getProperty("keyAlias").isNullOrBlank() &&
    !keyProps.getProperty("keyPassword").isNullOrBlank()

android {
    namespace = "com.keybox.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.mobilewitcher.keybox"
        minSdk = 26
        targetSdk = 35
        // 原生端独立版本线（与 Web/Capacitor 端 0.2.0 不冲突，二者为不同产物）。
        versionCode = 5
        versionName = "0.5.0"

        buildConfigField("String", "ENV_ID", "\"$envId\"")
        buildConfigField("String", "PUBLISHABLE_KEY", "\"$publishableKey\"")
    }

    signingConfigs {
        if (hasSigningConfig) {
            create("release") {
                storeFile = rootProject.file(keystorePath!!)
                storePassword = keyProps.getProperty("storePassword")
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // R8 代码压缩 + 资源压缩；规则见 app/proguard-rules.pro。
            // （依赖面很小：OkHttp/Okio 走官方 consumer 规则，JSON 用平台内置 org.json，
            //  无 kotlinx.serialization / Gson，因此规则集精简且已验证可通过。）
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // 有签名材料时挂载 release 签名；否则保持未签名（仅本地/CI 联调）。
            if (hasSigningConfig) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.core) // A3 卡片编辑/删除、搜索、FAB 图标

    // A1 批只引入 OkHttp + 协程；A2 增补 biometric（三层解锁）与 datastore（包裹物存储）
    implementation(project(":core-crypto")) // 解锁/解密直接调用共享加密层
    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.datastore.preferences)

    debugImplementation(libs.androidx.ui.tooling)
}
