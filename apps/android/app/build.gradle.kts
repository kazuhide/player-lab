import java.util.Properties

plugins {
    id("com.android.application") version "8.10.0"
    id("org.jetbrains.kotlin.android") version "2.2.21"
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.21"
}

android {
    namespace = "com.showcase.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.showcase.dvr"
        minSdk = 23
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // License keys: `-P` properties win, then local.properties (written by
        // scripts/sync-env.sh from the repo-root .env, or by Android Studio), then
        // empty (CI's licenseless compile). Allow-list applicationId on the license.
        val localProps = Properties()
        rootProject.file("local.properties").takeIf { it.exists() }
            ?.inputStream()?.use { localProps.load(it) }
        fun credential(name: String): String =
            (project.findProperty(name) as String?) ?: localProps.getProperty(name) ?: ""
        manifestPlaceholders["bitmovinLicenseKey"] = credential("bitmovinLicenseKey")
        manifestPlaceholders["bitmovinAnalyticsLicenseKey"] = credential("bitmovinAnalyticsLicenseKey")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    implementation(project(":dvr"))
    // Pin to the current Bitmovin Player v3 release (§18).
    implementation("com.bitmovin.player:player:3.155.0")

    val composeBom = platform("androidx.compose:compose-bom:2024.10.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")

    // On-device integration test (./gradlew :app:connectedAndroidTest on an emulator).
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core:1.6.1")
}
