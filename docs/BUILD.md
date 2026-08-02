# Build pipeline

Aether-GUI uses one GitHub Actions workflow: `.github/workflows/build.yml`.

## Targets

- Windows x86_64
- Linux x86_64
- macOS arm64
- macOS x86_64
- Android arm64-v8a

The workflow downloads the pinned official Aether v1.5.0 binaries, prepares the pinned sing-box desktop sidecar, builds the pinned Android HEV bridge, runs the relevant source/unit checks, and uploads platform artifacts.

## Release boundary

Builds create artifacts only. They do not create, update, or publish GitHub Releases and do not react to version tags. Publishing remains an explicit action after the generated artifacts and Android device behavior are verified.

The first clean build after the Android integration also removes obsolete v0.7.2 releases/tags, previous workflow artifacts, and previous workflow runs. That temporary cleanup step should be removed after the clean build is confirmed.

## Local commands

```bash
npm ci
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Desktop bundle:

```bash
npm run prepare:sidecars
npm run tauri -- build
```

Android ARM64 bundle:

```bash
npm run android:init
npm run prepare:android-native
npm run android:build
```

Android requires JDK 17, Android SDK 36, NDK 28.2.13676358, Rust target `aarch64-linux-android`, and Bash for the pinned native dependency builder.
