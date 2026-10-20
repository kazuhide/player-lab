import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.showcase.app"
    compileSdk = 37

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
    buildFeatures { compose = true }
}

dependencies {
    implementation(project(":dvr"))
    // Pin to the current Bitmovin Player v3 release (§18).
    implementation("com.bitmovin.player:player:3.171.0")

    val composeBom = platform("androidx.compose:compose-bom:2024.10.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")

    // On-device integration test (./gradlew :app:connectedAndroidTest on an emulator).
    // Current stable test tooling supports input injection on Android 16.
    // Source: https://developer.android.com/jetpack/androidx/releases/test
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:core:1.7.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
