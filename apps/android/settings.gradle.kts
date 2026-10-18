pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        // Bitmovin Player Android SDK (§18).
        maven { url = uri("https://artifacts.bitmovin.com/artifactory/public-releases") }
    }
}

rootProject.name = "DvrShowcase"

include(":dvr")

// The app module needs the Android SDK + Bitmovin Maven. Include it automatically
// whenever an SDK is available — CI exports ANDROID_HOME, Android Studio writes
// local.properties — so `:dvr:test` still runs on a bare clone without the SDK.
val androidSdkAvailable = System.getenv("ANDROID_HOME") != null ||
    System.getenv("ANDROID_SDK_ROOT") != null ||
    rootDir.resolve("local.properties").exists()
if (androidSdkAvailable) include(":app")
