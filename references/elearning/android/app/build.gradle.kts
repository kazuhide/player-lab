import java.util.Properties

plugins { id("com.android.application") }

val local = Properties().apply {
    rootProject.file("local.properties").takeIf { it.isFile }?.inputStream()?.use(::load)
}
val dotenv = rootProject.file(".env").takeIf { it.isFile }?.readLines()
    ?.map { it.trim().removePrefix("export ") }
    ?.filter { it.isNotEmpty() && !it.startsWith("#") && it.contains('=') }
    ?.associate { line ->
        val (key, value) = line.split('=', limit = 2)
        key.trim() to value.trim().removeSurrounding("\"").removeSurrounding("'")
    }.orEmpty()
fun setting(property: String, env: String, fallback: String = "") =
    providers.gradleProperty(property).orNull ?: local.getProperty(property)
    ?: System.getenv(env) ?: dotenv[env] ?: fallback
fun literal(value: String) = "\"" + value.replace("\\", "\\\\")
    .replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\""

val referenceAssets = tasks.register<Sync>("referenceAssets") {
    from(rootProject.file("../fixtures")) {
        include("catalog.json", "transcripts/**/*.json")
    }
    into(layout.buildDirectory.dir("generated/referenceAssets/fixtures"))
}

android {
    namespace = "com.playerlab.elearning"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.playerlab.elearning"
        minSdk = 23
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["playerLicenseKey"] = setting("bitmovinLicenseKey", "BITMOVIN_PLAYER_LICENSE_KEY")
        buildConfigField("String", "ANALYTICS_LICENSE_KEY", literal(setting("bitmovinAnalyticsLicenseKey", "BITMOVIN_ANALYTICS_LICENSE_KEY")))
        buildConfigField("String", "MEDIA_BASE_URL", literal(setting("mediaBaseUrl", "MEDIA_BASE_URL", "http://10.0.2.2:8621/")))
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
    sourceSets["main"].assets.directories.add(layout.buildDirectory.dir("generated/referenceAssets").get().asFile.absolutePath)
    testOptions {
        unitTests.all { it.systemProperty("reference.fixtureDir", rootProject.file("../fixtures").absolutePath) }
    }
    lint { abortOnError = true }
}

tasks.named("preBuild").configure { dependsOn(referenceAssets) }

dependencies {
    implementation("com.bitmovin.player:player:3.172.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:core-ktx:1.7.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
}
