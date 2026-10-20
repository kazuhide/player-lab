// Resolve a single Kotlin compiler/plugin classpath for AGP's built-in Kotlin,
// Compose and the JVM-only DVR module. Applying AGP remains app-module-only.
plugins {
    id("com.android.application") version "9.1.1" apply false
    kotlin("jvm") version "2.4.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.20" apply false
}
