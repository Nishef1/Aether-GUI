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

    sourceSets {
        getByName("main") {
            jniLibs.srcDir("src/main/jniLibs")
        }
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
            // All three artifacts are release binaries prepared by the pinned
            // native build. Re-stripping them is unnecessary and can fail for
            // the executable-shaped core and the HEV/JNI shared libraries.
            keepDebugSymbols += setOf(
                "**/libaether_exec.so",
                "**/libaethertun.so",
                "**/libhev-socks5-tunnel.so",
            )
        }
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
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation(project(":tauri-android"))

    testImplementation("junit:junit:4.13.2")
}
