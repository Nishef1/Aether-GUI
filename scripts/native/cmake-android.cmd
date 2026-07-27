@echo off
if "%~1"=="--build" goto build
"C:\Program Files\CMake\bin\cmake.exe" %* -DCMAKE_SYSTEM_NAME=Android -DCMAKE_SYSTEM_VERSION=29 -DCMAKE_SYSTEM_PROCESSOR=aarch64 -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-29 -DCMAKE_C_COMPILER="%ANDROID_NDK_HOME%\toolchains\llvm\prebuilt\windows-x86_64\bin\clang.exe" -DCMAKE_CXX_COMPILER="%ANDROID_NDK_HOME%\toolchains\llvm\prebuilt\windows-x86_64\bin\clang++.exe"
goto :eof
:build
"C:\Program Files\CMake\bin\cmake.exe" %*
