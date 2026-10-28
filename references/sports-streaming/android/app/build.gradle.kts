plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val localConfig = rootProject.file(".env").takeIf { it.isFile }?.readLines()
    ?.filter { it.isNotBlank() && !it.trimStart().startsWith("#") }
    ?.mapNotNull { line ->
        val separator = line.indexOf('=')
        if (separator <= 0) null else line.take(separator).trim() to
            line.drop(separator + 1).trim().removeSurrounding("\"").removeSurrounding("'")
    }?.toMap().orEmpty()
fun config(name: String, fallback: String = "") =
    providers.environmentVariable(name).orNull ?: localConfig[name] ?: fallback
fun quoted(value: String) = "\"" + value.replace("\\", "\\\\")
    .replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\""

android {
    namespace = "com.playerlab.sportsstreaming"
    compileSdk { version = release(37) { minorApiLevel = 0 } }
    defaultConfig {
        applicationId = "com.playerlab.sportsstreaming"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "PLAYER_LICENSE_KEY", quoted(config("BITMOVIN_PLAYER_LICENSE_KEY")))
        buildConfigField("String", "ANALYTICS_LICENSE_KEY", quoted(config("BITMOVIN_ANALYTICS_LICENSE_KEY")))
        buildConfigField("String", "MEDIA_BASE_URL", quoted(config("MEDIA_BASE_URL", "http://10.0.2.2:8622/")))
        buildConfigField("String", "CATALOG_URL", quoted(config("CATALOG_URL")))
        buildConfigField("String", "ANALYTICS_URL", quoted(config("ANALYTICS_URL", "http://localhost:9052/")))
    }
    buildFeatures { buildConfig = true; compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions.unitTests.all { it.systemProperty("sports.manifest", file("src/main/AndroidManifest.xml").absolutePath) }
    sourceSets["main"].assets.directories.add(layout.buildDirectory.dir("generated/catalog").get().asFile.absolutePath)
}
val syncCatalog by tasks.registering(Sync::class) {
    from(rootProject.file("../fixtures")) { include("catalog.json") }
    into(layout.buildDirectory.dir("generated/catalog"))
}
tasks.named("preBuild").configure { dependsOn(syncCatalog) }

dependencies {
    implementation("com.bitmovin.player:player:3.172.0")
    implementation(platform("androidx.compose:compose-bom:2024.10.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.12.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.12.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.10.0")
    implementation("androidx.mediarouter:mediarouter:1.8.1")
    implementation("com.google.android.gms:play-services-cast-framework:22.2.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:rules:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
