plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.cluvexstudio.aethergui.vpn"
    compileSdk = 36

    defaultConfig {
        minSdk = 29
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    // ActivityResult is part of androidx.activity and is not exported by the
    // generated tauri-android module to plugin consumers. Keep this aligned
    // with Tauri 2.11.5's Android application template.
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation(project(":tauri-android"))

    testImplementation("junit:junit:4.13.2")
}
