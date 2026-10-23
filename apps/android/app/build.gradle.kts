import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.playerlab.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.playerlab.android"
        testApplicationId = "com.playerlab.android.test"
        minSdk = 23
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.4"
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
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    implementation(project(":playback"))
    // Pin to the current Bitmovin Player v3 release (§18).
    implementation("com.bitmovin.player:player:3.171.0+jason")
    implementation("com.bitmovin.player:player-media-session:3.171.0+jason")
    implementation("com.google.android.gms:play-services-cronet:18.1.1")
    // Keep Android 23 support with distinct namespaces for the Cronet API/shared artifacts.
    implementation("org.chromium.net:cronet-api:143.7445.0")
    implementation("com.google.ads.interactivemedia.v3:interactivemedia:3.38.0")
    // Required by the SDK offline download service.
    // https://developer.bitmovin.com/playback/docs/working-with-offline-playback-android
    implementation("androidx.localbroadcastmanager:localbroadcastmanager:1.1.0")
    // Interpreter-only execution of explicitly applied local callback programs.
    // The Java 8 maintenance line supports this app's Android 23 minimum.
    implementation("org.mozilla:rhino:1.7.15.1")

    val composeBom = platform("androidx.compose:compose-bom:2024.10.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    testImplementation("junit:junit:4.13.2")

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
