<div dir="rtl">

# Aether-GUI

[![Release](https://img.shields.io/github/v/release/Nishef1/Aether-GUI?sort=semver)](https://github.com/Nishef1/Aether-GUI/releases)
[![License: AGPL v3](https://img.shields.io/github/license/Nishef1/Aether-GUI)](LICENSE)
![Desktop](https://img.shields.io/badge/desktop-Windows%20%7C%20Linux%20%7C%20macOS-555)
![Android](https://img.shields.io/badge/Android-arm64--v8a-3DDC84?logo=android&logoColor=white)

[English](README.md) · **فارسی**

Aether-GUI یک کلاینت گرافیکی مستقل و **mobile-first** برای هسته‌ی رسمی [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether) است. منطق پروتکل‌ها در هسته‌ی upstream باقی می‌ماند و این پروژه رابط کاربری، مدیریت چرخه‌ی اتصال، تونل سراسری سیستم، telemetry و ورود تعاملی Zero Trust را مدیریت می‌کند.

شاخه‌ی `main` اکنون **Aether-GUI v0.8.0** را هدف می‌گیرد، **Aether v1.9.0** با commit دقیق `311b573352bb67e494895ff67d20b002d075116a` را pin می‌کند و برای تونل desktop از **sing-box v1.14.0** استفاده می‌کند. نسخه‌ی runtimeها از [`scripts/runtime-versions.json`](scripts/runtime-versions.json) خوانده می‌شود.

> **وضعیت انتشار:** `v0.8.0` کاندید فعلی انتشار است. workflow دستی باید Windows، Linux، Debian 12، Arch، هر دو معماری macOS و Android ARM64 امضاشده را با موفقیت رد کند تا release job اجازه‌ی انتشار فایل‌ها را داشته باشد.

## امکانات فعلی

- **MASQUE روی HTTP/3 یا HTTP/2** به‌همراه profileهای مبهم‌سازی Aether، ECH و fragmentation اختیاری ClientHello در H2.
- **WireGuard** و **WARP-in-WARP (gool)**، شامل endpointهای دو-hop و اسکن دو-hop اضافه‌شده در Aether 1.9.
- قابلیت‌های proxy در Aether 1.9: HTTP CONNECT محلی و chain کردن Aether پشت SOCKS5/HTTP upstream proxy.
- DNS و routing ruleها با domain sniffing پیش‌فرض برای حفظ ruleهای مبتنی بر domain پشت TUN.
- **Cloudflare Zero Trust** با email one-time code، service token و access token آماده. secretها و upstream URLهایی که credential دارند session-only هستند و قبل از ذخیره‌ی profile پاک می‌شوند.
- **تأیید واقعی اتصال**: صرفاً دیدن یک log موفق به معنی Connected نیست. Android ابتدا egress واقعی SOCKS را بررسی می‌کند و بعد TUN دستگاه را بالا می‌آورد؛ desktop نیز transport و system tunnel را جداگانه بررسی می‌کند.
- **محافظت سراسری دستگاه به‌صورت پیش‌فرض**:
  - Android: `VpnService` + HEV tun2socks، مسیر عادی محصول.
  - Desktop: آداپتر TUN مبتنی بر sing-box که در نصب جدید به‌صورت پیش‌فرض فعال است و کاربر همچنان می‌تواند آن را عمداً خاموش کند.
- UI موبایل‌محور با safe-area اندروید، hit-targetهای مناسب لمس، انیمیشن کمتر روی موبایل و polling وابسته به visibility/state.
- Live log در Android پیش‌فرض خاموش، محدود و فقط داخل حافظه است.

## سیستم‌عامل‌های هدف

قرارداد build فعلی این هدف‌ها را پوشش می‌دهد:

- Windows x86_64
- Linux x86_64
- macOS arm64
- macOS x86_64
- Android arm64-v8a

Android عمداً ARM64-first است. بسته‌ی native شامل executable رسمی ARM64 هسته‌ی Aether، HEV و JNI bridge محلی پروژه است.

## معماری

لایه‌ی transport از تونل سراسری سیستم جداست:

```text
React / Tauri IPC
       |
EngineRuntime
       |-- Aether EngineAdapter -> loopback SOCKS5
       |
       `-- SystemTunnelRuntime
             |-- desktop: sing-box TUN
             `-- Android: VpnService + HEV
```

این GUI نباید patch خصوصی برای منطق MASQUE/WireGuard/gool نگه دارد؛ fixهای پروتکل متعلق به [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether) هستند. جزئیات بیشتر در [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## توسعه و تست دستی

### دسکتاپ

پیش‌نیازها: Node.js/npm، Rust stable و پیش‌نیازهای معمول [Tauri v2](https://v2.tauri.app/start/prerequisites/).

```sh
node scripts/ci/sync-product-version.mjs
npm ci
npm run verify:runtimes
npm run typecheck
npm run lint
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri -- dev
```

`src-tauri/tauri.conf.json` منبع نسخه‌ی محصول است. اسکریپت `sync-product-version.mjs` metadata تولیدشده‌ی npm/Cargo را قبل از frozen install/test به همان نسخه همگام می‌کند. `npm run prepare:aether` هسته‌ی pin‌شده‌ی رسمی را برای سیستم‌عامل فعلی می‌گیرد و checksum منتشرشده را بررسی می‌کند. `npm run prepare:sidecars` نیز runtimeهای desktop مثل sing-box/Wintun را آماده می‌کند.

### Android ARM64

علاوه بر موارد بالا به JDK 17، Android SDK 36، NDK `28.2.13676358`، Bash و target رست `aarch64-linux-android` نیاز است.

```sh
node scripts/ci/sync-product-version.mjs
npm ci
npm run android:init
npm run prepare:android-native
npm run android:build
```

`tauri android init` می‌تواند پروژه‌ی generated اندروید را دوباره بسازد؛ بنابراین تغییرات ماندگار باید در plugin/source اصلی یا اسکریپت‌های deterministic مثل `scripts/apply-android-branding.mjs` باشند، نه در ادیت‌های دستی فایل‌های generated.

جزئیات کامل‌تر: [`docs/BUILD.md`](docs/BUILD.md).

## سیاست build و release

`.github/workflows/build.yml` فقط با **`workflow_dispatch` دستی** اجرا می‌شود و روی push یا tag خودکار اجرا نمی‌شود. اگر اپراتور هنگام اجرای دستی `publish_release = true` را انتخاب کند، release job فقط بعد از موفقیت desktop matrix، تست نصب Debian 12، پکیج native Arch و Android ARM64 اجرا می‌شود و سپس `v0.8.0` را همراه artifactها و `SHA256SUMS.txt` منتشر/به‌روزرسانی می‌کند.

چک نهایی انتشار شامل connect/disconnect/reconnect روی Windows، تونل سراسری desktop، چرخه‌ی permission/service در Android، چند بار اتصال و قطع، foreground/background، MASQUE H2/H3، WireGuard، gool، DNS/routing، بررسی exit IP/data-plane و اعتبارسنجی APK امضاشده‌ی ARM64 است.

## نکات امنیتی

- upstream proxy URL دارای credential وارد command line نمی‌شود و در profile ذخیره نمی‌شود.
- secretهای Zero Trust و کد یک‌بارمصرف در profile موفق ذخیره نمی‌شوند.
- Android listener محلی SOCKS را روی LAN expose نمی‌کند.
- در desktop فعال‌کردن LAN binding یک انتخاب expert است و یک proxy بدون authentication را در شبکه‌ی محلی در دسترس می‌گذارد.
- logها ابزار diagnostics هستند و معیار Connected محسوب نمی‌شوند.

## نسب پروژه و نام Aether

این repository از خط تاریخی MatinSenPai/Aether-GUI شروع شده، ولی معماری runtime/UI فعلی مستقل نگهداری می‌شود. ریپوی Matin از اینجا به بعد مرجع تاریخی است، نه upstream عملیاتی. upstream هسته **CluvexStudio/Aether** است.

پیش از انتشار عمومی نسخه‌ی جدید با نام یا لوگوی **Aether**، فایل فعلی [`TRADEMARK.md`](https://github.com/CluvexStudio/Aether/blob/main/TRADEMARK.md) upstream باید بررسی شود. اگر استفاده از نام/لوگو نیاز به اجازه داشته باشد و چنین اجازه‌ای موجود نباشد، کلاینت باید پیش از انتشار عمومی rebrand شود؛ این repository نباید اجازه را فرض کند.

## مجوز

[GNU Affero General Public License v3.0](LICENSE).

</div>
