import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// 敏感配置：从 keys.properties（优先）或 local.properties 读取；两个文件均已 gitignore，绝不入库。
// CI 环境读不到真实值时用空串兜底——仅影响运行时联网，不影响编译。
val secretProps = Properties().apply {
    val keysFile = rootProject.file("keys.properties")
    val file = if (keysFile.exists()) keysFile else rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val envId: String = secretProps.getProperty("ENV_ID", "")
val publishableKey: String = secretProps.getProperty("PUBLISHABLE_KEY", "")

android {
    namespace = "com.keybox.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.keybox.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "ENV_ID", "\"$envId\"")
        buildConfigField("String", "PUBLISHABLE_KEY", "\"$publishableKey\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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
