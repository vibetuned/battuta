plugins {
    `kotlin-dsl`
}

gradlePlugin {
    plugins {
        create("pluginsForCoolKids") {
            id = "rust"
            implementationClass = "RustPlugin"
        }
    }
}

repositories {
    google()
    mavenCentral()
}

dependencies {
    compileOnly(gradleApi())
    implementation("com.android.tools.build:gradle:9.5.1")
    // AGP 9 brings the Kotlin Gradle plugin 2.2.10 with it, and buildSrc's classes win over the
    // root build script's: without this line the 2.4.10 asked for there is never loaded, and a
    // 2.2 compiler cannot read LiteRT's Kotlin 2.4 metadata (granita's classifier; 2026-11-12).
    implementation("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.10")
}

